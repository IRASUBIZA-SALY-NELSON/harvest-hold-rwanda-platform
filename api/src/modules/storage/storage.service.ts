import { Injectable } from '@nestjs/common';

import { ApiError, notFound } from '../../common/api-error.js';
import { Database, type Queryable } from '../../common/database.service.js';
import { batchCode, newId } from '../../common/ids.js';
import { optionalText } from '../../common/validate.js';
import { rules } from '../../config.js';
import { type Actor, AuditService } from '../audit/audit.service.js';
import { CropsService } from '../crops/crops.service.js';
import { EventsService } from '../events/events.service.js';
import { type RoomRow, RoomsService } from '../rooms/rooms.service.js';

const DAY = 86_400_000;
const OFFSET = rules.storage.unitsKigaliOffsetMs;

export interface Rates {
  kgPerDay: number | null;
  cratePerDay: number | null;
}

/** Storage days in Kigali: the day it came in counts, and so does the day it left (at least 1). */
export function storageDays(from: Date | string, to: Date | string): number {
  const day = (d: Date | string) => Math.floor((new Date(d).getTime() + OFFSET) / DAY);
  return Math.max(1, day(to) - day(from) + 1);
}

export const collectionView = (c: any) => ({
  id: c.id,
  batchId: c.batch_id,
  roomId: c.room_id,
  farmerId: c.farmer_id,
  quantity: c.quantity,
  unit: c.unit,
  collectedAt: c.collected_at,
  collectedBy: c.collected_by_name,
  kind: c.kind as 'collection' | 'sale',
  orderId: c.order_id,
  recordedBy: c.recorded_by_name,
  note: c.note,
  days: c.days,
  rateRwf: c.rate_rwf,
  chargeRwf: c.charge_rwf,
  paymentStatus: c.payment_status as 'unpaid' | 'paid' | 'waived',
  paymentMethod: c.payment_method,
  paymentRef: c.payment_ref,
  paidAt: c.paid_at,
});

export const movementView = (m: any) => ({
  id: m.id, roomId: m.room_id, batchId: m.batch_id, kind: m.kind as 'in' | 'out', reason: m.reason as string, quantity: m.quantity, unit: m.unit, at: m.at, by: m.actor_name, note: m.note,
});

export interface CheckIn {
  room: RoomRow;
  farmer: { id: string; name: string; cooperative_id: string | null };
  crop: string;
  quantity: number;
  unit: 'kg' | 'crate';
  harvestDate?: unknown;
  storageLocation?: unknown;
  by: { id: string | null; name: string };
}

/** Batches, what goes in and out of the rooms, collections and storage charges. */
@Injectable()
export class StorageService {
  constructor(
    private db: Database,
    private rooms: RoomsService,
    private crops: CropsService,
    private audit: AuditService,
    private events: EventsService
  ) {}

  // ---------- Rates and charges ----------

  async systemRates(): Promise<Rates> {
    const row = await this.db.one<{ value: Rates }>("SELECT value FROM settings WHERE key = 'storage_rates'");
    return { kgPerDay: row?.value?.kgPerDay ?? null, cratePerDay: row?.value?.cratePerDay ?? null };
  }

  /**
   * The price in force (RWF per unit per day), most specific first: this crop in this room, this crop
   * in every room, the room's own price, the system price. null = no price set yet.
   */
  async rateFor(room: RoomRow, unit: string, crop?: string | null, system?: Rates): Promise<number | null> {
    const col = unit === 'crate' ? 'crate_per_day' : 'kg_per_day';
    if (crop) {
      const rows = await this.db.query<Record<string, any>>(`SELECT room_id, ${col} AS rate FROM storage_prices WHERE crop = $1 AND (room_id = $2 OR room_id IS NULL)`, [crop, room.id]);
      const exact = rows.find((r) => r.room_id === room.id && r.rate !== null);
      if (exact) return exact.rate;
      const anyRoom = rows.find((r) => r.room_id === null && r.rate !== null);
      if (anyRoom) return anyRoom.rate;
    }
    const sys = system ?? (await this.systemRates());
    return unit === 'crate' ? (room.storage_rate_crate_day ?? sys.cratePerDay) : (room.storage_rate_kg_day ?? sys.kgPerDay);
  }

  /** What storing this much for this long costs (RWF). `charge` is null while no rate is set. */
  async quote(room: RoomRow, unit: string, quantity: number, storedAt: Date | string, until: Date | string = new Date(), crop?: string | null) {
    const days = storageDays(storedAt, until);
    const rate = await this.rateFor(room, unit, crop);
    return { days, rate, charge: rate === null ? null : Math.round(quantity * days * rate) };
  }

  /** Charges of a batch so far: frozen on what already left, running on what is still there. */
  async batchCharges(batch: any, room?: RoomRow) {
    const r = room ?? (await this.rooms.getRow(batch.cold_room_id));
    const cols = await this.db.query('SELECT * FROM collections WHERE batch_id = $1 ORDER BY collected_at', [batch.id]);
    const stillThere = batch.status === 'stored' ? await this.quote(r, batch.unit, batch.quantity, batch.stored_at, new Date(), batch.crop) : { days: 0, rate: await this.rateFor(r, batch.unit, batch.crop), charge: batch.quantity > 0 ? null : 0 };
    const frozen = cols.reduce((s, c) => s + (c.charge_rwf ?? 0), 0);
    const paid = cols.filter((c) => c.payment_status !== 'unpaid').reduce((s, c) => s + (c.charge_rwf ?? 0), 0);
    const rateSet = stillThere.rate !== null || cols.some((c) => c.rate_rwf !== null);
    const running = batch.status === 'stored' ? (stillThere.charge ?? 0) : 0;
    return {
      unit: batch.unit as string,
      rateRwf: stillThere.rate,
      rateSet,
      days: batch.status === 'stored' ? storageDays(batch.stored_at, new Date()) : cols.length ? Math.max(...cols.map((c) => c.days)) : 0,
      runningRwf: running,
      collectedRwf: frozen,
      paidRwf: paid,
      totalRwf: frozen + running,
      dueRwf: frozen - paid + running,
    };
  }

  // ---------- Check-in ----------

  private harvestDate(v: unknown): string {
    const today = new Date(Date.now() + OFFSET).toISOString().slice(0, 10);
    if (v === undefined || v === null || v === '') return today;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(`${v}T00:00:00Z`).getTime())) throw new ApiError('invalidHarvestDate');
    const ageDays = (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${v}T00:00:00Z`).getTime()) / DAY;
    if (ageDays < 0 || ageDays > 60) throw new ApiError('invalidHarvestDate');
    return v;
  }

  /** Registers produce in a room. The storage time is the server's, so it cannot be back-dated. */
  async checkIn(c: CheckIn, db?: Queryable) {
    if (c.room.status !== 'active') throw new ApiError('roomNotActive');
    if (!this.crops.canShareRoom(await this.crops.get(c.room.crop), c.crop)) throw new ApiError('cropNotAllowedInRoom');
    const harvest = this.harvestDate(c.harvestDate);
    const location = optionalText(c.storageLocation, 60);
    const run = async (conn: Queryable) => {
      let batch: any;
      for (let attempt = 0; attempt < 5 && !batch; attempt++) {
        batch = await this.db.one(
          `INSERT INTO batches (id, code, farmer_id, cold_room_id, crop, quantity, initial_quantity, unit, harvest_date, storage_location, cooperative_id, registered_by, registered_by_name)
           VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (code) DO NOTHING RETURNING *`,
          [newId('b'), batchCode(), c.farmer.id, c.room.id, c.crop, c.quantity, c.unit, harvest, location, c.farmer.cooperative_id, c.by.id, c.by.name],
          conn
        );
      }
      if (!batch) throw new Error('could not make a batch code');
      await this.db.query(
        "INSERT INTO stock_movements (room_id, batch_id, kind, reason, quantity, unit, actor_name) VALUES ($1, $2, 'in', 'checkin', $3, $4, $5)",
        [c.room.id, batch.id, c.quantity, c.unit, c.by.name],
        conn
      );
      return batch;
    };
    return db ? run(db) : this.db.tx(run);
  }

  // ---------- Storage requests ----------

  /**
   * The operator weighed the produce and confirms what was really received. Registers it as a batch
   * (server time, batch code) and closes the request, in one transaction.
   */
  async acceptRequest(actor: Actor, id: string, p: { quantity: number; unit?: string; storageLocation?: unknown; harvestDate?: unknown; inspectionNote?: string }, canUse: (roomId: string) => void) {
    const done = await this.db.tx(async (db) => {
      const r = await this.db.one('SELECT * FROM storage_requests WHERE id = $1 FOR UPDATE', [id], db);
      if (!r) throw notFound();
      canUse(r.cold_room_id);
      if (r.status !== 'pending') throw new ApiError('requestClosed', 409);
      const farmer = await this.db.one("SELECT id, name, cooperative_id, status FROM users WHERE id = $1", [r.farmer_id], db);
      if (!farmer || farmer.status !== 'active') throw new ApiError('accountSuspended');
      const room = await this.rooms.getRow(r.cold_room_id, db);
      const unit = p.unit === 'crate' || p.unit === 'kg' ? p.unit : r.unit;
      const batch = await this.checkIn({ room, farmer, crop: r.crop, quantity: p.quantity, unit, harvestDate: p.harvestDate, storageLocation: p.storageLocation, by: { id: actor.id ?? null, name: actor.name ?? 'staff' } }, db);
      await this.db.query('UPDATE batches SET requested_quantity = $2, inspection_note = $3 WHERE id = $1', [batch.id, r.estimated_quantity, optionalText(p.inspectionNote, 300)], db);
      await this.db.query(
        "UPDATE storage_requests SET status = 'accepted', batch_id = $2, confirmed_quantity = $3, handled_by = $4, handled_by_name = $5, handled_at = now() WHERE id = $1",
        [id, batch.id, p.quantity, actor.id ?? null, actor.name ?? 'staff'],
        db
      );
      return { request: r, batch: { ...batch, requested_quantity: r.estimated_quantity }, room, unit };
    });
    this.rooms.clearSummaryCache();
    await this.audit.record(actor, {
      action: 'storageRequest.accept',
      entityType: 'batch',
      entityId: done.batch.id,
      summary: `Confirmed ${p.quantity} ${done.unit} of ${done.batch.crop} (asked ${done.request.estimated_quantity} ${done.request.unit}) in ${done.room.name}: batch ${done.batch.code}`,
      after: { requestId: id, batchId: done.batch.id, confirmed: p.quantity, asked: done.request.estimated_quantity },
    });
    return done;
  }

  // ---------- Collection ----------

  /**
   * Produce leaves the room: a person collects it, or a market order is accepted. Works in the
   * caller's transaction, takes the quantity off the batch, writes the movement and a collection
   * row with the storage charge frozen at today's rate.
   */
  async collectTx(
    db: Queryable,
    p: { batchId: string; quantity: number; collectedBy: string; by: { id: string | null; name: string }; note?: string; kind?: 'collection' | 'sale'; orderId?: string }
  ) {
    const batch = await this.db.one('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [p.batchId], db);
    if (!batch) throw notFound();
    if (batch.status !== 'stored') throw new ApiError('notInColdRoom');
    if (p.quantity > batch.quantity) throw new ApiError('moreThanStock');
    const left = batch.quantity - p.quantity;
    if (!p.orderId) {
      const reserved = await this.db.one<{ n: number }>(
        "SELECT coalesce(sum(o.quantity), 0)::int AS n FROM orders o JOIN listings l ON l.id = o.listing_id WHERE l.batch_id = $1 AND o.status = 'pending'",
        [batch.id],
        db
      );
      if (left < reserved!.n) throw new ApiError('hasPendingOrders');
    }
    const room = await this.rooms.getRow(batch.cold_room_id, db);
    const q = await this.quote(room, batch.unit, p.quantity, batch.stored_at, new Date(), batch.crop);
    await this.db.query(
      `UPDATE batches SET quantity = $2, status = CASE WHEN $2 = 0 THEN 'removed' ELSE status END,
              removed_at = CASE WHEN $2 = 0 THEN now() ELSE removed_at END, collection_requested_at = CASE WHEN $2 = 0 THEN NULL ELSE collection_requested_at END
        WHERE id = $1`,
      [batch.id, left],
      db
    );
    if (!p.orderId) {
      // What is left must not stay on sale in larger amounts than the batch holds.
      await this.db.query(
        "UPDATE listings SET quantity = LEAST(quantity, $2), status = CASE WHEN LEAST(quantity, $2) = 0 THEN 'soldOut' ELSE status END WHERE batch_id = $1 AND status <> 'soldOut'",
        [batch.id, left],
        db
      );
    }
    const collection = await this.db.one(
      `INSERT INTO collections (id, batch_id, room_id, farmer_id, quantity, unit, collected_by_name, kind, order_id, recorded_by, recorded_by_name, note, days, rate_rwf, charge_rwf)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [newId('c'), batch.id, room.id, batch.farmer_id, p.quantity, batch.unit, p.collectedBy, p.kind ?? 'collection', p.orderId ?? null, p.by.id, p.by.name, optionalText(p.note, 300), q.days, q.rate, q.charge],
      db
    );
    await this.db.query(
      "INSERT INTO stock_movements (room_id, batch_id, kind, reason, quantity, unit, actor_name, note) VALUES ($1, $2, 'out', $3, $4, $5, $6, $7)",
      [room.id, batch.id, p.kind === 'sale' ? 'sale' : 'collection', p.quantity, batch.unit, p.collectedBy, optionalText(p.note, 300)],
      db
    );
    return { collection, batch, room, left };
  }

  /** Staff records that someone collected produce. */
  async collect(actor: Actor, p: { batchId: string; quantity: number; collectedBy: string; note?: string }) {
    const done = await this.db.tx((db) => this.collectTx(db, { ...p, by: { id: actor.id ?? null, name: actor.name ?? 'staff' } }));
    this.rooms.clearSummaryCache();
    await this.audit.record(actor, {
      action: 'stock.collect',
      entityType: 'batch',
      entityId: done.batch.id,
      summary: `${p.collectedBy} collected ${p.quantity} ${done.batch.unit} of ${done.batch.crop} (${done.batch.code}) from ${done.room.name}${done.collection.charge_rwf === null ? '' : `: storage ${done.collection.charge_rwf} RWF`}`,
      after: collectionView(done.collection),
    });
    return { ...collectionView(done.collection), left: done.left };
  }

  /** The farmer asks for the produce to be collected; staff see it and record the collection. */
  async requestCollection(batchId: string, farmerId: string) {
    const batch = await this.db.one('SELECT * FROM batches WHERE id = $1', [batchId]);
    if (!batch) throw notFound();
    if (batch.farmer_id !== farmerId) throw new ApiError('notAllowed', 403);
    if (batch.status !== 'stored') throw new ApiError('notInColdRoom');
    await this.db.query('UPDATE batches SET collection_requested_at = coalesce(collection_requested_at, now()) WHERE id = $1', [batchId]);
    return batch;
  }

  // ---------- Listings ----------

  /** Puts part of a stored batch on sale. The farmer lists it themselves, or staff do it for them. */
  async listBatch(db: Queryable, batchId: string, quantity: number, price: number, farmerId?: string) {
    const batch = await this.db.one('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [batchId], db);
    if (!batch) throw notFound();
    if (farmerId && batch.farmer_id !== farmerId) throw new ApiError('notAllowed', 403);
    if (batch.status !== 'stored') throw new ApiError('notInColdRoom');
    if (quantity > batch.quantity) throw new ApiError('moreThanStock');
    if (await this.db.one("SELECT 1 FROM listings WHERE batch_id = $1 AND status <> 'soldOut'", [batch.id], db)) throw new ApiError('alreadyListed');
    return this.db.one(
      'INSERT INTO listings (id, batch_id, farmer_id, cold_room_id, crop, quantity, unit, price_per_unit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [newId('l'), batch.id, batch.farmer_id, batch.cold_room_id, batch.crop, quantity, batch.unit, price],
      db
    );
  }

  // ---------- Payments (recorded by hand for now; a mobile money provider can plug in later) ----------

  async recordPayment(actor: Actor, collectionId: string, p: { status: 'paid' | 'waived'; method?: string; reference?: string }) {
    const c = await this.db.one('SELECT * FROM collections WHERE id = $1', [collectionId]);
    if (!c) throw notFound();
    if (c.payment_status !== 'unpaid') throw new ApiError('alreadySettled', 409);
    if (p.status === 'paid' && !['cash', 'momo', 'bank', 'other'].includes(p.method ?? '')) throw new ApiError('invalidPaymentMethod');
    const row = await this.db.one(
      `UPDATE collections SET payment_status = $2, payment_method = $3, payment_ref = $4, paid_at = now(), paid_recorded_by = $5 WHERE id = $1 RETURNING *`,
      [collectionId, p.status, p.status === 'paid' ? p.method : null, optionalText(p.reference, 80) || null, actor.id ?? null]
    );
    await this.audit.record(actor, {
      action: p.status === 'paid' ? 'payment.record' : 'payment.waive',
      entityType: 'batch',
      entityId: c.batch_id,
      summary: `${p.status === 'paid' ? `Recorded ${c.charge_rwf ?? 0} RWF storage payment (${p.method})` : 'Waived the storage charge'} for collection ${c.id}`,
      after: collectionView(row),
    });
    return collectionView(row);
  }

  // ---------- Lists ----------

  async collectionsOfBatch(batchId: string) {
    return (await this.db.query('SELECT * FROM collections WHERE batch_id = $1 ORDER BY collected_at DESC', [batchId])).map(collectionView);
  }

  async movementsOfBatch(batchId: string) {
    return (await this.db.query('SELECT * FROM stock_movements WHERE batch_id = $1 ORDER BY at, id', [batchId])).map(movementView);
  }

  /** Everything the farmer's batch went through, oldest first: stored, moved, collected. */
  async history(batch: any) {
    const [movements, collections] = await Promise.all([this.movementsOfBatch(batch.id), this.collectionsOfBatch(batch.id)]);
    return { movements, collections };
  }
}
