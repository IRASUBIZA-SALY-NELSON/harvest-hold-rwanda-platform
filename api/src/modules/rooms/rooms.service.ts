import { Injectable } from '@nestjs/common';

import { notFound } from '../../common/api-error.js';
import { Database, type Queryable } from '../../common/database.service.js';
import { roomCode } from '../../common/ids.js';
import { CROPS } from '../../common/validate.js';
import { rules } from '../../config.js';
import { summarize, type ConditionSummary, type Sample } from '../../domain/freshness.js';
import { CropsService, type RoomConditions } from '../crops/crops.service.js';

const MIN = 60_000;
const KIGALI = 2 * 3_600_000; // UTC+2, no daylight saving

export interface RoomRow {
  id: string;
  name: string;
  district: string;
  sector: string;
  crop: string;
  capacity_crates: number;
  device_token_hash: string | null;
  cooling_type: 'peltier' | 'ice_bank';
  [key: string]: any;
}

const round1 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

/** Turns a readings row into the JSON the apps use. */
export function readingView(r: any, now = Date.now()) {
  const watts = r.cooler_voltage !== null && r.cooler_current !== null && r.cooler_voltage !== undefined ? r.cooler_voltage * r.cooler_current : null;
  return {
    at: new Date(r.at).toISOString(),
    chamber: r.chamber,
    coilOutlet: r.coil_outlet,
    product: r.product,
    humidity: r.humidity === null || r.humidity === undefined ? null : Math.round(r.humidity),
    iceBank: r.ice_bank,
    outside: r.outside,
    battery: r.battery,
    solarCharging: !!r.solar_charging,
    pump: !!r.pump,
    fan: !!r.fan,
    compressor: !!r.compressor,
    doorOpen: !!r.door_open,
    // Peltier rooms
    hotSide: round1(r.hot_side),
    coolerDuty: r.cooler_duty === null || r.cooler_duty === undefined ? null : Math.round(r.cooler_duty),
    coolerPower: watts === null ? null : Math.round(watts),
    hotFan: !!r.hot_fan,
    // Power, battery and solar (where installed)
    coolerCurrent: round1(r.cooler_current),
    coolerVoltage: round1(r.cooler_voltage),
    batteryV: round1(r.battery_v),
    solarV: round1(r.solar_v),
    solarCurrent: r.solar_current === null || r.solar_current === undefined ? null : Math.round(r.solar_current * 100) / 100,
    solarPower: r.solar_current === null || r.solar_current === undefined || r.solar_v === null || r.solar_v === undefined ? null : Math.round(r.solar_current * r.solar_v),
    humidifier: !!r.humidifier,
    /** "device" = a real controller sent it; "simulated" = the development simulator. */
    source: (r.source ?? 'device') as 'device' | 'simulated',
    simulated: r.source === 'simulated',
    /** Which link it arrived on. */
    via: (r.via ?? 'https') as 'https' | 'mqtt',
    online: now - new Date(r.at).getTime() <= rules.onlineWindowMin * MIN,
  };
}

/** Start of today in Kigali, as a UTC timestamp. */
export const kigaliMidnight = (now = Date.now()) => Math.floor((now + KIGALI) / 86_400_000) * 86_400_000 - KIGALI;

@Injectable()
export class RoomsService {
  // Listing and stock screens ask for the same batch often; a short cache keeps that cheap.
  private summaryCache = new Map<string, { at: number; value: ConditionSummary }>();

  constructor(
    private db: Database,
    private crops: CropsService
  ) {}

  /** By id (HHR-001). A room's old id is accepted too, so controllers set up before the renaming keep working. */
  async getRow(id: string, db: Queryable = this.db.pool): Promise<RoomRow> {
    const room = await this.db.one<RoomRow>('SELECT * FROM cold_rooms WHERE id = $1 OR legacy_id = $1 ORDER BY (id = $1) DESC LIMIT 1', [id], db);
    if (!room) throw notFound();
    return room;
  }

  async conditions(room: RoomRow): Promise<RoomConditions> {
    return (await this.crops.get(room.crop)).app;
  }

  /** Room as the app sees it: the safe ranges come from the room's crop profile. */
  async view(room: RoomRow) {
    const profile = await this.crops.get(room.crop);
    const c = profile.app;
    return {
      id: room.id,
      name: room.name,
      district: room.district,
      sector: room.sector,
      crop: room.crop,
      /** "peltier" (prototype) or "ice_bank" (full-size design). */
      coolingType: room.cooling_type,
      safeMin: c.safeMin,
      safeMax: c.safeMax,
      humidityMin: c.humidityMin,
      humidityMax: c.humidityMax,
      capacityCrates: room.capacity_crates,
      /** Crops that may be stored in this room (only crops the app knows). */
      allowedCrops: [room.crop, ...profile.compatible_in_same_room].filter((x) => (CROPS as readonly string[]).includes(x)),
    };
  }

  async latestReading(roomId: string) {
    const r = await this.db.one('SELECT * FROM readings WHERE room_id = $1 ORDER BY at DESC LIMIT 1', [roomId]);
    return r ? readingView(r) : null;
  }

  /** Freshness of the room between two times, from real readings. */
  async summarize(room: RoomRow, from: number, to = Date.now()): Promise<ConditionSummary> {
    const rows = await this.db.query<{ at: Date; chamber: number | null; humidity: number | null; source: string }>(
      `(SELECT at, chamber, humidity, source FROM readings WHERE room_id = $1 AND at < $2 ORDER BY at DESC LIMIT 1)
       UNION ALL
       (SELECT at, chamber, humidity, source FROM readings WHERE room_id = $1 AND at >= $2 AND at <= $3)
       ORDER BY at`,
      [room.id, new Date(from), new Date(to)]
    );
    const samples: Sample[] = rows.map((r) => ({ at: r.at.getTime(), chamber: r.chamber, humidity: r.humidity, simulated: r.source === 'simulated' }));
    return summarize(samples, from, to, await this.conditions(room), rules.maxReadingGapMin);
  }

  async summarizeBatch(batch: { id: string; cold_room_id: string; stored_at: Date; status: string; removed_at: Date | null }) {
    const hit = this.summaryCache.get(batch.id);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    const room = await this.getRow(batch.cold_room_id);
    const to = batch.status === 'removed' && batch.removed_at ? new Date(batch.removed_at).getTime() : Date.now();
    const value = await this.summarize(room, new Date(batch.stored_at).getTime(), to);
    this.summaryCache.set(batch.id, { at: Date.now(), value });
    return value;
  }

  clearSummaryCache() {
    this.summaryCache.clear();
  }

  /** Averages per time bucket, oldest first. Buckets without data are left out. */
  async history(roomId: string, range: '24h' | '7d' | '30d') {
    const hours = range === '24h' ? 24 : range === '7d' ? 168 : 720;
    const bucketMin = range === '24h' ? 30 : range === '7d' ? 180 : 720;
    const rows = await this.db.query(
      `SELECT to_timestamp(floor(extract(epoch FROM at) / $3) * $3) AS at,
              avg(chamber)::real AS chamber, avg(humidity)::real AS humidity, avg(ice_bank)::real AS ice_bank,
              avg(outside)::real AS outside, round(avg(battery))::int AS battery,
              bool_or(solar_charging) AS solar_charging, bool_or(pump) AS pump, bool_or(fan) AS fan,
              bool_or(compressor) AS compressor, bool_or(door_open) AS door_open,
              min(coil_outlet)::real AS coil_outlet, avg(product)::real AS product,
              max(hot_side)::real AS hot_side, avg(cooler_duty)::real AS cooler_duty,
              avg(cooler_current)::real AS cooler_current, avg(cooler_voltage)::real AS cooler_voltage, bool_or(hot_fan) AS hot_fan,
              avg(battery_v)::real AS battery_v, avg(solar_v)::real AS solar_v, avg(solar_current)::real AS solar_current,
              CASE WHEN bool_and(source = 'simulated') THEN 'simulated' ELSE 'device' END AS source
         FROM readings
        WHERE room_id = $1 AND at > now() - make_interval(hours => $2)
        GROUP BY 1 ORDER BY 1`,
      [roomId, hours, bucketMin * 60]
    );
    return rows.map((r) => {
      const v = readingView(r);
      return { ...v, chamber: round1(v.chamber), iceBank: round1(v.iceBank), outside: round1(v.outside), product: round1(v.product), online: true };
    });
  }

  /**
   * Energy the cooler used between two times, in Wh, from the power meter readings.
   * Each reading counts until the next one (at most 5 min, so an outage adds nothing).
   */
  async energy(roomId: string | null, from: number, to = Date.now()) {
    const row = await this.db.one<{ wh: number | null }>(
      `SELECT sum(w * LEAST(dt, 300)) / 3600 AS wh FROM (
         SELECT cooler_voltage * cooler_current AS w,
                extract(epoch FROM lead(at) OVER (PARTITION BY room_id ORDER BY at) - at) AS dt
           FROM readings WHERE ($1::text IS NULL OR room_id = $1) AND at >= $2 AND at <= $3) x
        WHERE w IS NOT NULL AND dt IS NOT NULL`,
      [roomId, new Date(from), new Date(to)]
    );
    return row?.wh === null || row?.wh === undefined ? null : Math.round(row.wh);
  }

  /** The next free room id: HHR-001, HHR-002, ... */
  async nextRoomId(db: Queryable = this.db.pool): Promise<string> {
    const row = await this.db.one<{ n: number }>("SELECT nextval('cold_room_seq') AS n", [], db);
    return roomCode(row!.n);
  }

  /** Energy the cooler used since midnight in Kigali, in Wh. */
  energyToday(roomId: string, now = Date.now()) {
    return this.energy(roomId, kigaliMidnight(now), now);
  }
}
