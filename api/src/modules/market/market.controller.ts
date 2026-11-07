import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ApiError, notAllowed, notFound } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { CurrentUser, Roles, type SessionUser, UserGuard } from '../../common/guards.js';
import { newId } from '../../common/ids.js';
import { CROPS, optionalText, positiveInt } from '../../common/validate.js';
import { listingView, orderView, userView } from '../../common/views.js';
import { AuditService } from '../audit/audit.service.js';
import { CertificatesService } from '../certificates/certificates.service.js';
import { EventsService } from '../events/events.service.js';
import { MediaService } from '../media/media.service.js';
import { NotifyService } from '../notify/notify.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { StorageService } from '../storage/storage.service.js';

/** Other users see a farmer without their phone number until there is an order between them. */
const publicUser = (u: any) => {
  const { phone: _phone, ...rest } = userView(u);
  return rest;
};

@Controller()
@UseGuards(UserGuard)
export class MarketController {
  constructor(
    private db: Database,
    private rooms: RoomsService,
    private certificates: CertificatesService,
    private media: MediaService,
    private notifier: NotifyService,
    private events: EventsService,
    private audit: AuditService,
    private storage: StorageService
  ) {}

  private async listingFull(l: any, photos?: string[]) {
    const [farmer, room, batch] = await Promise.all([
      this.db.one('SELECT * FROM users WHERE id = $1', [l.farmer_id]),
      this.rooms.getRow(l.cold_room_id),
      this.db.one('SELECT * FROM batches WHERE id = $1', [l.batch_id]),
    ]);
    return {
      ...listingView(l),
      photos: photos ?? (await this.media.idsFor('listing', l.id)),
      farmer: publicUser(farmer),
      coldRoom: await this.rooms.view(room),
      freshness: (await this.rooms.summarizeBatch(batch)).freshness,
    };
  }

  private async listingsFull(rows: any[]) {
    const photos = await this.media.idsForMany('listing', rows.map((l) => l.id));
    return Promise.all(rows.map((l) => this.listingFull(l, photos.get(l.id) ?? [])));
  }

  private async orderFull(o: any) {
    const [buyer, farmer, listing] = await Promise.all([
      this.db.one('SELECT * FROM users WHERE id = $1', [o.buyer_id]),
      this.db.one('SELECT * FROM users WHERE id = $1', [o.farmer_id]),
      this.db.one('SELECT cold_room_id FROM listings WHERE id = $1', [o.listing_id]),
    ]);
    return { ...orderView(o), buyer: userView(buyer), farmer: userView(farmer), coldRoom: await this.rooms.view(await this.rooms.getRow(listing.cold_room_id)) };
  }

  private actor(u: SessionUser, req: FastifyRequest) {
    return { type: 'user' as const, id: u.id, name: u.business_name ?? u.name, ip: req.ip };
  }

  /** The market: active listings that moderators have not hidden, from active farmers. */
  @Get('listings')
  async browse(@Query('crop') crop?: string, @Query('district') district?: string) {
    const rows = await this.db.query(
      `SELECT l.* FROM listings l JOIN cold_rooms c ON c.id = l.cold_room_id JOIN users u ON u.id = l.farmer_id
        WHERE l.status = 'active' AND l.quantity > 0 AND l.moderation = 'visible' AND u.status = 'active'
          AND ($1::text IS NULL OR l.crop = $1) AND ($2::text IS NULL OR c.district = $2)
        ORDER BY l.created_at DESC LIMIT 200`,
      [CROPS.includes(crop as any) ? crop : null, district || null]
    );
    return this.listingsFull(rows);
  }

  @Get('listings/:id')
  async listing(@Param('id') id: string, @CurrentUser() u: SessionUser) {
    const l = await this.db.one('SELECT * FROM listings WHERE id = $1', [id]);
    // A hidden listing is still visible to its farmer, who can see why it was hidden.
    if (!l || (l.moderation === 'hidden' && l.farmer_id !== u.id)) throw notFound();
    const full = await this.listingFull(l);
    // Buyers may contact the seller: name and phone are shown on the listing itself (not in the list).
    const seller = u.role === 'buyer' ? await this.db.one('SELECT name, phone FROM users WHERE id = $1', [l.farmer_id]) : null;
    return {
      ...full,
      contact: seller ? { name: seller.name, phone: seller.phone } : undefined,
      moderation: l.moderation,
      moderationReason: l.farmer_id === u.id ? l.moderation_reason : undefined,
    };
  }

  @Get('my/listings')
  @Roles('farmer')
  async mine(@CurrentUser() u: SessionUser) {
    const rows = await this.db.query('SELECT * FROM listings WHERE farmer_id = $1 ORDER BY created_at DESC', [u.id]);
    const full = await this.listingsFull(rows);
    return full.map((l, i) => ({ ...l, moderation: rows[i].moderation, moderationReason: rows[i].moderation_reason }));
  }

  @Post('listings')
  @HttpCode(200)
  @Roles('farmer')
  async create(@Body() b: any, @CurrentUser() u: SessionUser, @Req() req: FastifyRequest) {
    b ??= {};
    const quantity = positiveInt(b.quantity, 'invalidQuantity', 100_000);
    const price = positiveInt(b.pricePerUnit, 'invalidPrice', 100_000_000);
    const listing = await this.db.tx((db) => this.storage.listBatch(db, String(b.batchId ?? ''), quantity, price, u.id));
    // Buyers should always find a certificate on a listing.
    if (!(await this.certificates.latest(listing.batch_id))) await this.certificates.issue(listing.batch_id);
    await this.audit.record(this.actor(u, req), {
      action: 'listing.create',
      entityType: 'listing',
      entityId: listing.id,
      summary: `${u.name} listed ${quantity} ${listing.unit} of ${listing.crop} at ${price} RWF`,
      after: listingView(listing),
    });
    return listingView(listing);
  }

  @Patch('listings/:id')
  @Roles('farmer')
  async update(@Param('id') id: string, @Body() b: any, @CurrentUser() u: SessionUser, @Req() req: FastifyRequest) {
    b ??= {};
    const { before, after } = await this.db.tx(async (db) => {
      const l = await this.db.one('SELECT * FROM listings WHERE id = $1 FOR UPDATE', [id], db);
      if (!l) throw notFound();
      if (l.farmer_id !== u.id) throw notAllowed();
      if (b.pricePerUnit !== undefined) {
        await this.db.query('UPDATE listings SET price_per_unit = $2 WHERE id = $1', [l.id, positiveInt(b.pricePerUnit, 'invalidPrice', 100_000_000)], db);
      }
      if (b.status !== undefined) {
        if (b.status !== 'active' && b.status !== 'paused') throw new ApiError('notAllowed');
        if (l.status === 'soldOut') throw new ApiError('soldOut');
        const batch = await this.db.one('SELECT status FROM batches WHERE id = $1', [l.batch_id], db);
        if (b.status === 'active' && batch?.status !== 'stored') throw new ApiError('notInColdRoom');
        await this.db.query('UPDATE listings SET status = $2 WHERE id = $1', [l.id, b.status], db);
      }
      return { before: l, after: await this.db.one('SELECT * FROM listings WHERE id = $1', [id], db) };
    });
    await this.audit.record(this.actor(u, req), {
      action: 'listing.update',
      entityType: 'listing',
      entityId: id,
      summary: `${u.name} changed listing ${id}`,
      before: { status: before.status, pricePerUnit: before.price_per_unit },
      after: { status: after.status, pricePerUnit: after.price_per_unit },
    });
    return { ok: true };
  }

  @Post('orders')
  @HttpCode(200)
  @Roles('buyer')
  async order(@Body() b: any, @CurrentUser() u: SessionUser, @Req() req: FastifyRequest) {
    b ??= {};
    const quantity = positiveInt(b.quantity, 'invalidQuantity', 100_000);
    const note = optionalText(b.note, 500);
    const { order, listing } = await this.db.tx(async (db) => {
      const listing = await this.db.one('SELECT * FROM listings WHERE id = $1 FOR UPDATE', [b.listingId], db);
      if (!listing || listing.moderation === 'hidden') throw notFound();
      if (listing.status !== 'active') throw new ApiError('listingUnavailable');
      if (quantity > listing.quantity) throw new ApiError('moreThanAvailable');
      const order = await this.db.one(
        'INSERT INTO orders (id, listing_id, buyer_id, farmer_id, crop, quantity, unit, price_per_unit, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
        [newId('o'), listing.id, u.id, listing.farmer_id, listing.crop, quantity, listing.unit, listing.price_per_unit, note],
        db
      );
      return { order, listing };
    });
    await this.notifier.notify(listing.farmer_id, 'orderNew', { buyer: u.business_name ?? u.name, quantity, unit: order.unit, crop: order.crop }, `/order/${order.id}`);
    this.events.publish({ type: 'order', orderId: order.id, status: 'pending' });
    await this.audit.record(this.actor(u, req), {
      action: 'order.place',
      entityType: 'order',
      entityId: order.id,
      summary: `${u.business_name ?? u.name} ordered ${quantity} ${order.unit} of ${order.crop} (${quantity * order.price_per_unit} RWF)`,
      after: orderView(order),
    });
    return orderView(order);
  }

  @Get('orders')
  async orders(@CurrentUser() u: SessionUser) {
    const column = u.role === 'farmer' ? 'farmer_id' : 'buyer_id';
    const rows = await this.db.query(`SELECT * FROM orders WHERE ${column} = $1 ORDER BY updated_at DESC`, [u.id]);
    return Promise.all(rows.map((o) => this.orderFull(o)));
  }

  @Get('orders/:id')
  async getOrder(@Param('id') id: string, @CurrentUser() u: SessionUser) {
    const o = await this.db.one('SELECT * FROM orders WHERE id = $1', [id]);
    if (!o) throw notFound();
    if (o.buyer_id !== u.id && o.farmer_id !== u.id) throw notAllowed();
    return this.orderFull(o);
  }

  /** Accepting takes the quantity off the listing and the stored batch, in one transaction. */
  @Post('orders/:id/respond')
  @HttpCode(200)
  @Roles('farmer')
  async respond(@Param('id') id: string, @Body() b: any, @CurrentUser() u: SessionUser, @Req() req: FastifyRequest) {
    const accept = b?.accept === true;
    const order = await this.db.tx(async (db) => {
      const o = await this.db.one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id], db);
      if (!o) throw notFound();
      if (o.farmer_id !== u.id) throw notAllowed();
      if (o.status !== 'pending') throw new ApiError('orderNotPending');
      if (accept) {
        const l = await this.db.one('SELECT * FROM listings WHERE id = $1 FOR UPDATE', [o.listing_id], db);
        const batch = await this.db.one('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [l.batch_id], db);
        if (o.quantity > l.quantity || o.quantity > batch.quantity) throw new ApiError('moreThanAvailable');
        await this.db.query(
          "UPDATE listings SET quantity = quantity - $2, status = CASE WHEN quantity - $2 = 0 THEN 'soldOut' ELSE status END WHERE id = $1",
          [l.id, o.quantity],
          db
        );
        // The sold quantity leaves the room: the batch, the stock record and the storage charge are updated together.
        const buyer = await this.db.one('SELECT name, business_name FROM users WHERE id = $1', [o.buyer_id], db);
        await this.storage.collectTx(db, {
          batchId: batch.id, quantity: o.quantity, collectedBy: buyer?.business_name ?? buyer?.name ?? 'Buyer',
          by: { id: u.id, name: u.name }, kind: 'sale', orderId: o.id, note: `Order ${o.id}`,
        });
      }
      return this.db.one('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [o.id, accept ? 'accepted' : 'declined'], db);
    });
    await this.notifier.notify(order.buyer_id, accept ? 'orderAccepted' : 'orderDeclined', { farmer: u.name, crop: order.crop }, `/order/${order.id}`);
    this.events.publish({ type: 'order', orderId: order.id, status: order.status });
    await this.audit.record(this.actor(u, req), {
      action: accept ? 'order.accept' : 'order.decline',
      entityType: 'order',
      entityId: order.id,
      summary: `${u.name} ${accept ? 'accepted' : 'declined'} order ${order.id}`,
    });
    return orderView(order);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @Roles('buyer')
  async cancel(@Param('id') id: string, @CurrentUser() u: SessionUser, @Req() req: FastifyRequest) {
    const order = await this.db.tx(async (db) => {
      const o = await this.db.one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id], db);
      if (!o) throw notFound();
      if (o.buyer_id !== u.id) throw notAllowed();
      if (o.status !== 'pending') throw new ApiError('orderNotPending');
      return this.db.one("UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *", [o.id], db);
    });
    await this.notifier.notify(order.farmer_id, 'orderCancelled', { buyer: u.business_name ?? u.name, crop: order.crop }, `/order/${order.id}`);
    this.events.publish({ type: 'order', orderId: order.id, status: 'cancelled' });
    await this.audit.record(this.actor(u, req), { action: 'order.cancel', entityType: 'order', entityId: order.id, summary: `${u.business_name ?? u.name} cancelled order ${order.id}` });
    return orderView(order);
  }
}
