import fs from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import { requireDevice } from '../auth.js';
import { config, rules } from '../config.js';
import { getProfile } from '../crops.js';
import { one, query } from '../db.js';
import { ApiError } from '../errors.js';
import { evaluateReading } from '../monitor.js';
import { getRoomRow } from '../rooms.js';

const MAX_BATCH = 500;
const MIN = 60_000;

/** Accepts a number in a sane range, otherwise null (a broken sensor must not poison the data). */
const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);

const COLUMNS = [
  'room_id', 'at', 'chamber', 'coil_outlet', 'product', 'humidity', 'ice_bank', 'outside', 'battery', 'battery_v', 'solar_v',
  'solar_charging', 'pump', 'fan', 'compressor', 'humidifier', 'door_open', 'device_alerts', 'profile_version',
  'hot_side', 'cooler_duty', 'cooler_current', 'cooler_voltage', 'hot_fan',
];

function row(roomId: string, at: Date, b: any): unknown[] {
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
  ];
}

/** Endpoints for the ESP32 controller (firmware/harvest_hold_controller). */
export async function deviceRoutes(app: FastifyInstance) {
  const device = { preHandler: requireDevice, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  /**
   * Readings, either one live reading (stored with the server's time) or a batch:
   *   { readings: [{ t: <UTC unix seconds>, chamber: 2.1, ... }, ...] }
   * Batches carry the controller's own timestamps, so readings kept in flash while offline
   * land at the right time. Readings older than 14 days or in the future are skipped, and
   * a reading already stored (same room and time) is ignored, so retries are safe.
   */
  app.post<{ Params: { id: string } }>('/devices/:id/readings', { ...device, bodyLimit: 512 * 1024 }, async (req) => {
    const b: any = req.body ?? {};
    const room = await getRoomRow(req.params.id);
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
        rows.push(row(room.id, new Date(Math.round(t / 1000) * 1000), r));
      }
    } else {
      rows = [row(room.id, new Date(now), b)];
    }

    let inserted: any[] = [];
    if (rows.length) {
      const values = rows.map((_, i) => `(${COLUMNS.map((__, j) => `$${i * COLUMNS.length + j + 1}`).join(',')})`).join(',');
      inserted = await query(
        `INSERT INTO readings (${COLUMNS.join(',')}) VALUES ${values} ON CONFLICT (room_id, at) DO NOTHING RETURNING *`,
        rows.flat()
      );
    }

    const firmware = Number(req.headers['x-firmware-version']);
    await query('UPDATE cold_rooms SET last_upload_at = now(), firmware_version = coalesce($2, firmware_version) WHERE id = $1', [
      room.id,
      Number.isInteger(firmware) ? firmware : null,
    ]);

    // Live alerts only for a current reading: a backlog from last night must not alarm farmers now.
    const newest = inserted.reduce((a, r) => (!a || r.at > a.at ? r : a), null as any);
    if (newest && now - newest.at.getTime() <= rules.liveReadingMin * MIN) await evaluateReading(room, newest, newest.at.getTime());

    return { accepted: inserted.length, duplicates: rows.length - inserted.length, skipped };
  });

  /** The settings the controller should run with, from the room's crop profile. */
  app.get<{ Params: { id: string } }>('/devices/:id/profile', device, async (req) => {
    const room = await getRoomRow(req.params.id);
    return (await getProfile(room.crop)).controller;
  });

  /** Latest firmware release; the controller installs it if it is newer than its own version. */
  app.get<{ Params: { id: string } }>('/devices/:id/firmware', device, async (_req, reply) => {
    const release = await one('SELECT version, size, sha256 FROM firmware_releases ORDER BY version DESC LIMIT 1');
    if (!release) return reply.code(204).send();
    return release;
  });

  app.get<{ Params: { id: string } }>('/devices/:id/firmware/download', device, async (_req, reply) => {
    const release = await one('SELECT file_name, size FROM firmware_releases ORDER BY version DESC LIMIT 1');
    const file = release && path.join(config.firmwareDir, path.basename(release.file_name));
    if (!file || !fs.existsSync(file)) throw new ApiError('notFound', 404);
    return reply
      .type('application/octet-stream')
      .header('Content-Length', release.size)
      .header('Cache-Control', 'no-store')
      .send(fs.createReadStream(file));
  });
}
