import crypto from 'node:crypto';

import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { ApiError, notFound } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { text } from '../../common/validate.js';
import { alertView, batchView, listingView, orderView } from '../../common/views.js';
import { type Actor, AuditService } from '../audit/audit.service.js';
import { isDistrict } from '../auth/auth.controller.js';
import { hashPin } from '../auth/user-auth.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { AdminActor, AdminGuard, AdminRoles } from './admin.guard.js';

/** A 4-digit PIN that passes the app's "too simple" rule. */
export function temporaryPin(): string {
  for (;;) {
    const p = String(crypto.randomInt(0, 10_000)).padStart(4, '0');
    if (!/^(\d)\1{3}$/.test(p) && !['1234', '4321', '0123', '9876'].includes(p)) return p;
  }
}

function person(u: any) {
  return {
    id: u.id, role: u.role, name: u.name, phone: u.phone, district: u.district, lang: u.lang,
    coldRoomId: u.cold_room_id, businessName: u.business_name, businessType: u.business_type,
    status: u.status, statusReason: u.status_reason, locked: !!u.locked_at, lockedAt: u.locked_at, failedPinAttempts: u.failed_pin_attempts,
    photoId: u.photo_id, createdAt: u.created_at, lastSeenAt: u.last_seen_at,
  };
}

@Controller('admin/users')
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(
    private db: Database,
    private rooms: RoomsService,
    private audit: AuditService
  ) {}

  private async get(id: string) {
    const u = await this.db.one('SELECT * FROM users WHERE id = $1', [id]);
    if (!u) throw notFound();
    return u;
  }

  @Get()
  async list(@Query('role') role?: string, @Query('status') status?: string, @Query('q') q?: string, @Query('roomId') roomId?: string) {
    const like = q?.trim() ? `%${q.trim().replace(/[%_\\]/g, '\\$&')}%` : null;
    const rows = await this.db.query(
      `SELECT u.*, c.name AS room_name,
              (SELECT count(*) FROM batches b WHERE b.farmer_id = u.id AND b.status = 'stored') AS stored_batches,
              (SELECT count(*) FROM orders o WHERE (o.farmer_id = u.id OR o.buyer_id = u.id)) AS orders,
              (SELECT coalesce(sum(o.quantity * o.price_per_unit), 0) FROM orders o WHERE (o.farmer_id = u.id OR o.buyer_id = u.id) AND o.status = 'accepted') AS gmv
         FROM users u LEFT JOIN cold_rooms c ON c.id = u.cold_room_id
        WHERE ($1::text IS NULL OR u.role = $1)
          AND ($2::text IS NULL OR ($2 = 'locked' AND u.locked_at IS NOT NULL) OR ($2 = 'suspended' AND u.status = 'suspended') OR ($2 = 'active' AND u.status = 'active' AND u.locked_at IS NULL))
          AND ($3::text IS NULL OR u.name ILIKE $3 OR u.business_name ILIKE $3 OR u.phone ILIKE $3 OR u.district ILIKE $3)
          AND ($4::text IS NULL OR u.cold_room_id = $4)
        ORDER BY u.locked_at IS NULL, u.created_at DESC LIMIT 500`,
      [role || null, status || null, like, roomId || null]
    );
    return rows.map((u) => ({ ...person(u), roomName: u.room_name, storedBatches: u.stored_batches, orders: u.orders, gmv: u.gmv }));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const u = await this.get(id);
    const [batches, listings, orders, certificates, alerts, audit, sessions, room] = await Promise.all([
      this.db.query('SELECT * FROM batches WHERE farmer_id = $1 ORDER BY stored_at DESC LIMIT 100', [id]),
      this.db.query('SELECT * FROM listings WHERE farmer_id = $1 ORDER BY created_at DESC LIMIT 100', [id]),
      this.db.query('SELECT * FROM orders WHERE farmer_id = $1 OR buyer_id = $1 ORDER BY created_at DESC LIMIT 100', [id]),
      this.db.query("SELECT c.id, c.issued_at, c.revoked_at, c.data->'conditions'->>'freshness' AS freshness, c.data->'batch'->>'crop' AS crop FROM certificates c JOIN batches b ON b.id = c.batch_id WHERE b.farmer_id = $1 ORDER BY c.issued_at DESC LIMIT 50", [id]),
      this.db.query('SELECT * FROM alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [id]),
      this.db.query("SELECT * FROM audit_log WHERE (entity_type = 'user' AND entity_id = $1) OR (actor_type = 'user' AND actor_id = $1) ORDER BY id DESC LIMIT 100", [id]),
      this.db.one('SELECT count(*) AS n, max(created_at) AS last FROM sessions WHERE user_id = $1 AND expires_at > now()', [id]),
      u.cold_room_id ? this.db.one('SELECT id, name, district FROM cold_rooms WHERE id = $1', [u.cold_room_id]) : null,
    ]);
    const stock = await Promise.all(
      batches.map(async (b) => ({ ...batchView(b), freshness: b.status === 'stored' ? (await this.rooms.summarizeBatch(b)).freshness : null }))
    );
    return {
      user: person(u),
      room,
      stock,
      listings: listings.map((l) => ({ ...listingView(l), moderation: l.moderation })),
      orders: orders.map(orderView),
      certificates,
      alerts: alerts.map(alertView),
      audit,
      sessions: { active: sessions!.n, lastSignIn: sessions!.last },
    };
  }

  @Patch(':id')
  @AdminRoles('support')
  async update(@Param('id') id: string, @Body() b: any, @AdminActor() actor: Actor) {
    const u = await this.get(id);
    b ??= {};
    const name = b.name !== undefined ? text(b.name, 'nameRequired', { min: 2, max: 80 }) : u.name;
    if (b.district !== undefined && !isDistrict(b.district)) throw new ApiError('districtRequired');
    const district = b.district ?? u.district;
    let coldRoomId = u.cold_room_id;
    if (u.role === 'farmer' && b.coldRoomId !== undefined && b.coldRoomId !== u.cold_room_id) {
      if (!(await this.db.one("SELECT 1 FROM cold_rooms WHERE id = $1 AND status <> 'retired'", [b.coldRoomId]))) throw new ApiError('coldRoomRequired');
      // Stock stays in the room it is in; only new check-ins go to the new room.
      coldRoomId = b.coldRoomId;
    }
    const businessName = u.role === 'buyer' && b.businessName !== undefined ? text(b.businessName, 'businessRequired', { min: 2, max: 120 }) : u.business_name;
    await this.db.query('UPDATE users SET name = $2, district = $3, cold_room_id = $4, business_name = $5 WHERE id = $1', [id, name, district, coldRoomId, businessName]);
    await this.audit.record(actor, {
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      summary: `Edited ${u.name}'s profile`,
      before: { name: u.name, district: u.district, coldRoomId: u.cold_room_id, businessName: u.business_name },
      after: { name, district, coldRoomId, businessName },
    });
    return { ok: true };
  }

  /** Reactivates an account locked after too many wrong PINs (after checking the caller's identity). */
  @Post(':id/unlock')
  @HttpCode(200)
  @AdminRoles('support')
  async unlock(@Param('id') id: string, @Body() b: any, @AdminActor() actor: Actor) {
    const u = await this.get(id);
    const how = text(b?.verification, 'verificationRequired', { min: 3, max: 300 });
    await this.db.query('UPDATE users SET locked_at = NULL, failed_pin_attempts = 0 WHERE id = $1', [id]);
    await this.audit.record(actor, { action: 'user.unlock', entityType: 'user', entityId: id, summary: `Unlocked ${u.name}'s account. Identity checked: ${how}` });
    return { ok: true };
  }

  /**
   * New PIN for someone who forgot theirs. Shown once to the staff member, who reads it to the
   * person after checking their identity. Also unlocks the account and signs out old sessions.
   */
  @Post(':id/reset-pin')
  @HttpCode(200)
  @AdminRoles('support')
  async resetPin(@Param('id') id: string, @Body() b: any, @AdminActor() actor: Actor) {
    const u = await this.get(id);
    const how = text(b?.verification, 'verificationRequired', { min: 3, max: 300 });
    const pin = temporaryPin();
    await this.db.tx(async (db) => {
      await this.db.query('UPDATE users SET pin_hash = $2, locked_at = NULL, failed_pin_attempts = 0 WHERE id = $1', [id, await hashPin(pin)], db);
      await this.db.query('DELETE FROM sessions WHERE user_id = $1', [id], db);
    });
    await this.audit.record(actor, { action: 'user.resetPin', entityType: 'user', entityId: id, summary: `Reset ${u.name}'s PIN and signed out their phones. Identity checked: ${how}` });
    return { pin };
  }

  /** Suspends an account: signed out everywhere, cannot sign in, listings leave the market. */
  @Post(':id/suspend')
  @HttpCode(200)
  @AdminRoles('support')
  async suspend(@Param('id') id: string, @Body() b: any, @AdminActor() actor: Actor) {
    const u = await this.get(id);
    const reason = text(b?.reason, 'reasonRequired', { min: 5, max: 500 });
    await this.db.tx(async (db) => {
      await this.db.query("UPDATE users SET status = 'suspended', status_reason = $2 WHERE id = $1", [id, reason], db);
      await this.db.query('DELETE FROM sessions WHERE user_id = $1', [id], db);
    });
    await this.audit.record(actor, { action: 'user.suspend', entityType: 'user', entityId: id, summary: `Suspended ${u.name}: ${reason}`, before: { status: u.status }, after: { status: 'suspended' } });
    return { ok: true };
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @AdminRoles('support')
  async reactivate(@Param('id') id: string, @Body() b: any, @AdminActor() actor: Actor) {
    const u = await this.get(id);
    const reason = text(b?.reason, 'reasonRequired', { min: 5, max: 500 });
    await this.db.query("UPDATE users SET status = 'active', status_reason = NULL WHERE id = $1", [id]);
    await this.audit.record(actor, { action: 'user.reactivate', entityType: 'user', entityId: id, summary: `Reactivated ${u.name}: ${reason}`, before: { status: u.status }, after: { status: 'active' } });
    return { ok: true };
  }

  /** Signs the person out on every phone (e.g. a lost phone). */
  @Post(':id/sign-out')
  @HttpCode(200)
  @AdminRoles('support')
  async signOut(@Param('id') id: string, @AdminActor() actor: Actor) {
    const u = await this.get(id);
    const n = (await this.db.query('DELETE FROM sessions WHERE user_id = $1 RETURNING 1', [id])).length;
    await this.audit.record(actor, { action: 'user.signOut', entityType: 'user', entityId: id, summary: `Signed ${u.name} out of ${n} phone(s)` });
    return { ok: true, sessions: n };
  }
}
