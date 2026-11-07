import crypto from 'node:crypto';

import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { ApiError, notFound } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { sha256 } from '../../common/ids.js';
import { optionalText, positiveInt, text } from '../../common/validate.js';
import { type Actor, AuditService } from '../audit/audit.service.js';
import { isDistrict } from '../auth/auth.controller.js';
import { CommandsService, COMMAND_TYPES, type CommandType } from '../commands/commands.service.js';
import { MqttService } from '../mqtt/mqtt.service.js';
import { RecommendationsService } from '../recommendations/recommendations.service.js';
import { readingView, RoomsService } from '../rooms/rooms.service.js';
import { StorageService } from '../storage/storage.service.js';
import { AdminActor, AdminGuard, AdminRoles, type AdminSession, assertRoom, CurrentAdmin, EVERYONE, ROOM_STAFF, roomScope } from './admin.guard.js';
import { InsightsService } from './insights.service.js';

const COOLING = ['peltier', 'ice_bank'] as const;
const STATUSES = ['active', 'maintenance', 'retired'] as const;
const CHANNELS = ['stable', 'beta'] as const;
const newDeviceToken = () => crypto.randomBytes(24).toString('hex');

/** Fields an admin may see and change, as stored, for the audit trail's before/after. */
const editable = (r: any) => ({
  name: r.name, district: r.district, sector: r.sector, crop: r.crop, capacityCrates: r.capacity_crates, coolingType: r.cooling_type,
  status: r.status, notes: r.notes, latitude: r.latitude, longitude: r.longitude, firmwareChannel: r.firmware_channel,
  peltierModules: r.peltier_modules, storageRateKgDay: r.storage_rate_kg_day, storageRateCrateDay: r.storage_rate_crate_day,
});

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminRoomsController {
  constructor(
    private db: Database,
    private rooms: RoomsService,
    private insights: InsightsService,
    private audit: AuditService,
    private commands: CommandsService,
    private mqtt: MqttService,
    private recommendations: RecommendationsService,
    private storage: StorageService
  ) {}

  /** The room, if this staff member may work with it. Accepts the room's old id too. */
  private async room(id: string, admin: AdminSession) {
    const room = await this.rooms.getRow(id);
    assertRoom(admin, room.id);
    return room;
  }

  @Get('rooms')
  @AdminRoles(...EVERYONE)
  list(@CurrentAdmin() admin: AdminSession) {
    return this.insights.roomCards(roomScope(admin));
  }

  @Get('rooms/:id')
  @AdminRoles(...EVERYONE)
  async detail(@Param('id') rawId: string, @CurrentAdmin() admin: AdminSession) {
    const room = await this.room(rawId, admin);
    const id = room.id;
    const [health, latest, farmers, batches, incidents, certs, readingsToday] = await Promise.all([
      room.status === 'retired' ? null : this.insights.health(room),
      this.db.one('SELECT * FROM readings WHERE room_id = $1 ORDER BY at DESC LIMIT 1', [id]),
      this.db.query("SELECT id, name, phone, district, status, locked_at, photo_id, created_at FROM users WHERE cold_room_id = $1 AND role = 'farmer' ORDER BY name", [id]),
      this.db.query(
        `SELECT b.*, u.name AS farmer_name FROM batches b JOIN users u ON u.id = b.farmer_id
          WHERE b.cold_room_id = $1 AND b.status = 'stored' ORDER BY b.stored_at`,
        [id]
      ),
      this.db.query('SELECT * FROM room_incidents WHERE room_id = $1 ORDER BY started_at DESC LIMIT 50', [id]),
      this.db.one("SELECT count(*) AS n FROM certificates c JOIN batches b ON b.id = c.batch_id WHERE b.cold_room_id = $1 AND c.issued_at > now() - interval '30 days'", [id]),
      this.db.one("SELECT count(*) AS n FROM readings WHERE room_id = $1 AND at > now() - interval '24 hours'", [id]),
    ]);
    const batchSummaries = await Promise.all(batches.map(async (b) => ({ ...b, freshness: (await this.rooms.summarizeBatch(b)).freshness })));
    const [commands, recs, range, assigned] = await Promise.all([
      this.commands.list(id, 15),
      this.recommendations.forRoom(room),
      this.commands.targetRange(room),
      this.db.query('SELECT a.id, a.name FROM operator_rooms o JOIN admins a ON a.id = o.admin_id WHERE o.room_id = $1 ORDER BY a.name', [id]),
    ]);
    return {
      room: {
        id: room.id, legacyId: room.legacy_id, ...editable(room), firmwareVersion: room.firmware_version, lastUploadAt: room.last_upload_at, lastUploadVia: room.last_upload_via,
        deviceTokenSet: !!room.device_token_hash, deviceTokenRotatedAt: room.device_token_rotated_at, createdAt: room.created_at,
      },
      view: await this.rooms.view(room),
      reading: latest ? { ...readingView(latest), deviceAlerts: latest.device_alerts } : null,
      health,
      energyTodayWh: await this.rooms.energyToday(id),
      /** The second road to the controller: whether it is connected over MQTT right now, and when it last was. */
      mqtt: { connected: this.mqtt.isConnected(id), seenAt: room.mqtt_seen_at },
      /** What the controller says it is running now (remote overrides and how long they last). */
      control: room.control,
      targetRange: range,
      commands,
      recommendations: recs,
      operators: assigned,
      farmers,
      batches: batchSummaries.map((b) => ({ id: b.id, code: b.code, crop: b.crop, quantity: b.quantity, unit: b.unit, storedAt: b.stored_at, farmerId: b.farmer_id, farmerName: b.farmer_name, freshness: b.freshness, storageLocation: b.storage_location, collectionRequestedAt: b.collection_requested_at })),
      incidents,
      certificates30d: certs!.n,
      readings24h: readingsToday!.n,
    };
  }

  @Get('rooms/:id/history')
  @AdminRoles(...EVERYONE)
  async history(@Param('id') rawId: string, @CurrentAdmin() admin: AdminSession, @Query('range') range?: string) {
    const id = (await this.room(rawId, admin)).id;
    return this.rooms.history(id, range === '7d' ? '7d' : range === '30d' ? '30d' : '24h');
  }

  /** Raw readings for one day (the "digital twin" replay in the portal). */
  @Get('rooms/:id/readings')
  @AdminRoles(...EVERYONE)
  async readings(@Param('id') rawId: string, @CurrentAdmin() admin: AdminSession, @Query('from') from?: string, @Query('to') to?: string) {
    const id = (await this.room(rawId, admin)).id;
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 6 * 3_600_000);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() - start.getTime() > 2 * 86_400_000) throw new ApiError('invalidRange');
    const rows = await this.db.query('SELECT * FROM readings WHERE room_id = $1 AND at BETWEEN $2 AND $3 ORDER BY at', [id, start, end]);
    return rows.map((r) => ({ ...readingView(r), deviceAlerts: r.device_alerts }));
  }

  /** Everything that happened around a room, newest first: incidents, staff and user actions. */
  @Get('rooms/:id/timeline')
  @AdminRoles(...EVERYONE)
  async timeline(@Param('id') rawId: string, @CurrentAdmin() admin: AdminSession) {
    const room = await this.room(rawId, admin);
    const id = room.id;
    const [incidents, audit] = await Promise.all([
      this.db.query('SELECT * FROM room_incidents WHERE room_id = $1 ORDER BY started_at DESC LIMIT 100', [id]),
      this.db.query(
        `SELECT a.* FROM audit_log a
          WHERE (a.entity_type = 'room' AND (a.entity_id = $1 OR a.entity_id = $2))
             OR (a.entity_type = 'batch' AND a.entity_id IN (SELECT id FROM batches WHERE cold_room_id = $1))
          ORDER BY a.id DESC LIMIT 100`,
        [id, room.legacy_id]
      ),
    ]);
    const items = [
      ...incidents.flatMap((i) => [
        { at: i.started_at, kind: 'incident', title: `${i.type} started`, incidentId: i.id, details: i.details },
        ...(i.ended_at ? [{ at: i.ended_at, kind: 'resolved', title: `${i.type} resolved`, incidentId: i.id }] : []),
        ...(i.acknowledged_at ? [{ at: i.acknowledged_at, kind: 'acknowledged', title: `${i.type} acknowledged`, incidentId: i.id, note: i.note }] : []),
      ]),
      ...audit.map((a) => ({ at: a.at, kind: 'audit', title: a.summary, actor: a.actor_name, action: a.action })),
    ];
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }

  @Post('rooms')
  @HttpCode(200)
  @AdminRoles('operations')
  async create(@Body() b: any, @AdminActor() actor: Actor) {
    b ??= {};
    const name = text(b.name, 'nameRequired', { min: 3, max: 80 });
    if (!isDistrict(b.district)) throw new ApiError('districtRequired');
    const sector = text(b.sector, 'sectorRequired', { min: 2, max: 60 });
    const crop = text(b.crop, 'cropRequired', { max: 40 });
    if (!(await this.db.one('SELECT 1 FROM crop_profiles WHERE crop = $1', [crop]))) throw new ApiError('cropRequired');
    const coolingType = COOLING.includes(b.coolingType) ? b.coolingType : 'peltier';
    const capacity = positiveInt(b.capacityCrates, 'invalidCapacity', 100_000);
    // HHR-001, HHR-002, ...: the number the controller, the portal and the label all use.
    const id = await this.rooms.nextRoomId();
    const token = newDeviceToken();
    const modules = b.peltierModules === undefined ? 1 : positiveInt(b.peltierModules, 'invalidModules', 8);
    const room = await this.db.one(
      `INSERT INTO cold_rooms (id, name, district, sector, crop, capacity_crates, cooling_type, device_token_hash, device_token_rotated_at, latitude, longitude, notes, peltier_modules, storage_rate_kg_day, storage_rate_crate_day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, $11, $12, $13, $14) RETURNING *`,
      [id, name, b.district, sector, crop, capacity, coolingType, sha256(token), num(b.latitude, -90, 90), num(b.longitude, -180, 180), optionalText(b.notes, 2000), modules, rate(b.storageRateKgDay), rate(b.storageRateCrateDay)]
    );
    await this.audit.record(actor, { action: 'room.create', entityType: 'room', entityId: id, summary: `Created cold room ${name} (${coolingType}, ${crop}) in ${b.district}`, after: editable(room) });
    // The device token is shown once: only its hash is stored.
    return { id, deviceToken: token };
  }

  @Patch('rooms/:id')
  @AdminRoles('operations')
  async update(@Param('id') id: string, @Body() b: any, @AdminActor() actor: Actor) {
    b ??= {};
    const before = await this.rooms.getRow(id);
    const sets: string[] = [];
    const values: unknown[] = [id];
    const set = (col: string, v: unknown) => {
      values.push(v);
      sets.push(`${col} = $${values.length}`);
    };
    if (b.name !== undefined) set('name', text(b.name, 'nameRequired', { min: 3, max: 80 }));
    if (b.district !== undefined) {
      if (!isDistrict(b.district)) throw new ApiError('districtRequired');
      set('district', b.district);
    }
    if (b.sector !== undefined) set('sector', text(b.sector, 'sectorRequired', { min: 2, max: 60 }));
    if (b.crop !== undefined) {
      if (!(await this.db.one('SELECT 1 FROM crop_profiles WHERE crop = $1', [b.crop]))) throw new ApiError('cropRequired');
      set('crop', b.crop);
    }
    if (b.capacityCrates !== undefined) set('capacity_crates', positiveInt(b.capacityCrates, 'invalidCapacity', 100_000));
    if (b.coolingType !== undefined) {
      if (!COOLING.includes(b.coolingType)) throw new ApiError('invalidCoolingType');
      set('cooling_type', b.coolingType);
    }
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) throw new ApiError('invalidStatus');
      set('status', b.status);
    }
    if (b.firmwareChannel !== undefined) {
      if (!CHANNELS.includes(b.firmwareChannel)) throw new ApiError('invalidChannel');
      set('firmware_channel', b.firmwareChannel);
    }
    if (b.notes !== undefined) set('notes', optionalText(b.notes, 2000));
    if (b.peltierModules !== undefined) set('peltier_modules', positiveInt(b.peltierModules, 'invalidModules', 8));
    // A room's own storage rate (RWF per day); empty = use the system rate.
    if (b.storageRateKgDay !== undefined) set('storage_rate_kg_day', rate(b.storageRateKgDay));
    if (b.storageRateCrateDay !== undefined) set('storage_rate_crate_day', rate(b.storageRateCrateDay));
    if (b.latitude !== undefined) set('latitude', num(b.latitude, -90, 90));
    if (b.longitude !== undefined) set('longitude', num(b.longitude, -180, 180));
    if (!sets.length) return { ok: true };
    const after = await this.db.one(`UPDATE cold_rooms SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values);
    this.rooms.clearSummaryCache();
    const changed = Object.keys(editable(after)).filter((k) => JSON.stringify((editable(after) as any)[k]) !== JSON.stringify((editable(before) as any)[k]));
    await this.audit.record(actor, {
      action: 'room.update',
      entityType: 'room',
      entityId: id,
      summary: `Changed ${before.name}: ${changed.join(', ') || 'no change'}`,
      before: Object.fromEntries(changed.map((k) => [k, (editable(before) as any)[k]])),
      after: Object.fromEntries(changed.map((k) => [k, (editable(after) as any)[k]])),
    });
    return { ok: true };
  }

  /** New device token (e.g. a controller was replaced or its token leaked). The old one stops working at once. */
  @Post('rooms/:id/rotate-token')
  @HttpCode(200)
  @AdminRoles('operations')
  async rotate(@Param('id') id: string, @AdminActor() actor: Actor) {
    const room = await this.rooms.getRow(id);
    const token = newDeviceToken();
    await this.db.query('UPDATE cold_rooms SET device_token_hash = $2, device_token_rotated_at = now() WHERE id = $1', [id, sha256(token)]);
    await this.audit.record(actor, { action: 'room.rotateToken', entityType: 'room', entityId: id, summary: `Issued a new controller token for ${room.name}; the old one no longer works` });
    return { deviceToken: token };
  }

  // ---------- Remote control ----------

  /**
   * Sends a command to one room: { type, params, reason }. Types: set_target, cooling, inside_fan, hot_fan.
   * The controller carries it out for the time asked, then returns to automatic control by itself.
   */
  @Post('rooms/:id/commands')
  @HttpCode(200)
  @AdminRoles(...ROOM_STAFF)
  async command(@Param('id') rawId: string, @Body() b: any, @CurrentAdmin() admin: AdminSession, @AdminActor() actor: Actor) {
    const room = await this.room(rawId, admin);
    if (!COMMAND_TYPES.includes(b?.type)) throw new ApiError('invalidCommand');
    return this.commands.create(room, actor, b.type as CommandType, b.params, b.reason);
  }

  @Get('rooms/:id/commands')
  @AdminRoles(...EVERYONE)
  async commandList(@Param('id') rawId: string, @CurrentAdmin() admin: AdminSession) {
    const room = await this.room(rawId, admin);
    return this.commands.list(room.id, 50);
  }

  @Post('rooms/:id/commands/:commandId/cancel')
  @HttpCode(200)
  @AdminRoles(...ROOM_STAFF)
  async cancelCommand(@Param('id') rawId: string, @Param('commandId') commandId: string, @CurrentAdmin() admin: AdminSession, @AdminActor() actor: Actor) {
    const room = await this.room(rawId, admin);
    return this.commands.cancel(room, Number(commandId), actor);
  }

  /** What to check or do, from the room's own readings and its crop profile. */
  @Get('rooms/:id/recommendations')
  @AdminRoles(...EVERYONE)
  async recommend(@Param('id') rawId: string, @CurrentAdmin() admin: AdminSession) {
    return this.recommendations.forRoom(await this.room(rawId, admin));
  }

  @Get('incidents')
  @AdminRoles(...EVERYONE)
  async incidents(@CurrentAdmin() admin: AdminSession, @Query('state') state?: string, @Query('roomId') roomId?: string) {
    const scope = roomScope(admin);
    const rows = await this.db.query(
      `SELECT i.*, c.name AS room_name, a.name AS acknowledged_by_name FROM room_incidents i
         JOIN cold_rooms c ON c.id = i.room_id LEFT JOIN admins a ON a.id = i.acknowledged_by
        WHERE ($1::text IS NULL OR ($1 = 'open' AND i.ended_at IS NULL) OR ($1 = 'closed' AND i.ended_at IS NOT NULL))
          AND ($2::text IS NULL OR i.room_id = $2)
          AND ($3::text[] IS NULL OR i.room_id = ANY($3))
        ORDER BY (i.ended_at IS NULL) DESC, i.started_at DESC LIMIT 300`,
      [state || null, roomId || null, scope]
    );
    return rows.map((i) => ({
      id: i.id, roomId: i.room_id, roomName: i.room_name, type: i.type, startedAt: i.started_at, endedAt: i.ended_at, details: i.details,
      acknowledgedAt: i.acknowledged_at, acknowledgedBy: i.acknowledged_by_name, note: i.note,
      durationMin: Math.round(((i.ended_at ? new Date(i.ended_at).getTime() : Date.now()) - new Date(i.started_at).getTime()) / 60_000),
    }));
  }

  /** "Someone is on it": records who handled an incident and what they did. */
  @Post('incidents/:id/acknowledge')
  @HttpCode(200)
  @AdminRoles('operations', 'support', 'operator')
  async acknowledge(@Param('id') id: string, @Body() b: any, @AdminActor() actor: Actor, @CurrentAdmin() admin: AdminSession) {
    const note = text(b?.note, 'noteRequired', { min: 3, max: 1000 });
    const existing = await this.db.one('SELECT room_id FROM room_incidents WHERE id = $1', [id]);
    if (!existing) throw notFound();
    assertRoom(admin, existing.room_id);
    const inc = await this.db.one('UPDATE room_incidents SET acknowledged_by = $2, acknowledged_at = now(), note = $3 WHERE id = $1 RETURNING *', [id, actor.id, note]);
    if (!inc) throw notFound();
    await this.audit.record(actor, { action: 'incident.acknowledge', entityType: 'room', entityId: inc.room_id, summary: `Acknowledged ${inc.type} incident #${id}: ${note}` });
    return { ok: true };
  }
}

/** A storage rate in RWF per day: empty clears it (the system rate applies). */
function rate(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new ApiError('invalidRate');
  return n;
}

function num(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ApiError('invalidCoordinates');
  return n;
}
