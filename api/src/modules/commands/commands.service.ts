import { Injectable } from '@nestjs/common';

import { ApiError } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { rules } from '../../config.js';
import { type Actor, AuditService } from '../audit/audit.service.js';
import { CropsService } from '../crops/crops.service.js';
import { EventsService } from '../events/events.service.js';
import type { RoomRow } from '../rooms/rooms.service.js';

export const COMMAND_TYPES = ['set_target', 'cooling', 'inside_fan', 'hot_fan'] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];
export type Via = 'https' | 'mqtt';

/** What the controller receives. */
export interface DeviceCommand {
  id: number;
  type: CommandType;
  /** set_target: { targetC: number | null, minutes } · others: { mode: 'auto' | 'off' | 'on', minutes } */
  params: Record<string, unknown>;
  expiresAt: string;
}

export const commandView = (c: any) => ({
  id: c.id,
  roomId: c.room_id,
  type: c.type as CommandType,
  params: c.params,
  reason: c.reason,
  status: c.status as string,
  requestedBy: c.requested_by_name,
  createdAt: c.created_at,
  sentAt: c.sent_at,
  sentVia: c.sent_via,
  completedAt: c.completed_at,
  result: c.result,
});

const toDevice = (c: any): DeviceCommand => ({ id: c.id, type: c.type, params: c.params, expiresAt: new Date(c.expires_at).toISOString() });

/**
 * Remote control of a room. Every override is timed and ends by itself; the controller checks the
 * values again, and its own safety limits (freeze guard, hot side, battery) always win.
 */
@Injectable()
export class CommandsService {
  private listeners: ((roomId: string, command: DeviceCommand) => void)[] = [];

  constructor(
    private db: Database,
    private crops: CropsService,
    private events: EventsService,
    private audit: AuditService
  ) {}

  /** The MQTT broker registers here to push new commands at once. */
  onCreated(fn: (roomId: string, command: DeviceCommand) => void) {
    this.listeners.push(fn);
  }

  /** The target range a remote change may use for this room's crop. */
  async targetRange(room: RoomRow) {
    const c = (await this.crops.get(room.crop)).controller as Record<string, number>;
    const margin = rules.commands.targetMarginC;
    const min = Math.max(c.alarmLowC + margin, c.freezeGuardC + c.hysteresisC + margin);
    const max = c.alarmHighC - margin;
    return { min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10, profile: c.targetC };
  }

  private minutes(type: CommandType, v: unknown): number {
    const max = rules.commands.maxMinutes[type];
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < 1 || n > max) throw new ApiError('invalidDuration', 400, { max });
    return Math.round(n);
  }

  /** Checks a request and returns the parameters to send. */
  async validate(room: RoomRow, type: CommandType, p: any): Promise<Record<string, unknown>> {
    if (!COMMAND_TYPES.includes(type)) throw new ApiError('invalidCommand');
    if (room.status === 'retired') throw new ApiError('roomNotActive');
    if (type === 'set_target') {
      if (p?.targetC === null || p?.mode === 'auto') return { targetC: null, minutes: 0 };
      const t = typeof p?.targetC === 'number' ? p.targetC : Number(p?.targetC);
      const range = await this.targetRange(room);
      if (!Number.isFinite(t) || t < range.min || t > range.max) throw new ApiError('targetOutOfRange', 422, range);
      return { targetC: Math.round(t * 10) / 10, minutes: this.minutes(type, p?.minutes) };
    }
    // Cooling: "off" pauses it, "on" (or "auto") hands it back to the thermostat. Fans: "on", "off" or "auto".
    if (p?.mode === 'auto' || (type === 'cooling' && p?.mode === 'on')) return { mode: 'auto', minutes: 0 };
    const modes = type === 'cooling' ? ['off'] : ['on', 'off'];
    if (!modes.includes(p?.mode)) throw new ApiError('invalidCommand');
    return { mode: p.mode, minutes: this.minutes(type, p?.minutes) };
  }

  async create(room: RoomRow, actor: Actor, type: CommandType, params: unknown, reason: unknown) {
    const why = typeof reason === 'string' && reason.trim().length >= 5 ? reason.trim().slice(0, 300) : null;
    if (!why) throw new ApiError('reasonRequired');
    const valid = await this.validate(room, type, params);
    const created = await this.db.tx(async (db) => {
      // A newer command of the same kind replaces one that has not been carried out yet.
      await this.db.query("UPDATE room_commands SET status = 'cancelled', completed_at = now() WHERE room_id = $1 AND type = $2 AND status IN ('pending', 'sent')", [room.id, type], db);
      return this.db.one(
        `INSERT INTO room_commands (room_id, type, params, reason, requested_by, requested_by_name, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7)) RETURNING *`,
        [room.id, type, valid, why, actor.id ?? null, actor.name ?? 'staff', rules.commands.deliverWithinMin],
        db
      );
    });
    await this.audit.record(actor, {
      action: 'command.create',
      entityType: 'room',
      entityId: room.id,
      summary: `Sent "${describe(type, valid)}" to ${room.name} (${room.id}): ${why}`,
      after: { commandId: created.id, type, params: valid },
    });
    this.events.publish({ type: 'command', roomId: room.id, commandId: created.id, status: 'pending' });
    for (const fn of this.listeners) fn(room.id, toDevice(created));
    return commandView(created);
  }

  /** Commands the controller has not acted on yet. Marks them as sent through the channel it asked on. */
  async deliver(roomId: string, via: Via): Promise<DeviceCommand[]> {
    await this.expire();
    const rows = await this.db.query(
      `UPDATE room_commands SET status = 'sent', sent_at = coalesce(sent_at, now()), sent_via = coalesce(sent_via, $2)
        WHERE room_id = $1 AND status IN ('pending', 'sent') AND expires_at > now()
        RETURNING *`,
      [roomId, via]
    );
    return rows.sort((a, b) => a.id - b.id).map(toDevice);
  }

  /** Commands not carried out in time are dropped, so a room coming back online does not act on old orders. */
  async expire() {
    const rows = await this.db.query("UPDATE room_commands SET status = 'expired', completed_at = now() WHERE status IN ('pending', 'sent') AND expires_at < now() RETURNING id, room_id");
    for (const r of rows) this.events.publish({ type: 'command', roomId: r.room_id, commandId: r.id, status: 'expired' });
  }

  /** The controller reports what it did. */
  async ack(roomId: string, id: number, ok: boolean, message: unknown) {
    const result = typeof message === 'string' ? { message: message.slice(0, 200) } : null;
    const c = await this.db.one(
      `UPDATE room_commands SET status = $3, completed_at = now(), result = $4
        WHERE id = $1 AND room_id = $2 AND status IN ('pending', 'sent') RETURNING *`,
      [id, roomId, ok ? 'done' : 'failed', result]
    );
    if (!c) return null;
    this.events.publish({ type: 'command', roomId, commandId: id, status: c.status });
    await this.audit.record({ type: 'device', id: roomId, name: `Controller ${roomId}` }, {
      action: ok ? 'command.done' : 'command.failed',
      entityType: 'room',
      entityId: roomId,
      summary: `${roomId} ${ok ? 'carried out' : 'refused'} "${describe(c.type, c.params)}"${result?.message ? `: ${result.message}` : ''}`,
    });
    return commandView(c);
  }

  async cancel(room: RoomRow, id: number, actor: Actor) {
    const c = await this.db.one("UPDATE room_commands SET status = 'cancelled', completed_at = now() WHERE id = $1 AND room_id = $2 AND status IN ('pending', 'sent') RETURNING *", [id, room.id]);
    if (!c) throw new ApiError('commandClosed', 409);
    await this.audit.record(actor, { action: 'command.cancel', entityType: 'room', entityId: room.id, summary: `Cancelled "${describe(c.type, c.params)}" for ${room.name}` });
    this.events.publish({ type: 'command', roomId: room.id, commandId: id, status: 'cancelled' });
    return commandView(c);
  }

  async list(roomId: string, limit = 30) {
    await this.expire();
    return (await this.db.query('SELECT * FROM room_commands WHERE room_id = $1 ORDER BY id DESC LIMIT $2', [roomId, limit])).map(commandView);
  }
}

/** "Target 3.0°C for 60 min", "Cooling off for 30 min", "Inside fan back to automatic". */
export function describe(type: string, p: any): string {
  const min = p?.minutes ? ` for ${p.minutes} min` : '';
  switch (type) {
    case 'set_target':
      return p?.targetC === null ? 'Target temperature back to the crop profile' : `Target ${p.targetC}°C${min}`;
    case 'cooling':
      return p?.mode === 'auto' ? 'Cooling back to automatic' : `Cooling off${min}`;
    case 'inside_fan':
      return p?.mode === 'auto' ? 'Inside fan back to automatic' : `Inside fan ${p?.mode === 'off' ? 'off' : 'on'}${min}`;
    case 'hot_fan':
      return p?.mode === 'auto' ? 'Hot-side fan back to automatic' : `Hot-side fan ${p?.mode === 'off' ? 'off' : 'on'}${min}`;
    default:
      return type;
  }
}
