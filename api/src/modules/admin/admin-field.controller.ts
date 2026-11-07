import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';

import { ApiError, notFound } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { newId } from '../../common/ids.js';
import { CROPS, normalizePhone, oneOf, optionalText, positiveInt, text, UNITS } from '../../common/validate.js';
import { batchView, listingView } from '../../common/views.js';
import { config } from '../../config.js';
import { type Actor, AuditService } from '../audit/audit.service.js';
import { isDistrict } from '../auth/auth.controller.js';
import { hashPin } from '../auth/user-auth.service.js';
import { CertificatesService } from '../certificates/certificates.service.js';
import { EnergyService } from '../energy/energy.service.js';
import { NotifyService } from '../notify/notify.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { requestView } from '../stock/storage-requests.controller.js';
import { collectionView, StorageService } from '../storage/storage.service.js';
import { AdminActor, AdminGuard, AdminRoles, type AdminSession, assertRoom, CurrentAdmin, EVERYONE, ROOM_STAFF, roomScope } from './admin.guard.js';
import { temporaryPin } from './admin-users.controller.js';

const REGISTRARS = ['support', 'operations', 'operator'] as const;
const like = (q?: string) => (q?.trim() ? `%${q.trim().replace(/[%_\\]/g, '\\$&')}%` : null);

/**
 * What staff and cold room operators do at the room: register farmers, cooperatives and produce,
 * record collections and payments, see the stock in every location, set the storage rates and read
 * the energy reports. A cold room operator only reaches their assigned rooms.
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminFieldController {
  constructor(
    private db: Database,
    private rooms: RoomsService,
    private storage: StorageService,
    private certificates: CertificatesService,
    private energy: EnergyService,
    private audit: AuditService,
    private notifier: NotifyService
  ) {}

  // ---------- Cooperatives ----------

  @Get('cooperatives')
  @AdminRoles(...EVERYONE)
  async cooperatives(@CurrentAdmin() admin: AdminSession) {
    const scope = roomScope(admin);
    const rows = await this.db.query(
      `SELECT c.*, (SELECT count(*) FROM users u WHERE u.cooperative_id = c.id AND u.role = 'farmer' AND ($1::text[] IS NULL OR u.cold_room_id = ANY($1))) AS farmers,
              (SELECT count(*) FROM batches b WHERE b.cooperative_id = c.id AND b.status = 'stored' AND ($1::text[] IS NULL OR b.cold_room_id = ANY($1))) AS stored_batches
         FROM cooperatives c ORDER BY lower(c.name)`,
      [scope]
    );
    return rows.map((c) => ({ id: c.id, name: c.name, district: c.district, sector: c.sector, contactName: c.contact_name, contactPhone: c.contact_phone, notes: c.notes, farmers: c.farmers, storedBatches: c.stored_batches, createdAt: c.created_at }));
  }

  private coopFields(b: any) {
    if (!isDistrict(b?.district)) throw new ApiError('districtRequired');
    return {
      name: text(b?.name, 'nameRequired', { min: 2, max: 120 }),
      district: b.district as string,
      sector: optionalText(b?.sector, 60),
      contactName: optionalText(b?.contactName, 80),
      contactPhone: b?.contactPhone ? normalizePhone(b.contactPhone) : '',
      notes: optionalText(b?.notes, 500),
    };
  }

  @Post('cooperatives')
  @HttpCode(200)
  @AdminRoles(...REGISTRARS)
  async createCooperative(@Body() b: any, @AdminActor() actor: Actor) {
    const f = this.coopFields(b);
    if (await this.db.one('SELECT 1 FROM cooperatives WHERE lower(name) = lower($1)', [f.name])) throw new ApiError('cooperativeExists', 409);
    const id = newId('co');
    await this.db.query('INSERT INTO cooperatives (id, name, district, sector, contact_name, contact_phone, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
      id, f.name, f.district, f.sector, f.contactName, f.contactPhone, f.notes, actor.id ?? null,
    ]);
    await this.audit.record(actor, { action: 'cooperative.create', entityType: 'cooperative', entityId: id, summary: `Registered cooperative ${f.name} (${f.district})`, after: f });
    return { id };
  }

  @Patch('cooperatives/:id')
  @AdminRoles(...REGISTRARS)
  async updateCooperative(@Param('id') id: string, @Body() b: any, @AdminActor() actor: Actor) {
    const before = await this.db.one('SELECT * FROM cooperatives WHERE id = $1', [id]);
    if (!before) throw notFound();
    const f = this.coopFields({ name: before.name, district: before.district, sector: before.sector, contactName: before.contact_name, contactPhone: before.contact_phone, notes: before.notes, ...b });
    if (await this.db.one('SELECT 1 FROM cooperatives WHERE lower(name) = lower($1) AND id <> $2', [f.name, id])) throw new ApiError('cooperativeExists', 409);
    await this.db.query('UPDATE cooperatives SET name = $2, district = $3, sector = $4, contact_name = $5, contact_phone = $6, notes = $7 WHERE id = $1', [id, f.name, f.district, f.sector, f.contactName, f.contactPhone, f.notes]);
    await this.audit.record(actor, { action: 'cooperative.update', entityType: 'cooperative', entityId: id, summary: `Changed cooperative ${f.name}`, after: f });
    return { ok: true };
  }

  // ---------- Farmers ----------

  /** Farmers, for registering produce. An operator sees the farmers of their rooms. */
  @Get('farmers')
  @AdminRoles(...EVERYONE)
  async farmers(@CurrentAdmin() admin: AdminSession, @Query('roomId') roomId?: string, @Query('cooperativeId') coop?: string, @Query('q') q?: string) {
    const scope = roomScope(admin);
    const rows = await this.db.query(
      `SELECT u.id, u.name, u.phone, u.district, u.cold_room_id, u.cooperative_id, u.status, u.created_at, c.name AS room_name, co.name AS cooperative_name,
              (SELECT count(*) FROM batches b WHERE b.farmer_id = u.id AND b.status = 'stored') AS stored_batches
         FROM users u LEFT JOIN cold_rooms c ON c.id = u.cold_room_id LEFT JOIN cooperatives co ON co.id = u.cooperative_id
        WHERE u.role = 'farmer' AND ($1::text[] IS NULL OR u.cold_room_id = ANY($1)) AND ($2::text IS NULL OR u.cold_room_id = $2)
          AND ($3::text IS NULL OR u.cooperative_id = $3) AND ($4::text IS NULL OR u.name ILIKE $4 OR u.phone ILIKE $4)
        ORDER BY u.name LIMIT 500`,
      [scope, roomId || null, coop || null, like(q)]
    );
    return rows.map((u) => ({
      id: u.id, name: u.name, phone: u.phone, district: u.district, status: u.status, coldRoomId: u.cold_room_id, roomName: u.room_name,
      cooperativeId: u.cooperative_id, cooperativeName: u.cooperative_name, storedBatches: u.stored_batches, createdAt: u.created_at,
    }));
  }

  /** Staff register a farmer: a temporary PIN is shown once and the farmer signs in with it. */
  @Post('farmers')
  @HttpCode(200)
  @AdminRoles(...REGISTRARS)
  async registerFarmer(@Body() b: any, @CurrentAdmin() admin: AdminSession, @AdminActor() actor: Actor) {
    b ??= {};
    const name = text(b.name, 'nameRequired', { min: 2, max: 80 });
    const phone = normalizePhone(b.phone);
    if (!isDistrict(b.district)) throw new ApiError('districtRequired');
    const room = await this.rooms.getRow(String(b.coldRoomId ?? ''));
    if (room.status === 'retired') throw new ApiError('roomNotActive');
    assertRoom(admin, room.id);
    let cooperativeId: string | null = null;
    if (b.cooperativeId) {
      if (!(await this.db.one('SELECT 1 FROM cooperatives WHERE id = $1', [b.cooperativeId]))) throw new ApiError('cooperativeNotFound');
      cooperativeId = b.cooperativeId;
    }
    if (await this.db.one('SELECT 1 FROM users WHERE phone = $1', [phone])) throw new ApiError('phoneTaken');
    const id = newId('u');
    const pin = temporaryPin();
    const lang = ['rw', 'en', 'fr'].includes(b.lang) ? b.lang : 'rw';
    await this.db.query(
      `INSERT INTO users (id, role, name, phone, pin_hash, district, cold_room_id, cooperative_id, lang, registered_by)
       VALUES ($1, 'farmer', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, name, phone, await hashPin(pin), b.district, room.id, cooperativeId, lang, actor.id ?? null]
    );
    await this.audit.record(actor, { action: 'farmer.register', entityType: 'user', entityId: id, summary: `Registered farmer ${name} at ${room.name}`, after: { name, phone, district: b.district, coldRoomId: room.id, cooperativeId } });
    return { id, temporaryPin: pin };
  }

  // ---------- Produce ----------

  /** Staff register produce that a farmer brought in. Same rules as the farmer's own check-in. */
  @Post('batches')
  @HttpCode(200)
  @AdminRoles(...ROOM_STAFF)
  async registerBatch(@Body() b: any, @CurrentAdmin() admin: AdminSession, @AdminActor() actor: Actor) {
    b ??= {};
    const farmer = await this.db.one("SELECT id, name, cooperative_id, cold_room_id, status FROM users WHERE id = $1 AND role = 'farmer'", [String(b.farmerId ?? '')]);
    if (!farmer) throw new ApiError('farmerRequired');
    if (farmer.status !== 'active') throw new ApiError('accountSuspended');
    const room = await this.rooms.getRow(String(b.coldRoomId ?? farmer.cold_room_id));
    assertRoom(admin, room.id);
    const crop = oneOf(b.crop, CROPS, 'cropRequired');
    const quantity = positiveInt(b.quantity, 'invalidQuantity', 100_000);
    const unit = oneOf(b.unit, UNITS, 'invalidQuantity');
    const batch = await this.storage.checkIn({ room, farmer, crop, quantity, unit, harvestDate: b.harvestDate, storageLocation: b.storageLocation, by: { id: actor.id ?? null, name: actor.name ?? 'staff' } });
    await this.audit.record(actor, {
      action: 'stock.register',
      entityType: 'batch',
      entityId: batch.id,
      summary: `Registered ${quantity} ${unit} of ${crop} from ${farmer.name} in ${room.name} (${batch.code})`,
      after: batchView(batch),
    });
    return { ...batchView(batch), traceUrl: `${config.publicBaseUrl}/trace/${batch.code}` };
  }

  /** Stock across every location (an operator: their rooms), by room, by crop and batch by batch. */
  @Get('inventory')
  @AdminRoles(...EVERYONE)
  async inventory(
    @CurrentAdmin() admin: AdminSession,
    @Query('roomId') roomId?: string,
    @Query('crop') crop?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('collection') collection?: string
  ) {
    const scope = roomScope(admin);
    const rows = await this.db.query(
      `SELECT b.*, u.name AS farmer_name, u.phone AS farmer_phone, co.name AS cooperative_name, c.name AS room_name, c.district AS room_district
         FROM batches b JOIN users u ON u.id = b.farmer_id JOIN cold_rooms c ON c.id = b.cold_room_id LEFT JOIN cooperatives co ON co.id = b.cooperative_id
        WHERE ($1::text[] IS NULL OR b.cold_room_id = ANY($1)) AND ($2::text IS NULL OR b.cold_room_id = $2) AND ($3::text IS NULL OR b.crop = $3)
          AND ($4::text = 'all' OR b.status = 'stored')
          AND ($5::text IS NULL OR b.code ILIKE $5 OR u.name ILIKE $5 OR co.name ILIKE $5)
          AND ($6::text IS NULL OR ($6 = 'requested' AND b.collection_requested_at IS NOT NULL AND b.status = 'stored'))
        ORDER BY b.stored_at DESC LIMIT 500`,
      [scope, roomId || null, crop || null, status === 'all' ? 'all' : 'stored', like(q), collection === 'requested' ? 'requested' : null]
    );
    const stored = rows.filter((b) => b.status === 'stored');
    const kg = (list: any[]) => list.filter((b) => b.unit === 'kg').reduce((s, b) => s + b.quantity, 0);
    const crates = (list: any[]) => list.filter((b) => b.unit === 'crate').reduce((s, b) => s + b.quantity, 0);
    const roomRows = await this.db.query("SELECT id, name, district, capacity_crates FROM cold_rooms WHERE status <> 'retired' AND ($1::text[] IS NULL OR id = ANY($1)) ORDER BY id", [scope]);
    const allStored = await this.db.query(
      "SELECT cold_room_id, crop, unit, sum(quantity)::int AS q, count(*)::int AS n FROM batches WHERE status = 'stored' AND ($1::text[] IS NULL OR cold_room_id = ANY($1)) GROUP BY 1, 2, 3",
      [scope]
    );
    const toCrates = (q: number, unit: string) => (unit === 'crate' ? q : Math.ceil(q / 20));
    return {
      byRoom: roomRows.map((r) => {
        const mine = allStored.filter((x) => x.cold_room_id === r.id);
        return {
          roomId: r.id, name: r.name, district: r.district, capacityCrates: r.capacity_crates,
          batches: mine.reduce((s, x) => s + x.n, 0),
          kg: mine.filter((x) => x.unit === 'kg').reduce((s, x) => s + x.q, 0),
          crates: mine.filter((x) => x.unit === 'crate').reduce((s, x) => s + x.q, 0),
          fullnessPct: Math.min(100, Math.round((100 * mine.reduce((s, x) => s + toCrates(x.q, x.unit), 0)) / r.capacity_crates)),
          crops: [...new Set(mine.map((x) => x.crop))],
        };
      }),
      byCrop: [...new Set(allStored.map((x) => x.crop))].sort().map((c) => {
        const mine = allStored.filter((x) => x.crop === c);
        return { crop: c, kg: mine.filter((x) => x.unit === 'kg').reduce((s, x) => s + x.q, 0), crates: mine.filter((x) => x.unit === 'crate').reduce((s, x) => s + x.q, 0), rooms: new Set(mine.map((x) => x.cold_room_id)).size };
      }),
      totals: { batches: stored.length, kg: kg(stored), crates: crates(stored), toCollect: stored.filter((b) => b.collection_requested_at).length },
      batches: await Promise.all(
        rows.map(async (b) => ({
          ...batchView(b),
          farmerName: b.farmer_name, farmerPhone: b.farmer_phone, cooperativeName: b.cooperative_name, roomName: b.room_name, roomDistrict: b.room_district,
          freshness: b.status === 'stored' ? (await this.rooms.summarizeBatch(b)).freshness : null,
        }))
      ),
    };
  }

  /** One batch: where it is, what happened to it, what it costs, its QR link. */
  @Get('batches/:id')
  @AdminRoles(...EVERYONE)
  async batch(@Param('id') id: string, @CurrentAdmin() admin: AdminSession) {
    const batch = await this.db.one('SELECT * FROM batches WHERE id = $1 OR code = upper($1)', [id]);
    if (!batch) throw notFound();
    assertRoom(admin, batch.cold_room_id);
    const room = await this.rooms.getRow(batch.cold_room_id);
    const [farmer, coop, listing, cert, history, charges, conditions] = await Promise.all([
      this.db.one('SELECT id, name, phone, district FROM users WHERE id = $1', [batch.farmer_id]),
      batch.cooperative_id ? this.db.one('SELECT id, name FROM cooperatives WHERE id = $1', [batch.cooperative_id]) : null,
      this.db.one("SELECT * FROM listings WHERE batch_id = $1 ORDER BY (status = 'soldOut'), created_at DESC LIMIT 1", [batch.id]),
      this.certificates.latest(batch.id),
      this.storage.history(batch),
      this.storage.batchCharges(batch, room),
      this.rooms.summarizeBatch(batch),
    ]);
    return {
      batch: batchView(batch),
      farmer,
      cooperative: coop,
      coldRoom: { id: room.id, name: room.name, district: room.district, sector: room.sector },
      conditions,
      listing: listing && listingView(listing),
      certificate: cert,
      history,
      charges,
      traceUrl: `${config.publicBaseUrl}/trace/${batch.code}`,
      qrUrl: `${config.publicBaseUrl}/trace/${batch.code}/qr.svg`,
    };
  }

  /** Where in the room it sits, or clearing a collection request. */
  @Patch('batches/:id')
  @AdminRoles(...ROOM_STAFF)
  async updateBatch(@Param('id') id: string, @Body() b: any, @CurrentAdmin() admin: AdminSession, @AdminActor() actor: Actor) {
    const batch = await this.db.one('SELECT * FROM batches WHERE id = $1', [id]);
    if (!batch) throw notFound();
    assertRoom(admin, batch.cold_room_id);
    if (batch.status !== 'stored') throw new ApiError('notInColdRoom');
    const location = b?.storageLocation === undefined ? batch.storage_location : optionalText(b.storageLocation, 60);
    await this.db.query('UPDATE batches SET storage_location = $2 WHERE id = $1', [id, location]);
    if (location !== batch.storage_location) {
      await this.audit.record(actor, { action: 'stock.move', entityType: 'batch', entityId: id, summary: `Moved batch ${batch.code} to "${location || 'unspecified'}"`, before: { storageLocation: batch.storage_location }, after: { storageLocation: location } });
    }
    return { ok: true };
  }

  /** Records that someone collected produce: all of it, or part. The storage charge is worked out and frozen here. */
  @Post('batches/:id/collect')
  @HttpCode(200)
  @AdminRoles(...ROOM_STAFF)
  async collect(@Param('id') id: string, @Body() b: any, @CurrentAdmin() admin: AdminSession, @AdminActor() actor: Actor) {
    const batch = await this.db.one('SELECT * FROM batches WHERE id = $1', [id]);
    if (!batch) throw notFound();
    assertRoom(admin, batch.cold_room_id);
    const quantity = b?.all === true ? batch.quantity : positiveInt(b?.quantity, 'invalidQuantity', 100_000);
    const collectedBy = text(b?.collectedBy, 'collectorRequired', { min: 2, max: 80 });
    this.rooms.clearSummaryCache();
    return this.storage.collect(actor, { batchId: id, quantity, collectedBy, note: optionalText(b?.note, 300) });
  }

  /** Staff list produce for buyers on the farmer's behalf. */
  @Post('batches/:id/list')
  @HttpCode(200)
  @AdminRoles('operations', 'operator', 'market')
  async listForSale(@Param('id') id: string, @Body() b: any, @CurrentAdmin() admin: AdminSession, @AdminActor() actor: Actor) {
    const batch = await this.db.one('SELECT * FROM batches WHERE id = $1', [id]);
    if (!batch) throw notFound();
    assertRoom(admin, batch.cold_room_id);
    const quantity = positiveInt(b?.quantity, 'invalidQuantity', 100_000);
    const price = positiveInt(b?.pricePerUnit, 'invalidPrice', 100_000_000);
    const listing = await this.db.tx((db) => this.storage.listBatch(db, id, quantity, price));
    if (!(await this.certificates.latest(id))) await this.certificates.issue(id);
    await this.audit.record(actor, { action: 'listing.create', entityType: 'listing', entityId: listing.id, summary: `${actor.name} listed ${quantity} ${listing.unit} of ${listing.crop} at ${price} RWF for the farmer`, after: listingView(listing) });
    return listingView(listing);
  }

  // ---------- Collections, payments, movements ----------

  @Get('collections')
  @AdminRoles(...EVERYONE)
  async collections(@CurrentAdmin() admin: AdminSession, @Query('roomId') roomId?: string, @Query('payment') payment?: string, @Query('days') days?: string) {
    const d = Math.min(Math.max(Number(days) || 30, 1), 365);
    const rows = await this.db.query(
      `SELECT c.*, b.code, b.crop, u.name AS farmer_name, r.name AS room_name FROM collections c
         JOIN batches b ON b.id = c.batch_id JOIN users u ON u.id = c.farmer_id JOIN cold_rooms r ON r.id = c.room_id
        WHERE ($1::text[] IS NULL OR c.room_id = ANY($1)) AND ($2::text IS NULL OR c.room_id = $2)
          AND ($3::text IS NULL OR c.payment_status = $3) AND c.collected_at > now() - make_interval(days => $4)
        ORDER BY c.collected_at DESC LIMIT 500`,
      [roomScope(admin), roomId || null, ['unpaid', 'paid', 'waived'].includes(payment ?? '') ? payment : null, d]
    );
    const view = rows.map((c) => ({ ...collectionView(c), batchCode: c.code, crop: c.crop, farmerName: c.farmer_name, roomName: c.room_name }));
    return { collections: view, unpaidRwf: view.filter((c) => c.paymentStatus === 'unpaid').reduce((s, c) => s + (c.chargeRwf ?? 0), 0) };
  }

  /** A storage charge was paid (cash, mobile money or bank) or waived. A mobile money provider can replace this by hand-entry later. */
  @Post('collections/:id/payment')
  @HttpCode(200)
  @AdminRoles(...ROOM_STAFF)
  async pay(@Param('id') id: string, @Body() b: any, @CurrentAdmin() admin: AdminSession, @AdminActor() actor: Actor) {
    const c = await this.db.one('SELECT room_id FROM collections WHERE id = $1', [id]);
    if (!c) throw notFound();
    assertRoom(admin, c.room_id);
    const status = b?.status === 'waived' ? 'waived' : 'paid';
    // Waiving a charge is the owner's decision.
    if (status === 'waived' && admin.role !== 'superadmin') throw new ApiError('notAllowed', 403);
    return this.storage.recordPayment(actor, id, { status, method: b?.method, reference: b?.reference });
  }

  /** Produce in and out of the rooms. */
  @Get('movements')
  @AdminRoles(...EVERYONE)
  async movements(@CurrentAdmin() admin: AdminSession, @Query('roomId') roomId?: string, @Query('days') days?: string) {
    const d = Math.min(Math.max(Number(days) || 14, 1), 90);
    const rows = await this.db.query(
      `SELECT m.*, b.code, b.crop, u.name AS farmer_name, r.name AS room_name FROM stock_movements m
         JOIN batches b ON b.id = m.batch_id JOIN users u ON u.id = b.farmer_id JOIN cold_rooms r ON r.id = m.room_id
        WHERE ($1::text[] IS NULL OR m.room_id = ANY($1)) AND ($2::text IS NULL OR m.room_id = $2) AND m.at > now() - make_interval(days => $3)
        ORDER BY m.at DESC, m.id DESC LIMIT 500`,
      [roomScope(admin), roomId || null, d]
    );
    return rows.map((m) => ({ id: m.id, at: m.at, kind: m.kind, reason: m.reason, quantity: m.quantity, unit: m.unit, by: m.actor_name, note: m.note, batchId: m.batch_id, batchCode: m.code, crop: m.crop, farmerName: m.farmer_name, roomId: m.room_id, roomName: m.room_name }));
  }

  // ---------- System settings ----------

  /** Storage rates, in RWF per day. null = not set yet (charges show as "no rate set"). */
  @Get('settings')
  @AdminRoles(...EVERYONE)
  async settings() {
    return { storageRates: await this.storage.systemRates(), currency: 'RWF' };
  }

  @Put('settings')
  @AdminRoles('superadmin')
  async saveSettings(@Body() b: any, @AdminActor() actor: Actor) {
    const rate = (v: unknown) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new ApiError('invalidRate');
      return n;
    };
    const before = await this.storage.systemRates();
    const next = { kgPerDay: rate(b?.storageRates?.kgPerDay), cratePerDay: rate(b?.storageRates?.cratePerDay) };
    await this.db.query(
      `INSERT INTO settings (key, value, updated_by) VALUES ('storage_rates', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [next, actor.id ?? null]
    );
    await this.audit.record(actor, {
      action: 'settings.storageRates',
      entityType: 'settings',
      entityId: 'storage_rates',
      summary: `Storage rates: ${next.kgPerDay ?? 'not set'} RWF per kg per day, ${next.cratePerDay ?? 'not set'} RWF per crate per day`,
      before,
      after: next,
    });
    return { storageRates: next };
  }

  // ---------- Storage requests ----------

  /** Farmers' requests waiting for an operator (an operator sees the requests of their rooms). */
  @Get('storage-requests')
  @AdminRoles(...EVERYONE)
  async storageRequests(@CurrentAdmin() admin: AdminSession, @Query('status') status?: string, @Query('roomId') roomId?: string) {
    const rows = await this.db.query(
      `SELECT r.*, u.name AS farmer_name, u.phone AS farmer_phone, co.name AS cooperative_name, c.name AS room_name, b.code AS batch_code
         FROM storage_requests r JOIN users u ON u.id = r.farmer_id JOIN cold_rooms c ON c.id = r.cold_room_id
         LEFT JOIN cooperatives co ON co.id = u.cooperative_id LEFT JOIN batches b ON b.id = r.batch_id
        WHERE ($1::text[] IS NULL OR r.cold_room_id = ANY($1)) AND ($2::text IS NULL OR r.cold_room_id = $2)
          AND ($3::text = 'all' OR r.status = 'pending')
        ORDER BY (r.status = 'pending') DESC, r.created_at ${status === 'all' ? 'DESC' : 'ASC'} LIMIT 300`,
      [roomScope(admin), roomId || null, status === 'all' ? 'all' : 'pending']
    );
    return rows.map((r) => ({ ...requestView(r), farmerId: r.farmer_id, farmerName: r.farmer_name, farmerPhone: r.farmer_phone, cooperativeName: r.cooperative_name, roomName: r.room_name, handledBy: r.handled_by_name }));
  }

  /** The operator weighed and inspected the produce: `quantity` is what was really received (e.g. 95 of the 100 kg asked). */
  @Post('storage-requests/:id/accept')
  @HttpCode(200)
  @AdminRoles(...ROOM_STAFF)
  async acceptRequest(@Param('id') id: string, @Body() b: any, @CurrentAdmin() admin: AdminSession, @AdminActor() actor: Actor) {
    b ??= {};
    const quantity = positiveInt(b.quantity, 'invalidQuantity', 100_000);
    const done = await this.storage.acceptRequest(actor, id, { quantity, unit: b.unit, storageLocation: b.storageLocation, harvestDate: b.harvestDate, inspectionNote: b.inspectionNote }, (roomId) => assertRoom(admin, roomId));
    await this.notifier.notify(done.request.farmer_id, 'storageAccepted', { crop: done.batch.crop, quantity, unit: done.unit, code: done.batch.code });
    return { ...batchView(done.batch), traceUrl: `${config.publicBaseUrl}/trace/${done.batch.code}` };
  }

  @Post('storage-requests/:id/decline')
  @HttpCode(200)
  @AdminRoles(...ROOM_STAFF)
  async declineRequest(@Param('id') id: string, @Body() b: any, @CurrentAdmin() admin: AdminSession, @AdminActor() actor: Actor) {
    const reason = text(b?.reason, 'reasonRequired', { min: 5, max: 200 });
    const r = await this.db.one('SELECT * FROM storage_requests WHERE id = $1', [id]);
    if (!r) throw notFound();
    assertRoom(admin, r.cold_room_id);
    const row = await this.db.one("UPDATE storage_requests SET status = 'declined', decline_reason = $2, handled_by = $3, handled_by_name = $4, handled_at = now() WHERE id = $1 AND status = 'pending' RETURNING *", [id, reason, actor.id ?? null, actor.name ?? 'staff']);
    if (!row) throw new ApiError('requestClosed', 409);
    await this.audit.record(actor, { action: 'storageRequest.decline', entityType: 'storageRequest', entityId: id, summary: `Declined a request for ${r.estimated_quantity} ${r.unit} of ${r.crop}: ${reason}` });
    await this.notifier.notify(r.farmer_id, 'storageDeclined', { crop: r.crop, reason });
    return requestView(row);
  }

  // ---------- Prices per crop and room ----------

  /** All prices: the system price, each room's own, and the prices set for a crop (everywhere or in one room). */
  @Get('prices')
  @AdminRoles(...EVERYONE)
  async prices() {
    const [system, rooms, crops] = await Promise.all([
      this.storage.systemRates(),
      this.db.query("SELECT id, name, storage_rate_kg_day, storage_rate_crate_day FROM cold_rooms WHERE status <> 'retired' ORDER BY id"),
      this.db.query('SELECT p.*, c.name AS room_name FROM storage_prices p LEFT JOIN cold_rooms c ON c.id = p.room_id ORDER BY p.crop, p.room_id NULLS FIRST'),
    ]);
    return {
      currency: 'RWF',
      system,
      rooms: rooms.map((r) => ({ roomId: r.id, name: r.name, kgPerDay: r.storage_rate_kg_day, cratePerDay: r.storage_rate_crate_day })),
      crops: crops.map((p) => ({ id: p.id, crop: p.crop, roomId: p.room_id, roomName: p.room_name, kgPerDay: p.kg_per_day, cratePerDay: p.crate_per_day, updatedAt: p.updated_at })),
    };
  }

  /** Sets (or changes) the price of a crop, in every room or in one room. The Super Admin decides prices. */
  @Put('prices')
  @AdminRoles('superadmin')
  async setPrice(@Body() b: any, @AdminActor() actor: Actor) {
    const crop = oneOf(b?.crop, CROPS, 'cropRequired');
    if (!(await this.db.one('SELECT 1 FROM crop_profiles WHERE crop = $1', [crop]))) throw new ApiError('cropRequired');
    let roomId: string | null = null;
    if (b?.roomId) roomId = (await this.rooms.getRow(String(b.roomId))).id;
    const rate = (v: unknown) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new ApiError('invalidRate');
      return n;
    };
    const kg = rate(b?.kgPerDay);
    const crate = rate(b?.cratePerDay);
    if (kg === null && crate === null) throw new ApiError('invalidRate');
    const before = await this.db.one("SELECT kg_per_day, crate_per_day FROM storage_prices WHERE crop = $1 AND coalesce(room_id, '') = coalesce($2, '')", [crop, roomId]);
    const row = await this.db.one(
      `INSERT INTO storage_prices (crop, room_id, kg_per_day, crate_per_day, updated_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (crop, coalesce(room_id, '')) DO UPDATE SET kg_per_day = EXCLUDED.kg_per_day, crate_per_day = EXCLUDED.crate_per_day, updated_at = now(), updated_by = EXCLUDED.updated_by
       RETURNING *`,
      [crop, roomId, kg, crate, actor.id ?? null]
    );
    await this.audit.record(actor, {
      action: 'price.set', entityType: 'price', entityId: String(row.id),
      summary: `Price for ${crop}${roomId ? ` in ${roomId}` : ' in every room'}: ${kg ?? '–'} RWF per kg per day, ${crate ?? '–'} per crate per day`,
      before: before ? { kgPerDay: before.kg_per_day, cratePerDay: before.crate_per_day } : null, after: { kgPerDay: kg, cratePerDay: crate },
    });
    return { id: row.id };
  }

  @Delete('prices/:id')
  @AdminRoles('superadmin')
  async deletePrice(@Param('id') id: string, @AdminActor() actor: Actor) {
    const row = await this.db.one('DELETE FROM storage_prices WHERE id = $1 RETURNING *', [Number(id)]);
    if (!row) throw notFound();
    await this.audit.record(actor, { action: 'price.remove', entityType: 'price', entityId: id, summary: `Removed the price for ${row.crop}${row.room_id ? ` in ${row.room_id}` : ' in every room'}` });
    return { ok: true };
  }

  // ---------- Energy ----------

  /** Electricity, solar and battery by room, with the comparison between rooms. */
  @Get('energy')
  @AdminRoles(...EVERYONE)
  async energyReport(@CurrentAdmin() admin: AdminSession, @Query('days') days?: string) {
    const d = Number(days);
    return this.energy.report([7, 30, 90].includes(d) ? d : 30, roomScope(admin));
  }

  /** The order was paid (by hand for now). */
  @Post('orders/:id/payment')
  @HttpCode(200)
  @AdminRoles('market', 'operations')
  async orderPayment(@Param('id') id: string, @Body() b: any, @AdminActor() actor: Actor) {
    const method = oneOf(b?.method, ['cash', 'momo', 'bank', 'other'] as const, 'invalidPaymentMethod');
    const o = await this.db.one("UPDATE orders SET payment_status = 'paid', payment_method = $2, payment_ref = $3, paid_at = now() WHERE id = $1 AND status = 'accepted' AND payment_status = 'unpaid' RETURNING *", [id, method, optionalText(b?.reference, 80) || null]);
    if (!o) throw new ApiError('orderNotPayable', 409);
    await this.audit.record(actor, { action: 'order.payment', entityType: 'order', entityId: id, summary: `Recorded payment of ${o.quantity * o.price_per_unit} RWF (${method}) for order ${id}` });
    return { ok: true };
  }
}
