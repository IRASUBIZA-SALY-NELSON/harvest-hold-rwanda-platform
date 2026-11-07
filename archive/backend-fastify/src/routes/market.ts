import type { FastifyInstance } from 'fastify';

import { requireRole, requireUser } from '../auth.js';
import { issueCertificate, latestCertificate } from '../certificates.js';
import { one, query, tx } from '../db.js';
import { ApiError, notAllowed, notFound } from '../errors.js';
import { newId } from '../ids.js';
import { notify } from '../notify.js';
import { getRoomRow, roomView, summarizeBatch } from '../rooms.js';
import { body, CROPS, optionalText, positiveInt } from '../validate.js';
import { listingView, orderView, userView } from '../views.js';

/** Other users see a farmer without their phone number until there is an order between them. */
const publicUser = (u: any) => {
  const { phone: _phone, ...rest } = userView(u);
  return rest;
};

async function listingFull(l: any) {
  const [farmer, room, batch] = await Promise.all([
    one('SELECT * FROM users WHERE id = $1', [l.farmer_id]),
    getRoomRow(l.cold_room_id),
    one('SELECT * FROM batches WHERE id = $1', [l.batch_id]),
  ]);
  return { ...listingView(l), farmer: publicUser(farmer), coldRoom: await roomView(room), freshness: (await summarizeBatch(batch)).freshness };
}

async function orderFull(o: any) {
  const [buyer, farmer, listing] = await Promise.all([
    one('SELECT * FROM users WHERE id = $1', [o.buyer_id]),
    one('SELECT * FROM users WHERE id = $1', [o.farmer_id]),
    one('SELECT cold_room_id FROM listings WHERE id = $1', [o.listing_id]),
  ]);
  return { ...orderView(o), buyer: userView(buyer), farmer: userView(farmer), coldRoom: await roomView(await getRoomRow(listing.cold_room_id)) };
}

export async function marketRoutes(app: FastifyInstance) {
  const farmer = { preHandler: requireRole('farmer') };
  const buyer = { preHandler: requireRole('buyer') };
  const signedIn = { preHandler: requireUser };

  app.get<{ Querystring: { crop?: string; district?: string } }>('/listings', signedIn, async (req) => {
    const crop = CROPS.includes(req.query.crop as any) ? req.query.crop : null;
    const rows = await query(
      `SELECT l.* FROM listings l JOIN cold_rooms c ON c.id = l.cold_room_id
        WHERE l.status = 'active' AND l.quantity > 0
          AND ($1::text IS NULL OR l.crop = $1) AND ($2::text IS NULL OR c.district = $2)
        ORDER BY l.created_at DESC LIMIT 200`,
      [crop, req.query.district || null]
    );
    return Promise.all(rows.map(listingFull));
  });

  app.get<{ Params: { id: string } }>('/listings/:id', signedIn, async (req) => {
    const l = await one('SELECT * FROM listings WHERE id = $1', [req.params.id]);
    if (!l) throw notFound();
    return listingFull(l);
  });

  app.get('/my/listings', farmer, async (req) => {
    const rows = await query('SELECT * FROM listings WHERE farmer_id = $1 ORDER BY created_at DESC', [req.user!.id]);
    return Promise.all(rows.map(listingFull));
  });

  app.post('/listings', farmer, async (req) => {
    const b = body(req);
    const quantity = positiveInt(b.quantity, 'invalidQuantity', 100_000);
    const price = positiveInt(b.pricePerUnit, 'invalidPrice', 100_000_000);
    const listing = await tx(async (db) => {
      const batch = await one('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [b.batchId], db);
      if (!batch) throw notFound();
      if (batch.farmer_id !== req.user!.id) throw notAllowed();
      if (batch.status !== 'stored') throw new ApiError('notInColdRoom');
      if (quantity > batch.quantity) throw new ApiError('moreThanStock');
      if (await one("SELECT 1 FROM listings WHERE batch_id = $1 AND status <> 'soldOut'", [batch.id], db)) throw new ApiError('alreadyListed');
      return one(
        'INSERT INTO listings (id, batch_id, farmer_id, cold_room_id, crop, quantity, unit, price_per_unit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
        [newId('l'), batch.id, batch.farmer_id, batch.cold_room_id, batch.crop, quantity, batch.unit, price],
        db
      );
    });
    // Buyers should always find a certificate on a listing.
    if (!(await latestCertificate(listing.batch_id))) await issueCertificate(listing.batch_id);
    return listingView(listing);
  });

  app.patch<{ Params: { id: string } }>('/listings/:id', farmer, async (req) => {
    const b = body(req);
    await tx(async (db) => {
      const l = await one('SELECT * FROM listings WHERE id = $1 FOR UPDATE', [req.params.id], db);
      if (!l) throw notFound();
      if (l.farmer_id !== req.user!.id) throw notAllowed();
      if (b.pricePerUnit !== undefined) {
        await query('UPDATE listings SET price_per_unit = $2 WHERE id = $1', [l.id, positiveInt(b.pricePerUnit, 'invalidPrice', 100_000_000)], db);
      }
      if (b.status !== undefined) {
        if (b.status !== 'active' && b.status !== 'paused') throw new ApiError('notAllowed');
        if (l.status === 'soldOut') throw new ApiError('soldOut');
        const batch = await one('SELECT status FROM batches WHERE id = $1', [l.batch_id], db);
        if (b.status === 'active' && batch?.status !== 'stored') throw new ApiError('notInColdRoom');
        await query('UPDATE listings SET status = $2 WHERE id = $1', [l.id, b.status], db);
      }
    });
    return { ok: true };
  });

  app.post('/orders', buyer, async (req) => {
    const b = body(req);
    const quantity = positiveInt(b.quantity, 'invalidQuantity', 100_000);
    const note = optionalText(b.note, 500);
    const { order, listing } = await tx(async (db) => {
      const listing = await one('SELECT * FROM listings WHERE id = $1 FOR UPDATE', [b.listingId], db);
      if (!listing) throw notFound();
      if (listing.status !== 'active') throw new ApiError('listingUnavailable');
      if (quantity > listing.quantity) throw new ApiError('moreThanAvailable');
      const order = await one(
        'INSERT INTO orders (id, listing_id, buyer_id, farmer_id, crop, quantity, unit, price_per_unit, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
        [newId('o'), listing.id, req.user!.id, listing.farmer_id, listing.crop, quantity, listing.unit, listing.price_per_unit, note],
        db
      );
      return { order, listing };
    });
    await notify(listing.farmer_id, 'orderNew', { buyer: req.user!.business_name ?? req.user!.name, quantity, unit: order.unit, crop: order.crop }, `/order/${order.id}`);
    return orderView(order);
  });

  app.get('/orders', signedIn, async (req) => {
    const column = req.user!.role === 'farmer' ? 'farmer_id' : 'buyer_id';
    const rows = await query(`SELECT * FROM orders WHERE ${column} = $1 ORDER BY updated_at DESC`, [req.user!.id]);
    return Promise.all(rows.map(orderFull));
  });

  app.get<{ Params: { id: string } }>('/orders/:id', signedIn, async (req) => {
    const o = await one('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!o) throw notFound();
    if (o.buyer_id !== req.user!.id && o.farmer_id !== req.user!.id) throw notAllowed();
    return orderFull(o);
  });

  /** Accepting takes the quantity off the listing and the stored batch, in one transaction. */
  app.post<{ Params: { id: string } }>('/orders/:id/respond', farmer, async (req) => {
    const accept = body(req).accept === true;
    const order = await tx(async (db) => {
      const o = await one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [req.params.id], db);
      if (!o) throw notFound();
      if (o.farmer_id !== req.user!.id) throw notAllowed();
      if (o.status !== 'pending') throw new ApiError('orderNotPending');
      if (accept) {
        const l = await one('SELECT * FROM listings WHERE id = $1 FOR UPDATE', [o.listing_id], db);
        const batch = await one('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [l.batch_id], db);
        if (o.quantity > l.quantity || o.quantity > batch.quantity) throw new ApiError('moreThanAvailable');
        await query(
          "UPDATE listings SET quantity = quantity - $2, status = CASE WHEN quantity - $2 = 0 THEN 'soldOut' ELSE status END WHERE id = $1",
          [l.id, o.quantity],
          db
        );
        await query(
          "UPDATE batches SET quantity = quantity - $2, status = CASE WHEN quantity - $2 = 0 THEN 'removed' ELSE status END, removed_at = CASE WHEN quantity - $2 = 0 THEN now() ELSE removed_at END WHERE id = $1",
          [batch.id, o.quantity],
          db
        );
      }
      return one("UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *", [o.id, accept ? 'accepted' : 'declined'], db);
    });
    await notify(order.buyer_id, accept ? 'orderAccepted' : 'orderDeclined', { farmer: req.user!.name, crop: order.crop }, `/order/${order.id}`);
    return orderView(order);
  });

  app.post<{ Params: { id: string } }>('/orders/:id/cancel', buyer, async (req) => {
    const order = await tx(async (db) => {
      const o = await one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [req.params.id], db);
      if (!o) throw notFound();
      if (o.buyer_id !== req.user!.id) throw notAllowed();
      if (o.status !== 'pending') throw new ApiError('orderNotPending');
      return one("UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *", [o.id], db);
    });
    await notify(order.farmer_id, 'orderCancelled', { buyer: req.user!.business_name ?? req.user!.name, crop: order.crop }, `/order/${order.id}`);
    return orderView(order);
  });
}
