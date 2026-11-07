import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ApiError, notAllowed, notFound } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { CurrentUser, Roles, type SessionUser, UserGuard } from '../../common/guards.js';
import { newId } from '../../common/ids.js';
import { CROPS, oneOf, positiveInt, UNITS } from '../../common/validate.js';
import { config } from '../../config.js';
import { batchView, listingView } from '../../common/views.js';
import { AuditService } from '../audit/audit.service.js';
import { CertificatesService } from '../certificates/certificates.service.js';
import { CropsService } from '../crops/crops.service.js';
import { MediaService } from '../media/media.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { StorageService } from '../storage/storage.service.js';

@Controller('stock')
@UseGuards(UserGuard)
export class StockController {
  constructor(
    private db: Database,
    private rooms: RoomsService,
    private crops: CropsService,
    private certificates: CertificatesService,
    private media: MediaService,
    private audit: AuditService,
    private storage: StorageService
  ) {}

  private async item(batch: any) {
    const listing = (await this.db.one("SELECT * FROM listings WHERE batch_id = $1 ORDER BY (status = 'soldOut'), created_at DESC LIMIT 1", [batch.id])) ?? null;
    const room = await this.rooms.getRow(batch.cold_room_id);
    return {
      batch: { ...batchView(batch), photos: await this.media.idsFor('checkin', batch.id) },
      conditions: await this.rooms.summarizeBatch(batch),
      listing: listing && listingView(listing),
      /** Where it is kept, for "storage location". */
      coldRoom: { id: room.id, name: room.name, district: room.district, sector: room.sector },
      /** What the QR code opens: a public page that reads this batch's record. */
      traceUrl: `${config.publicBaseUrl}/trace/${batch.code}`,
      charges: await this.storage.batchCharges(batch, room),
      history: await this.storage.history(batch),
    };
  }

  private async own(farmerId: string, id: string) {
    const batch = await this.db.one('SELECT * FROM batches WHERE id = $1', [id]);
    if (!batch) throw notFound();
    if (batch.farmer_id !== farmerId) throw notAllowed();
    return batch;
  }

  @Get()
  @Roles('farmer')
  async list(@CurrentUser() u: SessionUser) {
    const rows = await this.db.query('SELECT * FROM batches WHERE farmer_id = $1 ORDER BY stored_at DESC', [u.id]);
    return Promise.all(rows.map((b) => this.item(b)));
  }

  /** What the farmer owes for storage: running on what is still stored, and what was collected. */
  @Get('charges')
  @Roles('farmer')
  async charges(@CurrentUser() u: SessionUser) {
    const batches = await this.db.query('SELECT * FROM batches WHERE farmer_id = $1', [u.id]);
    const per = await Promise.all(batches.map(async (b) => ({ id: b.id, code: b.code, crop: b.crop, ...(await this.storage.batchCharges(b)) })));
    const sum = (k: 'runningRwf' | 'collectedRwf' | 'paidRwf' | 'dueRwf' | 'totalRwf') => per.reduce((n, x) => n + x[k], 0);
    return {
      currency: 'RWF',
      rateSet: per.length === 0 ? (await this.storage.systemRates()).kgPerDay !== null || (await this.storage.systemRates()).cratePerDay !== null : per.some((x) => x.rateSet),
      runningRwf: sum('runningRwf'), collectedRwf: sum('collectedRwf'), paidRwf: sum('paidRwf'), dueRwf: sum('dueRwf'), totalRwf: sum('totalRwf'),
      batches: per,
    };
  }

  @Get(':id')
  @Roles('farmer')
  async get(@Param('id') id: string, @CurrentUser() u: SessionUser) {
    return this.item(await this.own(u.id, id));
  }

  /** Farmers no longer record stock: they send a storage request and the operator confirms the weighed quantity. */
  @Post()
  @HttpCode(403)
  @Roles('farmer')
  create() {
    throw new ApiError('storageRequestRequired', 403);
  }

  /** The farmer asks for the produce to be collected. Staff at the cold room record the collection and the charge. */
  @Post(':id/request-collection')
  @HttpCode(200)
  @Roles('farmer')
  async requestCollection(@Param('id') id: string, @CurrentUser() u: SessionUser, @Req() req: FastifyRequest) {
    const batch = await this.storage.requestCollection(id, u.id);
    await this.audit.record({ type: 'user', id: u.id, name: u.name, ip: req.ip }, { action: 'stock.requestCollection', entityType: 'batch', entityId: id, summary: `${u.name} asked to collect batch ${batch.code}` });
    return { ok: true };
  }

  @Post(':id/certificates')
  @HttpCode(200)
  @Roles('farmer')
  async issue(@Param('id') id: string, @CurrentUser() u: SessionUser, @Req() req: FastifyRequest) {
    await this.own(u.id, id);
    const cert = await this.certificates.issue(id);
    await this.audit.record(
      { type: 'user', id: u.id, name: u.name, ip: req.ip },
      { action: 'certificate.issue', entityType: 'certificate', entityId: cert.id, summary: `${u.name} issued certificate ${cert.id} (${cert.conditions.freshness})` }
    );
    return cert;
  }

  /** Latest certificate of a batch. Any signed-in user: buyers open it from a listing. */
  @Get(':id/certificate')
  async certificate(@Param('id') id: string, @CurrentUser() u: SessionUser) {
    const batch = await this.db.one('SELECT farmer_id FROM batches WHERE id = $1', [id]);
    if (!batch) throw notFound();
    const listed = await this.db.one('SELECT 1 FROM listings WHERE batch_id = $1', [id]);
    if (batch.farmer_id !== u.id && !listed) throw notAllowed();
    const cert = await this.certificates.latest(id);
    if (!cert) throw new ApiError('noCertificate', 404);
    return cert;
  }
}
