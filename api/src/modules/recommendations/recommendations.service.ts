import { Injectable } from '@nestjs/common';

import { Database } from '../../common/database.service.js';
import { rules } from '../../config.js';
import { CropsService } from '../crops/crops.service.js';
import type { RoomRow } from '../rooms/rooms.service.js';

export interface Recommendation {
  /** The apps translate by key; `text` is the English wording for the portal. */
  key: string;
  severity: 'info' | 'warn' | 'alert';
  params: Record<string, string | number>;
  text: string;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Plain rules over the room's own readings and its crop profile: what to check and what to do.
 * These are advice for the people running the room. They do not predict how long a crop will last.
 */
@Injectable()
export class RecommendationsService {
  constructor(
    private db: Database,
    private crops: CropsService
  ) {}

  async forRoom(room: RoomRow) {
    const profile = await this.crops.get(room.crop);
    const app = profile.app;
    const ctl = profile.controller as Record<string, number>;
    const items: Recommendation[] = [];
    const add = (key: string, severity: Recommendation['severity'], params: Recommendation['params'], text: string) => items.push({ key, severity, params, text });

    const [last, short, mid, day, stock] = await Promise.all([
      this.db.one('SELECT max(at) AS at FROM readings WHERE room_id = $1', [room.id]),
      this.db.one("SELECT avg(chamber) AS chamber, avg(cooler_duty) AS duty, count(*) AS n FROM readings WHERE room_id = $1 AND at > now() - interval '2 hours'", [room.id]),
      this.db.one("SELECT avg(humidity) AS humidity, max(hot_side) AS hot FROM readings WHERE room_id = $1 AND at > now() - interval '6 hours'", [room.id]),
      this.db.one(
        `SELECT min(battery) AS battery_min, count(*) AS n, count(*) FILTER (WHERE source = 'simulated') AS simulated,
                avg(CASE WHEN door_open THEN 1.0 ELSE 0.0 END) FILTER (WHERE door_open IS NOT NULL) AS door_share,
                count(*) FILTER (WHERE extract(hour FROM at AT TIME ZONE 'Africa/Kigali') BETWEEN 9 AND 15 AND battery IS NOT NULL) AS day_n,
                bool_or(solar_charging) FILTER (WHERE extract(hour FROM at AT TIME ZONE 'Africa/Kigali') BETWEEN 9 AND 15) AS day_charged
           FROM readings WHERE room_id = $1 AND at > now() - interval '24 hours'`,
        [room.id]
      ),
      this.db.one("SELECT count(*) AS n FROM batches WHERE cold_room_id = $1 AND status = 'stored' AND collection_requested_at < now() - interval '24 hours'", [room.id]),
    ]);

    const silentMin = last?.at ? (Date.now() - new Date(last.at).getTime()) / 60_000 : null;
    if (silentMin === null || silentMin > rules.offlineAlertMin) {
      add('offline', 'alert', { minutes: silentMin === null ? -1 : Math.round(silentMin) }, 'No readings from the controller: check its power and its internet link. The room keeps cooling by itself while it is offline.');
    }
    const chamber = num(short?.chamber);
    if (chamber !== null && chamber > app.safeMax) {
      add('chamberWarm', 'alert', { temp: Math.round(chamber * 10) / 10, max: app.safeMax }, `The chamber has averaged ${chamber.toFixed(1)}°C for 2 hours (safe up to ${app.safeMax}°C). Check that the door is closed and sealed, and that no large warm load went in.`);
    }
    const duty = num(short?.duty);
    if (duty !== null && duty >= 90 && chamber !== null && chamber > ctl.targetC + 0.5) {
      add('coolerStrain', 'warn', { duty: Math.round(duty) }, 'The cooler is at full power and the room is still above target. Pre-cool produce before loading, load in smaller amounts, and check the door seal.');
    }
    const hot = num(mid?.hot);
    if (hot !== null && hot > rules.hotSideAlertC - 5) {
      add('hotSideHigh', 'warn', { hot: Math.round(hot) }, `The cooler's hot side reached ${Math.round(hot)}°C. Clean the hot-side heatsink and check that its fan runs and has free air around it.`);
    }
    const humidity = num(mid?.humidity);
    if (humidity !== null && humidity < app.humidityMin) {
      const how = Array.isArray(profile.humidity_method) ? String(profile.humidity_method[0]) : 'Use perforated crate liners or a damp layer on the floor.';
      add('humidityLow', 'warn', { humidity: Math.round(humidity), min: app.humidityMin }, `Humidity has averaged ${Math.round(humidity)}% (it should stay above ${app.humidityMin}%). ${how}`);
    }
    if (humidity !== null && humidity > app.humidityMax) {
      add('humidityHigh', 'warn', { humidity: Math.round(humidity), max: app.humidityMax }, `Humidity has averaged ${Math.round(humidity)}% (above ${app.humidityMax}%): mould can spread. Remove standing water and check the crate liners.`);
    }
    const battery = num(day?.battery_min);
    if (battery !== null && battery < 30) {
      add('batteryLow', 'warn', { battery }, `The battery fell to ${battery}% in the last day. Check the solar panel, its connections and the charge controller.`);
    }
    if (day && day.day_n >= 30 && day.day_charged === false) {
      add('solarNotCharging', 'warn', {}, 'The solar panel did not charge the battery during the day. It may be shaded, dirty or disconnected.');
    }
    const door = num(day?.door_share);
    if (door !== null && door > 0.05) {
      add('doorOpenOften', 'info', { percent: Math.round(door * 100) }, `The door was open ${Math.round(door * 100)}% of the time in the last day. Keep it closed between loads: every opening warms the room.`);
    }
    if (stock && stock.n > 0) {
      add('collectionWaiting', 'info', { batches: stock.n }, `${stock.n} batch${stock.n === 1 ? ' has' : 'es have'} been waiting for collection for more than a day.`);
    }
    if (day && day.simulated > 0) {
      add('simulatedData', 'info', { readings: day.simulated }, `${day.simulated} of the last day's readings came from the development simulator, not from a real controller.`);
    }
    const tips = Array.isArray(profile.handling_rules) ? (profile.handling_rules as unknown[]).map(String) : [];
    return { items, cropTips: { crop: room.crop, tips } };
  }
}
