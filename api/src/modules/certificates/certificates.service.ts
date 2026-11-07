import { Injectable } from '@nestjs/common';

import { ApiError } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { certificateId } from '../../common/ids.js';
import { batchView } from '../../common/views.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { SigningService } from './signing.service.js';

/** What the apps receive: the frozen data plus its current standing. */
export function certificateView(row: { data: any; signature?: string | null; key_id?: string | null; revoked_at?: Date | null; revoked_reason?: string | null }) {
  return {
    ...row.data,
    signed: !!row.signature,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    revokedReason: row.revoked_reason ?? null,
  };
}

@Injectable()
export class CertificatesService {
  constructor(
    private db: Database,
    private rooms: RoomsService,
    private signing: SigningService
  ) {}

  /**
   * Issues a certificate: a frozen, signed snapshot of the batch and the cold room conditions
   * from the moment it was stored until now. It is never recalculated; issuing again creates a
   * new one. Check-in photos are included by reference.
   */
  async issue(batchId: string) {
    const batch = await this.db.one('SELECT * FROM batches WHERE id = $1', [batchId]);
    if (!batch) throw new ApiError('notFound', 404);
    if (batch.status !== 'stored') throw new ApiError('notInColdRoom');
    const room = await this.rooms.getRow(batch.cold_room_id);
    const farmer = await this.db.one('SELECT id, name, district FROM users WHERE id = $1', [batch.farmer_id]);
    const photos = await this.db.query<{ id: string }>("SELECT id FROM photos WHERE kind = 'checkin' AND entity_id = $1 AND status = 'active' ORDER BY position", [batchId]);
    const issuedAt = new Date();
    const conditions = await this.rooms.summarize(room, new Date(batch.stored_at).getTime(), issuedAt.getTime());
    const id = certificateId();
    const data = {
      id,
      issuedAt: issuedAt.toISOString(),
      batch: batchView(batch),
      farmer,
      coldRoom: await this.rooms.view(room),
      conditions,
      photos: photos.map((p) => p.id),
      status: 'internal', // becomes "certified" once RSB / NAEB approve the scheme
    };
    const signature = this.signing.sign(data);
    await this.db.query('INSERT INTO certificates (id, batch_id, issued_at, data, signature, key_id) VALUES ($1, $2, $3, $4, $5, $6)', [
      id,
      batchId,
      issuedAt,
      data,
      signature,
      this.signing.keyId,
    ]);
    return certificateView({ data, signature });
  }

  async latest(batchId: string) {
    const row = await this.db.one('SELECT data, signature, key_id, revoked_at, revoked_reason FROM certificates WHERE batch_id = $1 ORDER BY issued_at DESC LIMIT 1', [batchId]);
    return row ? certificateView(row) : null;
  }
}
