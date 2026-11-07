import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';

import { Database } from '../../common/database.service.js';
import { config, rules } from '../../config.js';
import { EventsService } from '../events/events.service.js';
import { NotifyService, type Params } from '../notify/notify.service.js';
import { RoomsService, type RoomRow } from '../rooms/rooms.service.js';

const MIN = 60_000;

interface Check {
  type: string;
  bad: boolean;
  /** For alerts with hysteresis: only clear when this is true. Defaults to !bad. */
  ok?: boolean;
  graceMin: number;
  params: Params;
  /** Send "back to normal" when it clears. */
  announceRecovery: boolean;
}

/**
 * Watches the rooms: turns readings into alerts (once per problem, plus "back to normal"), and
 * records each problem as an incident with a start and an end for the admin portal.
 */
@Injectable()
export class MonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private readonly log = new Logger('Monitor');

  constructor(
    private db: Database,
    private rooms: RoomsService,
    private notifier: NotifyService,
    private events: EventsService
  ) {}

  onApplicationBootstrap() {
    if (config.test) return;
    this.timer = setInterval(() => this.checkOffline().catch((e) => this.log.error(e)), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async openIncident(roomId: string, type: string, since: Date, details: Params) {
    await this.db.query(
      `INSERT INTO room_incidents (room_id, type, started_at, details) VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_id, type) WHERE ended_at IS NULL DO NOTHING`,
      [roomId, type, since, details]
    );
    this.events.publish({ type: 'incident', roomId, incidentType: type, state: 'open' });
  }

  private async closeIncident(roomId: string, type: string) {
    const closed = await this.db.query('UPDATE room_incidents SET ended_at = now() WHERE room_id = $1 AND type = $2 AND ended_at IS NULL RETURNING id', [roomId, type]);
    if (closed.length) this.events.publish({ type: 'incident', roomId, incidentType: type, state: 'closed' });
  }

  /** Called for every current reading a controller uploads. */
  async evaluateReading(room: RoomRow, r: any, now = Date.now()) {
    const c = await this.rooms.conditions(room);
    const coldest = [r.chamber, r.coil_outlet].filter((v) => v !== null && v !== undefined) as number[];
    const minTemp = coldest.length ? Math.min(...coldest) : null;

    const checks: Check[] = [
      { type: 'chamberWarm', bad: r.chamber !== null && r.chamber !== undefined && r.chamber > c.safeMax, graceMin: c.excursionGraceMin, params: { room: room.name, temp: r.chamber, max: c.safeMax }, announceRecovery: true },
      { type: 'chamberCold', bad: minTemp !== null && minTemp < c.safeMin, graceMin: rules.coldAlertMin, params: { room: room.name, temp: minTemp ?? '' }, announceRecovery: true },
      { type: 'humidityLow', bad: r.humidity !== null && r.humidity !== undefined && r.humidity < c.humidityMin, graceMin: c.humidityGraceMin, params: { room: room.name, humidity: Math.round(r.humidity ?? 0) }, announceRecovery: false },
      { type: 'batteryLow', bad: r.battery !== null && r.battery !== undefined && r.battery <= rules.batteryLowPercent, ok: r.battery === null || r.battery === undefined || r.battery >= rules.batteryOkPercent, graceMin: 0, params: { room: room.name, battery: r.battery ?? '' }, announceRecovery: false },
    ];
    const deviceSays = (code: string) => (r.device_alerts ?? []).includes(code);
    if (room.cooling_type === 'ice_bank') {
      checks.push({ type: 'iceLow', bad: deviceSays('ice_bank_low'), graceMin: 0, params: { room: room.name }, announceRecovery: false });
    } else {
      // Peltier: the hot side burns the module out if it overheats; the controller also reports faults it detects.
      checks.push(
        {
          type: 'coolerOverheat',
          bad: deviceSays('hot_side_overheat') || (r.hot_side !== null && r.hot_side !== undefined && r.hot_side > rules.hotSideAlertC),
          graceMin: 0,
          params: { room: room.name, temp: r.hot_side === null || r.hot_side === undefined ? '' : Math.round(r.hot_side) },
          announceRecovery: true,
        },
        { type: 'coolerFault', bad: deviceSays('cooler_fault'), graceMin: 0, params: { room: room.name }, announceRecovery: true },
        { type: 'coolingCapacity', bad: deviceSays('cooling_capacity'), graceMin: 0, params: { room: room.name }, announceRecovery: false }
      );
    }

    // Data arrived, so the room is no longer offline.
    const wasOffline = await this.db.query("DELETE FROM room_alert_state WHERE room_id = $1 AND type = 'offline' RETURNING 1", [room.id]);
    if (wasOffline.length) await this.closeIncident(room.id, 'offline');

    for (const check of checks) {
      const state = await this.db.one<{ since: Date; notified: boolean }>('SELECT since, notified FROM room_alert_state WHERE room_id = $1 AND type = $2', [room.id, check.type]);
      if (check.bad) {
        const since = state ? state.since.getTime() : now;
        if (!state) await this.db.query('INSERT INTO room_alert_state (room_id, type, since) VALUES ($1, $2, $3)', [room.id, check.type, new Date(now)]);
        if (!state?.notified && now - since >= check.graceMin * MIN) {
          await this.db.query('UPDATE room_alert_state SET notified = true WHERE room_id = $1 AND type = $2', [room.id, check.type]);
          await this.openIncident(room.id, check.type, new Date(since), check.params);
          await this.notifier.notifyRoom(room.id, check.type, check.params);
        }
      } else if (state && (check.ok ?? true)) {
        await this.db.query('DELETE FROM room_alert_state WHERE room_id = $1 AND type = $2', [room.id, check.type]);
        if (state.notified) {
          await this.closeIncident(room.id, check.type);
          if (check.announceRecovery) await this.notifier.notifyRoom(room.id, 'backToNormal', { room: room.name });
        }
      }
    }
  }

  /** Runs every minute: warns farmers when a room has stopped sending data. */
  async checkOffline(now = Date.now()) {
    const rooms = await this.db.query<{ id: string; name: string; last: Date }>(
      `SELECT c.id, c.name, r.at AS last
         FROM cold_rooms c
         CROSS JOIN LATERAL (SELECT at FROM readings WHERE room_id = c.id ORDER BY at DESC LIMIT 1) r
        WHERE c.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM room_alert_state s WHERE s.room_id = c.id AND s.type = 'offline')`
    );
    for (const room of rooms) {
      if (now - room.last.getTime() < rules.offlineAlertMin * MIN) continue;
      await this.db.query("INSERT INTO room_alert_state (room_id, type, since, notified) VALUES ($1, 'offline', $2, true) ON CONFLICT DO NOTHING", [room.id, room.last]);
      await this.openIncident(room.id, 'offline', room.last, { room: room.name });
      await this.notifier.notifyRoom(room.id, 'offline', { room: room.name });
    }
  }
}
