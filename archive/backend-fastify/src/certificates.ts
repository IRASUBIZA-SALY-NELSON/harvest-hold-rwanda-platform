import { one, query } from './db.js';
import { ApiError } from './errors.js';
import { certificateId } from './ids.js';
import { getRoomRow, roomView, summarizeRoom } from './rooms.js';
import { batchView } from './views.js';

/**
 * Issues a certificate: a frozen snapshot of the batch and the cold room conditions from the
 * moment it was stored until now. It is never recalculated; issuing again creates a new one.
 */
export async function issueCertificate(batchId: string) {
  const batch = await one('SELECT * FROM batches WHERE id = $1', [batchId]);
  if (!batch) throw new ApiError('notFound', 404);
  if (batch.status !== 'stored') throw new ApiError('notInColdRoom');
  const room = await getRoomRow(batch.cold_room_id);
  const farmer = await one('SELECT id, name, district FROM users WHERE id = $1', [batch.farmer_id]);
  const issuedAt = new Date();
  const conditions = await summarizeRoom(room, new Date(batch.stored_at).getTime(), issuedAt.getTime());
  const id = certificateId();
  const data = {
    id,
    issuedAt: issuedAt.toISOString(),
    batch: batchView(batch),
    farmer,
    coldRoom: await roomView(room),
    conditions,
    status: 'internal', // becomes "certified" once RSB / NAEB approve the scheme
  };
  await query('INSERT INTO certificates (id, batch_id, issued_at, data) VALUES ($1, $2, $3, $4)', [id, batchId, issuedAt, data]);
  return data;
}

export async function latestCertificate(batchId: string) {
  const row = await one('SELECT data FROM certificates WHERE batch_id = $1 ORDER BY issued_at DESC LIMIT 1', [batchId]);
  return row?.data ?? null;
}
