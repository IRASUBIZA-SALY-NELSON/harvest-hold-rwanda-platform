import type { FastifyInstance } from 'fastify';

import { requireRole, requireUser } from '../auth.js';
import { issueCertificate, latestCertificate } from '../certificates.js';
import { canShareRoom, getProfile } from '../crops.js';
import { one, query, tx } from '../db.js';
import { ApiError, notAllowed, notFound } from '../errors.js';
import { newId } from '../ids.js';
import { getRoomRow, summarizeBatch } from '../rooms.js';
import { body, CROPS, oneOf, positiveInt, UNITS } from '../validate.js';
import { batchView, listingView } from '../views.js';

async function stockItem(batch: any) {
  const listing =
    (await one("SELECT * FROM listings WHERE batch_id = $1 ORDER BY (status = 'soldOut'), created_at DESC LIMIT 1", [batch.id])) ?? null;
  return { batch: batchView(batch), conditions: await summarizeBatch(batch), listing: listing && listingView(listing) };
}

async function ownBatch(farmerId: string, id: string) {
  const batch = await one('SELECT * FROM batches WHERE id = $1', [id]);
  if (!batch) throw notFound();
  if (batch.farmer_id !== farmerId) throw notAllowed();
  return batch;
}

export async function stockRoutes(app: FastifyInstance) {
  const farmer = { preHandler: requireRole('farmer') };

  app.get('/stock', farmer, async (req) => {
    const rows = await query('SELECT * FROM batches WHERE farmer_id = $1 ORDER BY stored_at DESC', [req.user!.id]);
    return Promise.all(rows.map(stockItem));
  });

  app.get<{ Params: { id: string } }>('/stock/:id', farmer, async (req) => stockItem(await ownBatch(req.user!.id, req.params.id)));

  /** Check-in. The storage time is always "now" on the server. */
  app.post('/stock', farmer, async (req) => {
    const b = body(req);
    const crop = oneOf(b.crop, CROPS, 'cropRequired');
    const quantity = positiveInt(b.quantity, 'invalidQuantity', 100_000);
    const unit = oneOf(b.unit, UNITS, 'invalidQuantity');
    const room = await getRoomRow(req.user!.cold_room_id!);
    if (!canShareRoom(await getProfile(room.crop), crop)) throw new ApiError('cropNotAllowedInRoom');
    const batch = await one(
      'INSERT INTO batches (id, farmer_id, cold_room_id, crop, quantity, unit) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [newId('b'), req.user!.id, room.id, crop, quantity, unit]
    );
    return batchView(batch);
  });

  app.post<{ Params: { id: string } }>('/stock/:id/remove', farmer, async (req) => {
    await tx(async (db) => {
      const batch = await one('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [req.params.id], db);
      if (!batch) throw notFound();
      if (batch.farmer_id !== req.user!.id) throw notAllowed();
      const pending = await one(
        "SELECT 1 FROM orders o JOIN listings l ON l.id = o.listing_id WHERE l.batch_id = $1 AND o.status = 'pending'",
        [batch.id],
        db
      );
      if (pending) throw new ApiError('hasPendingOrders');
      await query("UPDATE batches SET status = 'removed', removed_at = now() WHERE id = $1", [batch.id], db);
      await query("UPDATE listings SET status = 'paused' WHERE batch_id = $1 AND status <> 'soldOut'", [batch.id], db);
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/stock/:id/certificates', farmer, async (req) => {
    await ownBatch(req.user!.id, req.params.id);
    return issueCertificate(req.params.id);
  });

  /** Latest certificate of a batch. Any signed-in user: buyers open it from a listing. */
  app.get<{ Params: { id: string } }>('/stock/:id/certificate', { preHandler: requireUser }, async (req) => {
    const batch = await one('SELECT farmer_id FROM batches WHERE id = $1', [req.params.id]);
    if (!batch) throw notFound();
    const listed = await one('SELECT 1 FROM listings WHERE batch_id = $1', [req.params.id]);
    if (batch.farmer_id !== req.user!.id && !listed) throw notAllowed();
    const cert = await latestCertificate(req.params.id);
    if (!cert) throw new ApiError('noCertificate', 404);
    return cert;
  });
}
