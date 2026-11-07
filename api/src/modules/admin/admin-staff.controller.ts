import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { ApiError, notFound } from '../../common/api-error.js';
import { toCsv } from '../../common/csv.js';
import { Database } from '../../common/database.service.js';
import { newId } from '../../common/ids.js';
import { text } from '../../common/validate.js';
import { type Actor, AuditService } from '../audit/audit.service.js';
import { EnergyService } from '../energy/energy.service.js';
import { AdminActor, AdminGuard, type AdminRole, AdminRoles, type AdminSession, CurrentAdmin } from './admin.guard.js';
import { hashPassword, temporaryPassword } from './admin-auth.controller.js';

const ROLES: AdminRole[] = ['superadmin', 'support', 'operations', 'market', 'operator'];

const staffView = (a: any, roomIds: string[] = []) => ({
  roomIds: a.role === 'operator' ? roomIds : null,
  id: a.id, email: a.email, name: a.name, role: a.role, status: a.status, locked: !!a.locked_at,
  mustChangePassword: a.must_change_password, createdAt: a.created_at, lastLoginAt: a.last_login_at,
});

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminStaffController {
  constructor(
    private db: Database,
    private audit: AuditService,
    private energy: EnergyService
  ) {}

  // ---------- Staff (superadmin only) ----------

  @Get('staff')
  @AdminRoles('superadmin')
  async staff() {
    const [admins, links] = await Promise.all([this.db.query('SELECT * FROM admins ORDER BY status, role, name'), this.db.query('SELECT admin_id, room_id FROM operator_rooms ORDER BY room_id')]);
    return admins.map((a) => staffView(a, links.filter((l) => l.admin_id === a.id).map((l) => l.room_id)));
  }

  /** Replaces the rooms a cold room operator is assigned to. The rooms are not theirs: they work in them. */
  private async setRooms(adminId: string, roomIds: unknown, actor: Actor, label: string) {
    const ids = Array.isArray(roomIds) ? [...new Set(roomIds.filter((r): r is string => typeof r === 'string'))] : null;
    if (!ids) throw new ApiError('roomsRequired');
    const known = await this.db.query<{ id: string }>('SELECT id FROM cold_rooms WHERE id = ANY($1)', [ids]);
    if (known.length !== ids.length) throw new ApiError('roomNotFound');
    const before = (await this.db.query<{ room_id: string }>('SELECT room_id FROM operator_rooms WHERE admin_id = $1 ORDER BY room_id', [adminId])).map((r) => r.room_id);
    await this.db.tx(async (db) => {
      await this.db.query('DELETE FROM operator_rooms WHERE admin_id = $1', [adminId], db);
      for (const id of ids) await this.db.query('INSERT INTO operator_rooms (admin_id, room_id, assigned_by) VALUES ($1, $2, $3)', [adminId, id, actor.id ?? null], db);
    });
    const after = [...ids].sort();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await this.audit.record(actor, { action: 'staff.rooms', entityType: 'admin', entityId: adminId, summary: `${label} now works in: ${after.join(', ') || 'no rooms'}`, before: { roomIds: before }, after: { roomIds: after } });
    }
  }

  @Put('staff/:id/rooms')
  @AdminRoles('superadmin')
  async rooms(@Param('id') id: string, @Body() b: any, @AdminActor() actor: Actor) {
    const a = await this.db.one('SELECT * FROM admins WHERE id = $1', [id]);
    if (!a) throw notFound();
    if (a.role !== 'operator') throw new ApiError('notAnOperator');
    await this.setRooms(id, b?.roomIds, actor, a.email);
    return { ok: true };
  }

  /** New staff member: a temporary password is shown once; they choose their own at first sign-in. */
  @Post('staff')
  @HttpCode(200)
  @AdminRoles('superadmin')
  async create(@Body() b: any, @AdminActor() actor: Actor) {
    const email = text(b?.email, 'emailRequired', { max: 200 }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError('emailRequired');
    const name = text(b?.name, 'nameRequired', { min: 2, max: 80 });
    const role = ROLES.includes(b?.role) ? (b.role as AdminRole) : null;
    if (!role) throw new ApiError('roleRequired');
    if (await this.db.one('SELECT 1 FROM admins WHERE email = $1', [email])) throw new ApiError('emailTaken');
    const password = temporaryPassword();
    const id = newId('ad');
    await this.db.query('INSERT INTO admins (id, email, name, role, password_hash, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [id, email, name, role, await hashPassword(password), actor.id]);
    await this.audit.record(actor, { action: 'staff.create', entityType: 'admin', entityId: id, summary: `Added ${name} <${email}> as ${role}`, after: { email, name, role } });
    if (role === 'operator' && Array.isArray(b?.roomIds)) await this.setRooms(id, b.roomIds, actor, email);
    return { id, temporaryPassword: password };
  }

  /** Change role or enable/disable. You cannot lock yourself out, and one active superadmin always remains. */
  @Patch('staff/:id')
  @AdminRoles('superadmin')
  async update(@Param('id') id: string, @Body() b: any, @CurrentAdmin() me: AdminSession, @AdminActor() actor: Actor) {
    const a = await this.db.one('SELECT * FROM admins WHERE id = $1', [id]);
    if (!a) throw notFound();
    const role: AdminRole = b?.role !== undefined ? (ROLES.includes(b.role) ? b.role : (() => { throw new ApiError('roleRequired'); })()) : a.role;
    const status: string = b?.status !== undefined ? (['active', 'disabled'].includes(b.status) ? b.status : (() => { throw new ApiError('invalidStatus'); })()) : a.status;
    if (id === me.id && (role !== a.role || status !== 'active')) throw new ApiError('cannotChangeSelf');
    if (a.role === 'superadmin' && (role !== 'superadmin' || status !== 'active')) {
      const others = await this.db.one<{ n: number }>("SELECT count(*) AS n FROM admins WHERE role = 'superadmin' AND status = 'active' AND id <> $1", [id]);
      if (!others?.n) throw new ApiError('lastSuperadmin');
    }
    await this.db.query('UPDATE admins SET role = $2, status = $3 WHERE id = $1', [id, role, status]);
    // Someone who stops being an operator no longer has rooms assigned.
    if (role !== 'operator') await this.db.query('DELETE FROM operator_rooms WHERE admin_id = $1', [id]);
    else if (Array.isArray(b?.roomIds)) await this.setRooms(id, b.roomIds, actor, a.email);
    if (status !== 'active') await this.db.query('DELETE FROM admin_sessions WHERE admin_id = $1', [id]);
    await this.audit.record(actor, {
      action: 'staff.update', entityType: 'admin', entityId: id, summary: `Changed ${a.email}: role ${a.role} → ${role}, ${a.status} → ${status}`,
      before: { role: a.role, status: a.status }, after: { role, status },
    });
    return { ok: true };
  }

  @Post('staff/:id/unlock')
  @HttpCode(200)
  @AdminRoles('superadmin')
  async unlock(@Param('id') id: string, @AdminActor() actor: Actor) {
    const a = await this.db.one('UPDATE admins SET locked_at = NULL, failed_attempts = 0 WHERE id = $1 RETURNING email', [id]);
    if (!a) throw notFound();
    await this.audit.record(actor, { action: 'staff.unlock', entityType: 'admin', entityId: id, summary: `Unlocked ${a.email}` });
    return { ok: true };
  }

  /** Forgotten password: a new temporary password, to be changed at the next sign-in. */
  @Post('staff/:id/reset-access')
  @HttpCode(200)
  @AdminRoles('superadmin')
  async reset(@Param('id') id: string, @CurrentAdmin() me: AdminSession, @AdminActor() actor: Actor) {
    if (id === me.id) throw new ApiError('cannotChangeSelf');
    const password = temporaryPassword();
    const a = await this.db.one(
      `UPDATE admins SET password_hash = $2, must_change_password = true, locked_at = NULL, failed_attempts = 0
        WHERE id = $1 RETURNING email`,
      [id, await hashPassword(password)]
    );
    if (!a) throw notFound();
    await this.db.query('DELETE FROM admin_sessions WHERE admin_id = $1', [id]);
    await this.audit.record(actor, { action: 'staff.resetAccess', entityType: 'admin', entityId: id, summary: `Reset ${a.email}'s password` });
    return { temporaryPassword: password };
  }

  // ---------- Audit trail ----------

  /** Newest first, with filters. `before` = id of the last entry already shown (for "load more"). */
  @Get('audit')
  async auditLog(
    @Query('actorType') actorType?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('q') q?: string,
    @Query('before') before?: string
  ) {
    const rows = await this.db.query(
      `SELECT * FROM audit_log
        WHERE ($1::text IS NULL OR actor_type = $1) AND ($2::text IS NULL OR action LIKE $2 || '%')
          AND ($3::text IS NULL OR entity_type = $3) AND ($4::text IS NULL OR entity_id = $4)
          AND ($5::text IS NULL OR summary ILIKE '%' || $5 || '%' OR actor_name ILIKE '%' || $5 || '%')
          AND ($6::bigint IS NULL OR id < $6)
        ORDER BY id DESC LIMIT 100`,
      [actorType || null, action || null, entityType || null, entityId || null, q?.trim() || null, before ? Number(before) : null]
    );
    return { entries: rows, next: rows.length === 100 ? rows[rows.length - 1].id : null };
  }

  /** Recomputes the whole hash chain: proves no past entry was edited or deleted. */
  @Get('audit/verify')
  verify() {
    return this.audit.verifyChain();
  }

  // ---------- Exports ----------

  @Get('export/:kind')
  @AdminRoles('support', 'operations', 'market')
  async export(@Param('kind') kind: string, @Query('roomId') roomId: string | undefined, @Query('days') days: string | undefined, @Res() reply: FastifyReply, @AdminActor() actor: Actor) {
    const d = Math.min(Math.max(Number(days) || 30, 1), 365);
    let rows: Record<string, unknown>[];
    switch (kind) {
      case 'users.csv':
        rows = await this.db.query('SELECT id, role, name, phone, district, cold_room_id, business_name, business_type, status, locked_at IS NOT NULL AS locked, created_at, last_seen_at FROM users ORDER BY created_at');
        break;
      case 'orders.csv':
        rows = await this.db.query('SELECT id, listing_id, buyer_id, farmer_id, crop, quantity, unit, price_per_unit, quantity * price_per_unit AS total, status, created_at, updated_at FROM orders WHERE created_at > now() - make_interval(days => $1) ORDER BY created_at', [d]);
        break;
      case 'certificates.csv':
        rows = await this.db.query(
          `SELECT id, batch_id, issued_at, data->'farmer'->>'name' AS farmer, data->'batch'->>'crop' AS crop, data->'batch'->>'quantity' AS quantity,
                  data->'batch'->>'unit' AS unit, data->'conditions'->>'freshness' AS freshness, data->'conditions'->>'avgTemp' AS avg_temp,
                  data->'conditions'->>'minutesOutOfRange' AS minutes_out_of_range, data->'conditions'->>'minutesNoData' AS minutes_no_data, revoked_at, revoked_reason
             FROM certificates WHERE issued_at > now() - make_interval(days => $1) ORDER BY issued_at`,
          [d]
        );
        break;
      case 'readings.csv':
        if (!roomId) throw new ApiError('roomRequired');
        rows = await this.db.query(
          `SELECT at, chamber, coil_outlet, product, humidity, outside, hot_side, cooler_duty, cooler_current, cooler_voltage, ice_bank, battery, battery_v, solar_v,
                  solar_charging, fan, hot_fan, pump, compressor, door_open, device_alerts
             FROM readings WHERE room_id = $1 AND at > now() - make_interval(days => $2) ORDER BY at`,
          [roomId, Math.min(d, 31)]
        );
        break;
      case 'inventory.csv':
        rows = await this.db.query(
          `SELECT b.code, b.crop, u.name AS farmer, co.name AS cooperative, c.id AS room_id, c.name AS room, b.storage_location, b.initial_quantity, b.quantity AS quantity_now, b.unit,
                  b.harvest_date, b.stored_at, b.status, b.collection_requested_at, b.removed_at
             FROM batches b JOIN users u ON u.id = b.farmer_id JOIN cold_rooms c ON c.id = b.cold_room_id LEFT JOIN cooperatives co ON co.id = b.cooperative_id
            WHERE b.stored_at > now() - make_interval(days => $1) OR b.status = 'stored' ORDER BY b.stored_at`,
          [d]
        );
        break;
      case 'collections.csv':
        rows = await this.db.query(
          `SELECT c.id, b.code AS batch, b.crop, u.name AS farmer, c.room_id, c.quantity, c.unit, c.collected_at, c.collected_by_name, c.kind, c.days, c.rate_rwf, c.charge_rwf, c.payment_status, c.payment_method, c.payment_ref, c.paid_at
             FROM collections c JOIN batches b ON b.id = c.batch_id JOIN users u ON u.id = c.farmer_id WHERE c.collected_at > now() - make_interval(days => $1) ORDER BY c.collected_at`,
          [d]
        );
        break;
      case 'energy.csv': {
        const report = await this.energy.report([7, 30, 90].includes(d) ? d : 30, null);
        rows = report.daily.map((x) => ({ day: x.day, room_id: x.roomId, cooler_wh: x.wh, solar_wh: x.solarWh, battery_min_percent: x.batteryMin, readings: x.readings, simulated_readings: x.simulated }));
        break;
      }
      case 'audit.csv':
        rows = await this.db.query('SELECT id, at, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, ip, hash FROM audit_log WHERE at > now() - make_interval(days => $1) ORDER BY id', [d]);
        break;
      default:
        throw notFound();
    }
    await this.audit.record(actor, { action: 'export', entityType: 'export', entityId: kind, summary: `Exported ${kind} (${rows.length} rows${roomId ? `, room ${roomId}` : ''})` });
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="harvest-hold-${kind.replace('.csv', '')}-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(toCsv(rows));
  }
}
