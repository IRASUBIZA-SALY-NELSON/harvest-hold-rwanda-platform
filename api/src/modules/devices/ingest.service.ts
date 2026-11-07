import { Injectable } from '@nestjs/common';

import { ApiError } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { rules } from '../../config.js';
import { EventsService } from '../events/events.service.js';
import { MonitorService } from '../monitor/monitor.service.js';
import { readingView, type RoomRow } from '../rooms/rooms.service.js';

const MAX_BATCH = 500;
const MIN = 60_000;

/** Accepts a number in a sane range, otherwise null (a broken sensor must not poison the data). */
const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);

const COLUMNS = [
  'room_id', 'at', 'chamber', 'coil_outlet', 'product', 'humidity', 'ice_bank', 'outside', 'battery', 'battery_v', 'solar_v',
  'solar_charging', 'pump', 'fan', 'compressor', 'humidifier', 'door_open', 'device_alerts', 'profile_version',
  'hot_side', 'cooler_duty', 'cooler_current', 'cooler_voltage', 'hot_fan', 'solar_current', 'source', 'via',
];

export type Via = 'https' | 'mqtt';

function row(roomId: string, at: Date, b: any, via: Via): unknown[] {
  const alerts = Array.isArray(b.alerts) ? b.alerts.filter((a: unknown) => typeof a === 'string').slice(0, 20) : [];
  return [
    roomId, at,
    num(b.chamber, -30, 60), num(b.coilOutlet, -30, 60), num(b.product, -30, 60), num(b.humidity, 0, 100),
    num(b.iceBank, -40, 60), num(b.outside, -10, 60),
    typeof b.battery === 'number' && b.battery >= 0 && b.battery <= 100 ? Math.round(b.battery) : null,
    num(b.batteryV, 0, 40), num(b.solarV, 0, 60),
    bool(b.solarCharging), bool(b.pump), bool(b.fan), bool(b.compressor), bool(b.humidifier),
    b.door === 'open' ? true : b.door === 'closed' ? false : null,
    alerts,
    Number.isInteger(b.profileVersion) ? b.profileVersion : null,
    // Peltier controllers
    num(b.hotSide, -30, 125), num(b.coolerDuty, 0, 100), num(b.coolerCurrent, 0, 50), num(b.coolerVoltage, 0, 40), bool(b.hotFan),
    // Solar meter, only on rooms that have one
    num(b.solarCurrent, 0, 100),
    // Only the development simulator says "simulated"; anything else is a real controller.
    b.simulated === true ? 'simulated' : 'device',
    via,
  ];
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  skipped: number;
}

/**
 * Stores readings from a controller. HTTPS and MQTT both come here, so a reading means the same
 * thing whichever way it arrived.
 */
@Injectable()
export class IngestService {
  constructor(
    private db: Database,
    private monitor: MonitorService,
    private events: EventsService
  ) {}

  /**
   * Either one live reading (stored with the server's time) or a batch:
   *   { readings: [{ t: <UTC unix seconds>, chamber: 2.1, ... }, ...] }
   * Batches carry the controller's own timestamps, so readings kept in flash while offline
   * land at the right time. Readings older than 14 days or in the future are skipped, and a
   * reading already stored (same room and time) is ignored, so retries are safe.
   */
  async readings(room: RoomRow, body: any, via: Via, firmwareVersion?: number): Promise<IngestResult> {
    const b: any = body ?? {};
    const now = Date.now();

    let rows: unknown[][];
    let skipped = 0;
    if (Array.isArray(b.readings)) {
      if (b.readings.length > MAX_BATCH) throw new ApiError('tooManyReadings');
      rows = [];
      for (const r of b.readings) {
        const t = typeof r?.t === 'number' && Number.isFinite(r.t) ? r.t * 1000 : NaN;
        if (!(t >= now - rules.maxReadingAgeDays * 1440 * MIN && t <= now + rules.maxReadingAheadMin * MIN)) {
          skipped++;
          continue;
        }
        rows.push(row(room.id, new Date(Math.round(t / 1000) * 1000), r, via));
      }
    } else {
      rows = [row(room.id, new Date(now), b, via)];
    }

    let inserted: any[] = [];
    if (rows.length) {
      const values = rows.map((_, i) => `(${COLUMNS.map((__, j) => `$${i * COLUMNS.length + j + 1}`).join(',')})`).join(',');
      inserted = await this.db.query(
        `INSERT INTO readings (${COLUMNS.join(',')}) VALUES ${values} ON CONFLICT (room_id, at) DO NOTHING RETURNING *`,
        rows.flat()
      );
    }

    // What the controller says it is running (remote overrides), from its newest reading.
    const control = latestControl(b);
    await this.db.query(
      `UPDATE cold_rooms SET last_upload_at = now(), last_upload_via = $3, firmware_version = coalesce($2, firmware_version),
              control = coalesce($4::jsonb, control)
        WHERE id = $1`,
      [room.id, Number.isInteger(firmwareVersion) ? firmwareVersion : null, via, control ? JSON.stringify(control) : null]
    );

    // Live alerts only for a current reading: a backlog from last night must not alarm farmers now.
    const newest = inserted.reduce((a, r) => (!a || r.at > a.at ? r : a), null as any);
    if (newest && now - newest.at.getTime() <= rules.liveReadingMin * MIN) {
      this.events.publish({ type: 'reading', roomId: room.id, reading: readingView(newest) });
      await this.monitor.evaluateReading(room, newest, newest.at.getTime());
    }
    return { accepted: inserted.length, duplicates: rows.length - inserted.length, skipped };
  }
}

/** The overrides block of the newest reading in a body (`control: { target, cooling, insideFan, hotFan }`). */
function latestControl(b: any): Record<string, unknown> | null {
  const list = Array.isArray(b.readings) ? b.readings : [b];
  let best: any = null;
  for (const r of list) if (r?.control && typeof r.control === 'object' && (!best || (r.t ?? 0) >= (best.t ?? 0))) best = r;
  if (!best) return null;
  const c = best.control;
  const minutes = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1440 ? Math.round(v) : null);
  return {
    targetC: num(c.targetC, -5, 20),
    targetMinutesLeft: minutes(c.targetMinutesLeft),
    coolingOffMinutesLeft: minutes(c.coolingOffMinutesLeft),
    insideFanOnMinutesLeft: minutes(c.insideFanOnMinutesLeft),
    hotFanOnMinutesLeft: minutes(c.hotFanOnMinutesLeft),
    insideFanOffMinutesLeft: minutes(c.insideFanOffMinutesLeft),
    hotFanOffMinutesLeft: minutes(c.hotFanOffMinutesLeft),
    /** A physical switch at the room is on: it refuses remote commands. */
    localLock: c.localLock === true,
    at: new Date().toISOString(),
  };
}
