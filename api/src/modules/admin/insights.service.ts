import { Injectable } from '@nestjs/common';

import { Database } from '../../common/database.service.js';
import { rules } from '../../config.js';
import { kigaliMidnight, readingView, type RoomRow, RoomsService } from '../rooms/rooms.service.js';

const DAY = 86_400_000;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export interface HealthFactor {
  key: string;
  label: string;
  /** Points lost (0 = no problem). */
  lost: number;
  detail: string;
}

/** Numbers for the admin portal: room health, the overview and analytics. */
/** 270 → "4 h 30 min", 45 → "45 min". */
const duration = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};

@Injectable()
export class InsightsService {
  constructor(
    private db: Database,
    private rooms: RoomsService
  ) {}

  /**
   * Room health, 0–100, explained. Each factor says how many points it took off and why, so a
   * low score always comes with something to check.
   *   40  time in the safe range (last 24 h)
   *   25  data received (last 24 h)
   *   20  equipment margin: Peltier hot side and power reserve, or ice bank and battery
   *   15  open incidents
   */
  async health(room: RoomRow) {
    const now = Date.now();
    const summary = await this.rooms.summarize(room, now - DAY, now);
    const factors: HealthFactor[] = [];

    const outShare = summary.minutesOutOfRange / 1440;
    factors.push({
      key: 'range',
      label: 'Time in safe range',
      lost: Math.round(40 * clamp01(outShare * 4)), // 6 h out of range = all 40 points
      detail: summary.minutesOutOfRange ? `${duration(summary.minutesOutOfRange)} outside ${summary.safeMin}–${summary.safeMax}°C in the last 24 h` : 'In range all day',
    });
    const missing = summary.minutesNoData / 1440;
    factors.push({
      key: 'data',
      label: 'Data received',
      lost: Math.round(25 * clamp01(missing * 2)),
      detail: summary.minutesNoData ? `${duration(summary.minutesNoData)} without readings in the last 24 h` : 'Complete',
    });

    const eq = await this.db.one(
      `SELECT max(hot_side) AS hot_max, avg(cooler_duty) AS duty_avg, min(battery) AS battery_min, avg(ice_bank) AS ice_avg
         FROM readings WHERE room_id = $1 AND at > now() - interval '24 hours'`,
      [room.id]
    );
    if (room.cooling_type === 'peltier') {
      const hot = eq?.hot_max as number | null;
      const hotLost = hot === null ? 5 : Math.round(12 * clamp01((hot - 45) / (rules.hotSideAlertC + 10 - 45)));
      factors.push({ key: 'hotSide', label: 'Cooler hot side', lost: hotLost, detail: hot === null ? 'No hot-side readings' : `Highest ${hot.toFixed(1)}°C (limit ${rules.hotSideAlertC}°C)` });
      const duty = eq?.duty_avg as number | null;
      // Trend: is the cooler working harder than over the previous week? (dirty heatsink, failing fan, door seal)
      const week = await this.db.one(
        "SELECT avg(cooler_duty) AS duty FROM readings WHERE room_id = $1 AND at BETWEEN now() - interval '8 days' AND now() - interval '24 hours'",
        [room.id]
      );
      const trend = duty !== null && week?.duty ? (duty - week.duty) / week.duty : null;
      const reserveLost = duty === null ? 0 : Math.round(5 * clamp01((duty - 70) / 25));
      const trendLost = trend !== null && trend > 0.1 ? Math.round(3 * clamp01((trend - 0.1) / 0.3)) : 0;
      factors.push({
        key: 'coolerLoad',
        label: 'Cooler power reserve',
        lost: reserveLost + trendLost,
        detail:
          duty === null
            ? 'No power readings'
            : `Average ${Math.round(duty)}% power${
                trend === null ? '' : Math.abs(trend) < 0.05 ? ', about the same as the previous week' : `, ${trend > 0 ? `${Math.round(trend * 100)}% harder` : `${Math.round(-trend * 100)}% easier`} than the previous week`
              }`,
      });
    } else {
      const ice = eq?.ice_avg as number | null;
      const battery = eq?.battery_min as number | null;
      const lost = Math.round(10 * clamp01(((ice ?? 0) - 0) / 3)) + Math.round(10 * clamp01((40 - (battery ?? 100)) / 30));
      factors.push({ key: 'equipment', label: 'Ice bank and battery', lost, detail: `Ice bank average ${ice === null ? '–' : ice.toFixed(1) + '°C'}, lowest battery ${battery ?? '–'}%` });
    }

    const open = await this.db.query('SELECT type FROM room_incidents WHERE room_id = $1 AND ended_at IS NULL', [room.id]);
    factors.push({ key: 'incidents', label: 'Open incidents', lost: Math.min(15, open.length * 8), detail: open.length ? open.map((i) => i.type).join(', ') : 'None' });

    const score = Math.max(0, 100 - factors.reduce((s, f) => s + f.lost, 0));
    return { score, grade: score >= 85 ? 'good' : score >= 60 ? 'watch' : 'poor', factors, summary };
  }

  /** Every cold room with its live state, for the overview and the rooms table. */
  async roomCards(scope: string[] | null = null) {
    const rows = await this.db.query(
      `SELECT c.*, r.reading,
              (SELECT count(*) FROM room_incidents i WHERE i.room_id = c.id AND i.ended_at IS NULL) AS open_incidents,
              (SELECT count(*) FROM users u WHERE u.cold_room_id = c.id AND u.role = 'farmer') AS farmers,
              (SELECT coalesce(sum(CASE WHEN unit = 'crate' THEN quantity ELSE ceil(quantity / 20.0) END), 0) FROM batches b WHERE b.cold_room_id = c.id AND b.status = 'stored') AS crates
         FROM cold_rooms c
         LEFT JOIN LATERAL (SELECT row_to_json(x) AS reading FROM (SELECT * FROM readings WHERE room_id = c.id ORDER BY at DESC LIMIT 1) x) r ON true
        WHERE ($1::text[] IS NULL OR c.id = ANY($1))
        ORDER BY c.status, c.id`,
      [scope]
    );
    return Promise.all(
      rows.map(async (c) => {
        const health = c.status === 'retired' ? null : await this.health(c);
        return {
          id: c.id,
          legacyId: c.legacy_id,
          name: c.name,
          district: c.district,
          sector: c.sector,
          crop: c.crop,
          coolingType: c.cooling_type,
          peltierModules: c.peltier_modules,
          lastUploadVia: c.last_upload_via,
          energyTodayWh: c.status === 'retired' ? null : await this.rooms.energyToday(c.id),
          control: c.control,
          status: c.status,
          capacityCrates: c.capacity_crates,
          storedCrates: c.crates,
          farmers: c.farmers,
          openIncidents: c.open_incidents,
          firmwareVersion: c.firmware_version,
          firmwareChannel: c.firmware_channel,
          lastUploadAt: c.last_upload_at,
          latitude: c.latitude,
          longitude: c.longitude,
          reading: c.reading ? readingView(c.reading) : null,
          health: health && { score: health.score, grade: health.grade, factors: health.factors },
          safeMin: health?.summary.safeMin,
          safeMax: health?.summary.safeMax,
        };
      })
    );
  }

  /** `scope` = a cold room operator's rooms: they see their rooms, stock and incidents, not people or the market. */
  async overview(scope: string[] | null = null) {
    const now = Date.now();
    const rooms = await this.roomCards(scope);
    if (scope) return this.operatorOverview(scope, rooms, now);
    const people = await this.db.one(
      `SELECT count(*) FILTER (WHERE role = 'farmer') AS farmers, count(*) FILTER (WHERE role = 'buyer') AS buyers,
              count(*) FILTER (WHERE locked_at IS NOT NULL) AS locked, count(*) FILTER (WHERE status = 'suspended') AS suspended,
              count(*) FILTER (WHERE created_at > now() - interval '7 days') AS new_7d
         FROM users`
    );
    const stock = await this.db.one(
      `SELECT count(*) AS batches,
              coalesce(sum(quantity) FILTER (WHERE unit = 'kg'), 0) AS kg,
              coalesce(sum(quantity) FILTER (WHERE unit = 'crate'), 0) AS crates
         FROM batches WHERE status = 'stored'`
    );
    const market = await this.db.one(
      `SELECT (SELECT count(*) FROM listings WHERE status = 'active' AND moderation = 'visible') AS active_listings,
              (SELECT count(*) FROM listings WHERE moderation = 'hidden') AS hidden_listings,
              count(*) FILTER (WHERE created_at >= $1) AS orders_today,
              count(*) FILTER (WHERE status = 'pending') AS orders_pending,
              coalesce(sum(quantity * price_per_unit) FILTER (WHERE status = 'accepted' AND updated_at > now() - interval '30 days'), 0) AS gmv_30d,
              coalesce(sum(quantity * price_per_unit) FILTER (WHERE status = 'accepted' AND updated_at BETWEEN now() - interval '60 days' AND now() - interval '30 days'), 0) AS gmv_prev_30d
         FROM orders`,
      [new Date(kigaliMidnight(now))]
    );
    const certs = await this.db.query(
      `SELECT data->'conditions'->>'freshness' AS freshness, count(*) AS n
         FROM certificates WHERE issued_at > now() - interval '30 days' AND revoked_at IS NULL GROUP BY 1`
    );
    const incidents = await this.db.query(
      `SELECT i.*, c.name AS room_name FROM room_incidents i JOIN cold_rooms c ON c.id = i.room_id
        WHERE i.ended_at IS NULL ORDER BY i.started_at DESC LIMIT 20`
    );
    const energyToday = await this.rooms.energy(null, kigaliMidnight(now), now);
    const active = rooms.filter((r) => r.status === 'active');
    const online = active.filter((r) => r.reading?.online).length;
    const avgHealth = active.length ? Math.round(active.reduce((s, r) => s + (r.health?.score ?? 0), 0) / active.length) : null;
    return {
      generatedAt: new Date(now).toISOString(),
      kpis: {
        rooms: active.length,
        roomsOnline: online,
        avgHealth,
        farmers: people!.farmers,
        buyers: people!.buyers,
        newUsers7d: people!.new_7d,
        lockedAccounts: people!.locked,
        suspendedAccounts: people!.suspended,
        storedBatches: stock!.batches,
        storedKg: stock!.kg,
        storedCrates: stock!.crates,
        activeListings: market!.active_listings,
        hiddenListings: market!.hidden_listings,
        ordersToday: market!.orders_today,
        ordersPending: market!.orders_pending,
        gmv30d: market!.gmv_30d,
        gmvPrev30d: market!.gmv_prev_30d,
        energyTodayWh: energyToday,
        certificates30d: Object.fromEntries(certs.map((c) => [c.freshness, c.n])),
      },
      rooms,
      openIncidents: incidents.map((i) => ({ id: i.id, roomId: i.room_id, roomName: i.room_name, type: i.type, startedAt: i.started_at, details: i.details, acknowledgedAt: i.acknowledged_at })),
    };
  }

  private async operatorOverview(scope: string[], rooms: Awaited<ReturnType<InsightsService['roomCards']>>, now: number) {
    const stock = await this.db.one(
      `SELECT count(*) AS batches, coalesce(sum(quantity) FILTER (WHERE unit = 'kg'), 0) AS kg, coalesce(sum(quantity) FILTER (WHERE unit = 'crate'), 0) AS crates,
              count(*) FILTER (WHERE collection_requested_at IS NOT NULL) AS to_collect
         FROM batches WHERE status = 'stored' AND cold_room_id = ANY($1)`,
      [scope]
    );
    const incidents = await this.db.query(
      `SELECT i.*, c.name AS room_name FROM room_incidents i JOIN cold_rooms c ON c.id = i.room_id
        WHERE i.ended_at IS NULL AND i.room_id = ANY($1) ORDER BY i.started_at DESC LIMIT 20`,
      [scope]
    );
    const active = rooms.filter((r) => r.status === 'active');
    return {
      generatedAt: new Date(now).toISOString(),
      scoped: true,
      kpis: {
        rooms: active.length,
        roomsOnline: active.filter((r) => r.reading?.online).length,
        avgHealth: active.length ? Math.round(active.reduce((s, r) => s + (r.health?.score ?? 0), 0) / active.length) : null,
        storedBatches: stock!.batches, storedKg: stock!.kg, storedCrates: stock!.crates, toCollect: stock!.to_collect,
        energyTodayWh: active.reduce((s, r) => s + (r.energyTodayWh ?? 0), 0),
      },
      rooms,
      openIncidents: incidents.map((i) => ({ id: i.id, roomId: i.room_id, roomName: i.room_name, type: i.type, startedAt: i.started_at, details: i.details, acknowledgedAt: i.acknowledged_at })),
    };
  }

  /** Daily series for the analytics page. `days` = 7, 30 or 90. Days are Kigali days. */
  async analytics(days: number) {
    const from = new Date(kigaliMidnight() - (days - 1) * DAY);
    const tz = 'Africa/Kigali';

    const compliance = await this.db.query(
      `SELECT to_char(r.at AT TIME ZONE '${tz}', 'YYYY-MM-DD') AS day, c.id AS room_id, c.name AS room,
              round(100.0 * avg(CASE WHEN r.chamber BETWEEN (p.data->'app'->>'safeMin')::real AND (p.data->'app'->>'safeMax')::real THEN 1 ELSE 0 END), 1) AS in_range,
              round(avg(r.chamber)::numeric, 2) AS avg_temp,
              round(avg(r.humidity)::numeric, 1) AS avg_humidity,
              count(*) AS readings
         FROM readings r JOIN cold_rooms c ON c.id = r.room_id JOIN crop_profiles p ON p.crop = c.crop
        WHERE r.at >= $1 AND r.chamber IS NOT NULL
        GROUP BY 1, 2, 3 ORDER BY 1, 3`,
      [from]
    );
    const energy = await this.db.query(
      `SELECT day, room_id, round(sum(w * LEAST(dt, 300)) / 3600) AS wh FROM (
         SELECT to_char(at AT TIME ZONE '${tz}', 'YYYY-MM-DD') AS day, room_id, cooler_voltage * cooler_current AS w,
                extract(epoch FROM lead(at) OVER (PARTITION BY room_id ORDER BY at) - at) AS dt
           FROM readings WHERE at >= $1) x
        WHERE w IS NOT NULL AND dt IS NOT NULL GROUP BY 1, 2 ORDER BY 1`,
      [from]
    );
    const orders = await this.db.query(
      `SELECT to_char(created_at AT TIME ZONE '${tz}', 'YYYY-MM-DD') AS day,
              count(*) AS orders,
              count(*) FILTER (WHERE status = 'accepted') AS accepted,
              coalesce(sum(quantity * price_per_unit) FILTER (WHERE status = 'accepted'), 0) AS gmv
         FROM orders WHERE created_at >= $1 GROUP BY 1 ORDER BY 1`,
      [from]
    );
    const prices = await this.db.query(
      `SELECT crop, unit, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_unit)) AS median,
              min(price_per_unit) AS min, max(price_per_unit) AS max, count(*) AS listings
         FROM listings WHERE created_at >= $1 GROUP BY 1, 2 ORDER BY 1`,
      [from]
    );
    const certificates = await this.db.query(
      `SELECT to_char(issued_at AT TIME ZONE '${tz}', 'YYYY-MM-DD') AS day, data->'conditions'->>'freshness' AS freshness, count(*) AS n
         FROM certificates WHERE issued_at >= $1 GROUP BY 1, 2 ORDER BY 1`,
      [from]
    );
    const checkins = await this.db.query(
      `SELECT to_char(stored_at AT TIME ZONE '${tz}', 'YYYY-MM-DD') AS day, count(*) AS batches,
              coalesce(sum(CASE WHEN unit = 'kg' THEN quantity ELSE quantity * 20 END), 0) AS kg
         FROM batches WHERE stored_at >= $1 GROUP BY 1 ORDER BY 1`,
      [from]
    );
    const signups = await this.db.query(
      `SELECT to_char(created_at AT TIME ZONE '${tz}', 'YYYY-MM-DD') AS day, role, count(*) AS n
         FROM users WHERE created_at >= $1 GROUP BY 1, 2 ORDER BY 1`,
      [from]
    );
    const districts = await this.db.query(
      `SELECT d.district,
              (SELECT count(*) FROM users u WHERE u.district = d.district AND u.role = 'farmer') AS farmers,
              (SELECT count(*) FROM users u WHERE u.district = d.district AND u.role = 'buyer') AS buyers,
              (SELECT count(*) FROM cold_rooms c WHERE c.district = d.district AND c.status <> 'retired') AS rooms,
              (SELECT coalesce(sum(o.quantity * o.price_per_unit), 0) FROM orders o JOIN listings l ON l.id = o.listing_id JOIN cold_rooms c ON c.id = l.cold_room_id
                WHERE c.district = d.district AND o.status = 'accepted' AND o.updated_at >= $1) AS gmv
         FROM (SELECT district FROM users UNION SELECT district FROM cold_rooms) d ORDER BY gmv DESC, farmers DESC`,
      [from]
    );
    const topFarmers = await this.db.query(
      `SELECT u.id, u.name, u.district, count(o.*) AS orders, coalesce(sum(o.quantity * o.price_per_unit), 0) AS gmv
         FROM users u JOIN orders o ON o.farmer_id = u.id AND o.status = 'accepted' AND o.updated_at >= $1
        GROUP BY u.id ORDER BY gmv DESC LIMIT 10`,
      [from]
    );
    const storage = await this.db.one(
      `SELECT round(avg(extract(epoch FROM coalesce(removed_at, now()) - stored_at) / 3600)::numeric, 1) AS avg_hours
         FROM batches WHERE stored_at >= $1`,
      [from]
    );
    return { from: from.toISOString(), days, compliance, energy, orders, prices, certificates, checkins, signups, districts, topFarmers, avgStorageHours: storage?.avg_hours ?? null };
  }
}
