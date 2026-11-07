import { Injectable } from '@nestjs/common';

import { Database } from '../../common/database.service.js';
import { rules } from '../../config.js';
import { kigaliMidnight } from '../rooms/rooms.service.js';

const DAY = 86_400_000;
const TZ = 'Africa/Kigali';
const round = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Electricity, solar and battery for each room, and how the rooms compare. */
@Injectable()
export class EnergyService {
  constructor(private db: Database) {}

  /**
   * Crates held in a room over time, from the stock ledger: the average, and crate-days (a crate
   * held for one day is one crate-day). Kilograms count as crates of `kgPerCrate`.
   */
  private async crateDays(roomIds: string[], from: Date, to: Date) {
    const toCrates = (q: number, unit: string) => (unit === 'crate' ? q : q / rules.storage.kgPerCrate);
    const rows = await this.db.query(
      `SELECT room_id, kind, quantity, unit, at FROM stock_movements WHERE room_id = ANY($1) AND at <= $2 ORDER BY at, id`,
      [roomIds, to]
    );
    const out = new Map<string, { level: number; crateMs: number; last: number }>();
    for (const id of roomIds) out.set(id, { level: 0, crateMs: 0, last: from.getTime() });
    for (const m of rows) {
      const s = out.get(m.room_id)!;
      const t = Math.max(new Date(m.at).getTime(), from.getTime());
      s.crateMs += s.level * Math.max(0, t - s.last);
      s.last = Math.max(s.last, t);
      s.level += (m.kind === 'in' ? 1 : -1) * toCrates(m.quantity, m.unit);
    }
    const result = new Map<string, { avgCrates: number; crateDays: number }>();
    for (const [id, s] of out) {
      const crateMs = s.crateMs + s.level * Math.max(0, to.getTime() - s.last);
      result.set(id, { avgCrates: crateMs / Math.max(1, to.getTime() - from.getTime()), crateDays: crateMs / DAY });
    }
    return result;
  }

  /** `days` Kigali days ending now. `roomIds` null = every room. */
  async report(days: number, roomIds: string[] | null) {
    const from = new Date(kigaliMidnight() - (days - 1) * DAY);
    const to = new Date();
    const rooms = await this.db.query(
      "SELECT id, name, district, cooling_type, peltier_modules, status FROM cold_rooms WHERE status <> 'retired' AND ($1::text[] IS NULL OR id = ANY($1)) ORDER BY id",
      [roomIds]
    );
    if (!rooms.length) return { from: from.toISOString(), days, rooms: [], daily: [], totals: { kwh: 0, solarKwh: null as number | null } };
    const ids = rooms.map((r) => r.id);

    const daily = await this.db.query(
      `WITH r AS (
         SELECT x.room_id, x.at, x.chamber, x.outside, x.battery, x.cooler_duty, x.source, x.w, x.sw, x.dt,
                (x.chamber BETWEEN (p.data->'app'->>'safeMin')::real AND (p.data->'app'->>'safeMax')::real) AS in_range
           FROM (SELECT room_id, at, chamber, outside, battery, cooler_duty, source,
                        cooler_voltage * cooler_current AS w, solar_current * solar_v AS sw,
                        LEAST(extract(epoch FROM lead(at) OVER (PARTITION BY room_id ORDER BY at) - at), 300) AS dt
                   FROM readings WHERE at >= $1 AND room_id = ANY($2)) x
           JOIN cold_rooms c ON c.id = x.room_id JOIN crop_profiles p ON p.crop = c.crop)
       SELECT to_char(at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS day, room_id,
              sum(w * dt) FILTER (WHERE w IS NOT NULL AND dt IS NOT NULL) / 3600 AS wh,
              sum(sw * dt) FILTER (WHERE sw IS NOT NULL AND dt IS NOT NULL) / 3600 AS solar_wh,
              sum(dt) FILTER (WHERE w IS NOT NULL AND dt IS NOT NULL) AS metered_s,
              min(battery) AS battery_min, avg(battery) AS battery_avg,
              avg(chamber) AS avg_chamber, avg(outside) AS avg_outside, avg(cooler_duty) AS avg_duty,
              100.0 * avg(CASE WHEN in_range THEN 1 ELSE 0 END) FILTER (WHERE chamber IS NOT NULL) AS in_range,
              count(*) AS readings, count(*) FILTER (WHERE source = 'simulated') AS simulated
         FROM r GROUP BY 1, 2 ORDER BY 1, 2`,
      [from, ids]
    );
    const crates = await this.crateDays(ids, from, to);

    const per = rooms.map((room) => {
      const d = daily.filter((x) => x.room_id === room.id);
      const sum = (k: string) => d.reduce((s, x) => s + (x[k] ?? 0), 0);
      const hasMeter = d.some((x) => x.wh !== null);
      const hasSolar = d.some((x) => x.solar_wh !== null);
      const readings = sum('readings');
      const meteredH = sum('metered_s') / 3600;
      const wh = hasMeter ? sum('wh') : null;
      const solarWh = hasSolar ? sum('solar_wh') : null;
      const cr = crates.get(room.id)!;
      const weighted = (k: string) => {
        const xs = d.filter((x) => x[k] !== null);
        const n = xs.reduce((s, x) => s + x.readings, 0);
        return n ? xs.reduce((s, x) => s + x[k] * x.readings, 0) / n : null;
      };
      const avgChamber = weighted('avg_chamber');
      const avgOutside = weighted('avg_outside');
      const batteryMin = d.map((x) => x.battery_min).filter((v) => v !== null);
      return {
        roomId: room.id,
        name: room.name,
        district: room.district,
        coolingType: room.cooling_type as string,
        peltierModules: room.peltier_modules as number,
        /** What the room reports: the comparison only uses what is installed. */
        hasPowerMeter: hasMeter,
        hasBattery: d.some((x) => x.battery_min !== null),
        hasSolarMeter: hasSolar,
        kwh: wh === null ? null : round(wh / 1000, 2),
        avgWatts: wh !== null && meteredH > 0 ? Math.round(wh / meteredH) : null,
        solarKwh: solarWh === null ? null : round(solarWh / 1000, 2),
        solarSharePct: solarWh !== null && wh ? Math.min(100, Math.round((100 * solarWh) / wh)) : null,
        avgDutyPct: round(weighted('avg_duty')),
        batteryMinPct: batteryMin.length ? Math.min(...batteryMin) : null,
        batteryAvgPct: round(weighted('battery_avg')),
        avgChamberC: round(avgChamber, 1),
        avgOutsideC: round(avgOutside, 1),
        /** How far below the outside air the room is held: the harder this is, the more energy it takes. */
        liftC: avgChamber !== null && avgOutside !== null ? round(avgOutside - avgChamber, 1) : null,
        inRangePct: round(weighted('in_range')),
        avgCrates: round(cr.avgCrates, 1),
        crateDays: round(cr.crateDays, 1),
        /** Energy per crate stored per day: lower is more efficient. Null until crates have been held. */
        whPerCrateDay: wh !== null && cr.crateDays >= 0.5 ? Math.round(wh / cr.crateDays) : null,
        readings,
        simulatedReadings: sum('simulated'),
      };
    });
    const withEfficiency = per.filter((r) => r.whPerCrateDay !== null).sort((a, b) => a.whPerCrateDay! - b.whPerCrateDay!);
    const ranked = per.map((r) => ({ ...r, efficiencyRank: withEfficiency.findIndex((x) => x.roomId === r.roomId) + 1 || null }));
    const kwh = ranked.reduce((s, r) => s + (r.kwh ?? 0), 0);
    const solar = ranked.filter((r) => r.solarKwh !== null);
    return {
      from: from.toISOString(),
      days,
      rooms: ranked,
      daily: daily.map((x) => ({ day: x.day, roomId: x.room_id, wh: round(x.wh), solarWh: round(x.solar_wh), batteryMin: x.battery_min, simulated: x.simulated, readings: x.readings })),
      totals: { kwh: round(kwh, 2) ?? 0, solarKwh: solar.length ? round(solar.reduce((s, r) => s + r.solarKwh!, 0), 2) : null },
    };
  }
}
