import { rules } from './config.js';
import { getProfile, type RoomConditions } from './crops.js';
import { one, query, type Db, pool } from './db.js';
import { notFound } from './errors.js';
import { summarize, type ConditionSummary, type Sample } from './freshness.js';
import { CROPS } from './validate.js';

const MIN = 60_000;

export interface RoomRow {
  id: string;
  name: string;
  district: string;
  sector: string;
  crop: string;
  capacity_crates: number;
  device_token_hash: string | null;
  cooling_type: 'peltier' | 'ice_bank';
}

export async function getRoomRow(id: string, db: Db = pool): Promise<RoomRow> {
  const room = await one<RoomRow>('SELECT * FROM cold_rooms WHERE id = $1', [id], db);
  if (!room) throw notFound();
  return room;
}

export async function roomConditions(room: RoomRow): Promise<RoomConditions> {
  return (await getProfile(room.crop)).app;
}

/** Room as the app sees it: the safe ranges come from the room's crop profile. */
export async function roomView(room: RoomRow) {
  const profile = await getProfile(room.crop);
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
    allowedCrops: [room.crop, ...profile.compatible_in_same_room].filter((c) => (CROPS as readonly string[]).includes(c)),
  };
}

const round1 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

export function readingView(r: any, now = Date.now()) {
  const watts = r.cooler_voltage !== null && r.cooler_current !== null && r.cooler_voltage !== undefined ? r.cooler_voltage * r.cooler_current : null;
  return {
    at: new Date(r.at).toISOString(),
    chamber: r.chamber,
    coilOutlet: r.coil_outlet,
    product: r.product,
    humidity: r.humidity === null ? null : Math.round(r.humidity),
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
    online: now - new Date(r.at).getTime() <= rules.onlineWindowMin * MIN,
  };
}

export async function latestReading(roomId: string) {
  const r = await one('SELECT * FROM readings WHERE room_id = $1 ORDER BY at DESC LIMIT 1', [roomId]);
  return r ? readingView(r) : null;
}

/** Freshness of the room between two times, from real readings. */
export async function summarizeRoom(room: RoomRow, from: number, to = Date.now()): Promise<ConditionSummary> {
  const rows = await query<{ at: Date; chamber: number | null; humidity: number | null }>(
    `(SELECT at, chamber, humidity FROM readings WHERE room_id = $1 AND at < $2 ORDER BY at DESC LIMIT 1)
     UNION ALL
     (SELECT at, chamber, humidity FROM readings WHERE room_id = $1 AND at >= $2 AND at <= $3)
     ORDER BY at`,
    [room.id, new Date(from), new Date(to)]
  );
  const samples: Sample[] = rows.map((r) => ({ at: r.at.getTime(), chamber: r.chamber, humidity: r.humidity }));
  return summarize(samples, from, to, await roomConditions(room), rules.maxReadingGapMin);
}

// Listing and stock screens ask for the same batch often; a short cache keeps that cheap.
const summaryCache = new Map<string, { at: number; value: ConditionSummary }>();

export async function summarizeBatch(batch: { id: string; cold_room_id: string; stored_at: Date; status: string; removed_at: Date | null }) {
  const hit = summaryCache.get(batch.id);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const room = await getRoomRow(batch.cold_room_id);
  const to = batch.status === 'removed' && batch.removed_at ? new Date(batch.removed_at).getTime() : Date.now();
  const value = await summarizeRoom(room, new Date(batch.stored_at).getTime(), to);
  summaryCache.set(batch.id, { at: Date.now(), value });
  return value;
}

export function clearSummaryCache() {
  summaryCache.clear();
}

/** Averages per time bucket, oldest first. Buckets without data are left out. */
export async function history(roomId: string, range: '24h' | '7d') {
  const hours = range === '24h' ? 24 : 168;
  const bucketMin = range === '24h' ? 30 : 180;
  const rows = await query(
    `SELECT to_timestamp(floor(extract(epoch FROM at) / $3) * $3) AS at,
            avg(chamber)::real AS chamber, avg(humidity)::real AS humidity, avg(ice_bank)::real AS ice_bank,
            avg(outside)::real AS outside, round(avg(battery))::int AS battery,
            bool_or(solar_charging) AS solar_charging, bool_or(pump) AS pump, bool_or(fan) AS fan,
            bool_or(compressor) AS compressor, bool_or(door_open) AS door_open,
            min(coil_outlet)::real AS coil_outlet, avg(product)::real AS product,
            max(hot_side)::real AS hot_side, avg(cooler_duty)::real AS cooler_duty,
            avg(cooler_current)::real AS cooler_current, avg(cooler_voltage)::real AS cooler_voltage, bool_or(hot_fan) AS hot_fan
       FROM readings
      WHERE room_id = $1 AND at > now() - make_interval(hours => $2)
      GROUP BY 1 ORDER BY 1`,
    [roomId, hours, bucketMin * 60]
  );
  return rows.map((r) => {
    const v = readingView(r);
    return { ...v, chamber: round1(v.chamber), iceBank: round1(v.iceBank), outside: round1(v.outside), online: true };
  });
}

/**
 * Energy the cooler used since midnight in Kigali, in Wh, from the power meter readings.
 * Each reading counts until the next one (at most 5 min, so an outage adds nothing).
 */
export async function energyToday(roomId: string, now = Date.now()) {
  const KIGALI = 2 * 3_600_000; // UTC+2, no daylight saving
  const midnight = Math.floor((now + KIGALI) / 86_400_000) * 86_400_000 - KIGALI;
  const [row] = await query<{ wh: number | null }>(
    `SELECT sum(w * LEAST(dt, 300)) / 3600 AS wh FROM (
       SELECT cooler_voltage * cooler_current AS w,
              extract(epoch FROM lead(at) OVER (ORDER BY at) - at) AS dt
         FROM readings WHERE room_id = $1 AND at >= $2) x
      WHERE w IS NOT NULL AND dt IS NOT NULL`,
    [roomId, new Date(midnight)]
  );
  return row?.wh === null || row?.wh === undefined ? null : Math.round(row.wh);
}
