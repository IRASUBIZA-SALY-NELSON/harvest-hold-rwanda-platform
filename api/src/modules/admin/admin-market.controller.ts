import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { ApiError, notFound } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { text } from '../../common/validate.js';
import { listingView, orderView } from '../../common/views.js';
import { type Actor, AuditService } from '../audit/audit.service.js';
import { SigningService } from '../certificates/signing.service.js';
import { MediaService } from '../media/media.service.js';
import { NotifyService } from '../notify/notify.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { AdminActor, AdminGuard, AdminRoles } from './admin.guard.js';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminMarketController {
  constructor(
    private db: Database,
    private rooms: RoomsService,
    private media: MediaService,
    private signing: SigningService,
    private notifier: NotifyService,
    private audit: AuditService
  ) {}

  // ---------- Listings ----------

  @Get('listings')
  async listings(@Query('status') status?: string, @Query('moderation') moderation?: string, @Query('q') q?: string) {
    const like = q?.trim() ? `%${q.trim()}%` : null;
    const rows = await this.db.query(
      `SELECT l.*, u.name AS farmer_name, u.status AS farmer_status, c.name AS room_name, c.district,
              (SELECT count(*) FROM orders o WHERE o.listing_id = l.id) AS orders
         FROM listings l JOIN users u ON u.id = l.farmer_id JOIN cold_rooms c ON c.id = l.cold_room_id
        WHERE ($1::text IS NULL OR l.status = $1) AND ($2::text IS NULL OR l.moderation = $2)
          AND ($3::text IS NULL OR u.name ILIKE $3 OR l.crop ILIKE $3 OR l.id ILIKE $3)
        ORDER BY l.created_at DESC LIMIT 500`,
      [status || null, moderation || null, like]
    );
    const photos = await this.media.idsForMany('listing', rows.map((l) => l.id));
    return Promise.all(
      rows.map(async (l) => {
        const batch = await this.db.one('SELECT * FROM batches WHERE id = $1', [l.batch_id]);
        return {
          ...listingView(l),
          moderation: l.moderation,
          moderationReason: l.moderation_reason,
          farmerName: l.farmer_name,
          farmerStatus: l.farmer_status,
          roomName: l.room_name,
          district: l.district,
          orders: l.orders,
          photos: photos.get(l.id) ?? [],
          freshness: batch ? (await this.rooms.summarizeBatch(batch)).freshness : null,
        };
      })
    );
  }

  /** Takes a listing off the market (it stays visible to its farmer, with the reason). */
  @Post('listings/:id/hide')
  @HttpCode(200)
  @AdminRoles('market')
  async hide(@Param('id') id: string, @Body() b: any, @AdminActor() actor: Actor) {
    const reason = text(b?.reason, 'reasonRequired', { min: 5, max: 500 });
    const l = await this.db.one("UPDATE listings SET moderation = 'hidden', moderation_reason = $2 WHERE id = $1 RETURNING *", [id, reason]);
    if (!l) throw notFound();
    await this.audit.record(actor, { action: 'listing.hide', entityType: 'listing', entityId: id, summary: `Hid listing ${id} (${l.crop}) from the market: ${reason}` });
    return { ok: true };
  }

  @Post('listings/:id/unhide')
  @HttpCode(200)
  @AdminRoles('market')
  async unhide(@Param('id') id: string, @AdminActor() actor: Actor) {
    const l = await this.db.one("UPDATE listings SET moderation = 'visible', moderation_reason = NULL WHERE id = $1 RETURNING *", [id]);
    if (!l) throw notFound();
    await this.audit.record(actor, { action: 'listing.unhide', entityType: 'listing', entityId: id, summary: `Put listing ${id} (${l.crop}) back on the market` });
    return { ok: true };
  }

  // ---------- Orders ----------

  @Get('orders')
  async orders(@Query('status') status?: string) {
    const rows = await this.db.query(
      `SELECT o.*, b.name AS buyer_name, b.business_name, f.name AS farmer_name
         FROM orders o JOIN users b ON b.id = o.buyer_id JOIN users f ON f.id = o.farmer_id
        WHERE ($1::text IS NULL OR o.status = $1) ORDER BY o.created_at DESC LIMIT 500`,
      [status || null]
    );
    return rows.map((o) => ({ ...orderView(o), buyerName: o.business_name ?? o.buyer_name, farmerName: o.farmer_name, total: o.quantity * o.price_per_unit }));
  }

  // ---------- Stock ----------

  @Get('batches')
  async batches(@Query('status') status?: string, @Query('roomId') roomId?: string) {
    const rows = await this.db.query(
      `SELECT b.*, u.name AS farmer_name, c.name AS room_name FROM batches b JOIN users u ON u.id = b.farmer_id JOIN cold_rooms c ON c.id = b.cold_room_id
        WHERE ($1::text IS NULL OR b.status = $1) AND ($2::text IS NULL OR b.cold_room_id = $2) ORDER BY b.stored_at DESC LIMIT 500`,
      [status || null, roomId || null]
    );
    const photos = await this.media.idsForMany('checkin', rows.map((b) => b.id));
    return Promise.all(
      rows.map(async (b) => {
        const c = await this.rooms.summarizeBatch(b);
        return {
          id: b.id, crop: b.crop, quantity: b.quantity, unit: b.unit, status: b.status, storedAt: b.stored_at, removedAt: b.removed_at,
          farmerId: b.farmer_id, farmerName: b.farmer_name, roomId: b.cold_room_id, roomName: b.room_name,
          freshness: c.freshness, minutesOutOfRange: c.minutesOutOfRange, minutesNoData: c.minutesNoData, hoursStored: c.hoursStored,
          photos: photos.get(b.id) ?? [],
        };
      })
    );
  }

  // ---------- Certificates ----------

  @Get('certificates')
  async certificates(@Query('freshness') freshness?: string, @Query('state') state?: string, @Query('q') q?: string) {
    const like = q?.trim() ? `%${q.trim()}%` : null;
    const rows = await this.db.query(
      `SELECT c.id, c.batch_id, c.issued_at, c.revoked_at, c.revoked_reason, c.signature IS NOT NULL AS signed,
              c.data->'conditions'->>'freshness' AS freshness, c.data->'batch'->>'crop' AS crop,
              (c.data->'batch'->>'quantity')::int AS quantity, c.data->'batch'->>'unit' AS unit,
              c.data->'farmer'->>'name' AS farmer, c.data->'coldRoom'->>'name' AS room,
              (c.data->'conditions'->>'avgTemp')::real AS avg_temp, jsonb_array_length(coalesce(c.data->'photos', '[]')) AS photos
         FROM certificates c
        WHERE ($1::text IS NULL OR c.data->'conditions'->>'freshness' = $1)
          AND ($2::text IS NULL OR ($2 = 'revoked' AND c.revoked_at IS NOT NULL) OR ($2 = 'valid' AND c.revoked_at IS NULL))
          AND ($3::text IS NULL OR c.id ILIKE $3 OR c.data->'farmer'->>'name' ILIKE $3)
        ORDER BY c.issued_at DESC LIMIT 500`,
      [freshness || null, state || null, like]
    );
    return rows;
  }

  /** Full certificate with a live signature check and how the crop is doing now. */
  @Get('certificates/:id')
  async certificate(@Param('id') id: string) {
    const row = await this.db.one(
      `SELECT c.*, a.name AS revoked_by_name, b.status AS batch_status, b.quantity AS batch_quantity
         FROM certificates c JOIN batches b ON b.id = c.batch_id LEFT JOIN admins a ON a.id = c.revoked_by WHERE c.id = $1`,
      [id.toUpperCase()]
    );
    if (!row) throw notFound();
    const batch = await this.db.one('SELECT * FROM batches WHERE id = $1', [row.batch_id]);
    const now = await this.rooms.summarizeBatch(batch);
    const history = await this.db.query('SELECT id, issued_at, revoked_at, data->\'conditions\'->>\'freshness\' AS freshness FROM certificates WHERE batch_id = $1 ORDER BY issued_at DESC', [row.batch_id]);
    return {
      data: row.data,
      signature: row.signature,
      keyId: row.key_id,
      signatureValid: this.signing.verify(row.data, row.signature),
      revokedAt: row.revoked_at,
      revokedReason: row.revoked_reason,
      revokedBy: row.revoked_by_name,
      batchNow: { status: row.batch_status, quantity: row.batch_quantity, freshness: now.freshness, minutesOutOfRange: now.minutesOutOfRange, minutesNoData: now.minutesNoData },
      otherCertificates: history.filter((h) => h.id !== row.id),
    };
  }

  /**
   * Revokes a certificate (e.g. issued for crops that were found damaged). The public check page
   * then says "Revoked" with the reason, and the farmer is told.
   */
  @Post('certificates/:id/revoke')
  @HttpCode(200)
  @AdminRoles('market')
  async revoke(@Param('id') id: string, @Body() b: any, @AdminActor() actor: Actor) {
    const reason = text(b?.reason, 'reasonRequired', { min: 10, max: 500 });
    const row = await this.db.one('UPDATE certificates SET revoked_at = now(), revoked_reason = $2, revoked_by = $3 WHERE id = $1 AND revoked_at IS NULL RETURNING *', [id.toUpperCase(), reason, actor.id]);
    if (!row) throw new ApiError('alreadyRevokedOrMissing', 404);
    await this.audit.record(actor, { action: 'certificate.revoke', entityType: 'certificate', entityId: row.id, summary: `Revoked certificate ${row.id}: ${reason}` });
    await this.notifier.notify(row.data.farmer.id, 'certificateRevoked', { id: row.id, reason });
    return { ok: true };
  }

  // ---------- Photos ----------

  /** Newest photos first: the moderation queue. */
  @Get('photos')
  async photos(@Query('status') status?: string, @Query('kind') kind?: string) {
    return this.db.query(
      `SELECT p.*, u.name AS owner_name, u.role AS owner_role FROM photos p JOIN users u ON u.id = p.owner_id
        WHERE ($1::text IS NULL OR p.status = $1) AND ($2::text IS NULL OR p.kind = $2)
        ORDER BY p.created_at DESC LIMIT 300`,
      [status || null, kind || null]
    );
  }

  /** Staff can see a photo even after it was removed (to review the decision). */
  @Get('photos/:id/file')
  async file(@Param('id') id: string, @Query('size') size: string, @Res() reply: FastifyReply) {
    if (!this.media.isValidId(id)) throw notFound();
    const data = await this.media.read(id, size === 'thumb' ? 'thumb' : 'full');
    if (!data) throw notFound();
    return reply.type('image/webp').header('Cache-Control', 'private, max-age=600').send(data);
  }

  @Post('photos/:id/remove')
  @HttpCode(200)
  @AdminRoles('market')
  async removePhoto(@Param('id') id: string, @Body() b: any, @AdminActor() actor: Actor) {
    const reason = text(b?.reason, 'reasonRequired', { min: 5, max: 500 });
    const p = await this.media.remove(id, actor.id!, reason);
    if (!p) throw notFound();
    if (p.kind === 'profile') await this.db.query('UPDATE users SET photo_id = NULL WHERE id = $1 AND photo_id = $2', [p.owner_id, id]);
    await this.audit.record(actor, { action: 'photo.remove', entityType: 'photo', entityId: id, summary: `Removed a ${p.kind} photo by ${p.owner_id}: ${reason}` });
    return { ok: true };
  }

  @Post('photos/:id/restore')
  @HttpCode(200)
  @AdminRoles('market')
  async restorePhoto(@Param('id') id: string, @AdminActor() actor: Actor) {
    const p = await this.media.restore(id);
    if (!p) throw notFound();
    if (p.kind === 'profile') await this.db.query('UPDATE users SET photo_id = $2 WHERE id = $1', [p.owner_id, id]);
    await this.audit.record(actor, { action: 'photo.restore', entityType: 'photo', entityId: id, summary: `Restored a ${p.kind} photo` });
    return { ok: true };
  }
}
