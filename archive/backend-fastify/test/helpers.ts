import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { hashPin } from '../src/auth.js';
import { config } from '../src/config.js';
import { syncCropProfiles } from '../src/crops.js';
import { query } from '../src/db.js';
import { sha256 } from '../src/ids.js';
import { migrate } from '../src/migrate.js';
import { clearSummaryCache } from '../src/rooms.js';
import { sms } from '../src/sms.js';

export const DEVICE_TOKEN = 'test-device-token';
export const sent: { to: string; text: string }[] = [];
sms.use({ send: async (to, text) => void sent.push({ to, text }) });

let app: FastifyInstance | null = null;

export async function getApp() {
  if (!app) {
    await migrate(() => {});
    app = await buildApp({ logger: false });
  }
  return app;
}

/** Empty database with one carrot room, a farmer and a buyer (PIN 2580). */
export async function reset() {
  await getApp();
  await query('TRUNCATE firmware_releases, alerts, orders, listings, certificates, batches, readings, room_alert_state, push_tokens, sessions, users, cold_rooms CASCADE');
  await syncCropProfiles(config.cropProfilesDir);
  clearSummaryCache();
  sent.length = 0;
  await query("INSERT INTO cold_rooms (id, name, district, sector, crop, capacity_crates, device_token_hash) VALUES ('cr-1', 'Test Hub', 'Musanze', 'Kinigi', 'carrot', 50, $1)", [sha256(DEVICE_TOKEN)]);
  const pin = await hashPin('2580');
  await query(
    `INSERT INTO users (id, role, name, phone, pin_hash, district, cold_room_id, business_name, business_type, lang) VALUES
     ('u-f', 'farmer', 'Farmer One', '+250788000001', $1, 'Musanze', 'cr-1', NULL, NULL, 'en'),
     ('u-b', 'buyer', 'Buyer One', '+250788000002', $1, 'Gasabo', NULL, 'Test Hotel', 'hotel', 'en')`,
    [pin]
  );
}

export async function signIn(phone: string, pin = '2580'): Promise<string> {
  const res = await (await getApp()).inject({ method: 'POST', url: '/auth/sign-in', payload: { phone, pin } });
  if (res.statusCode !== 200) throw new Error(res.body);
  return res.json().token;
}

/** Inserts readings every minute from `fromMin` to `toMin` minutes ago. */
export async function addReadings(fromMinAgo: number, toMinAgo: number, values: { chamber?: number; humidity?: number } = {}) {
  const now = Date.now();
  for (let m = fromMinAgo; m >= toMinAgo; m--) {
    await query('INSERT INTO readings (room_id, at, chamber, humidity, battery) VALUES ($1, $2, $3, $4, 80)', [
      'cr-1',
      new Date(now - m * 60_000),
      values.chamber ?? 2,
      values.humidity ?? 94,
    ]);
  }
}
