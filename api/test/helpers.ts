import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../src/bootstrap.js';
import { Database } from '../src/common/database.service.js';
import { sha256 } from '../src/common/ids.js';
import { config } from '../src/config.js';
import { hashPin } from '../src/modules/auth/user-auth.service.js';
import { CropsService } from '../src/modules/crops/crops.service.js';
import { MonitorService } from '../src/modules/monitor/monitor.service.js';
import { SmsService } from '../src/modules/notify/sms.service.js';
import { RoomsService } from '../src/modules/rooms/rooms.service.js';

export const DEVICE_TOKEN = 'test-device-token';
export const sent: { to: string; text: string }[] = [];

let app: NestFastifyApplication | null = null;

export async function getApp() {
  if (!app) {
    app = await createApp({ logger: false });
    app.get(SmsService).use({ send: async (to, text) => void sent.push({ to, text }) });
  }
  // The same inject() the Fastify tests used: requests go through the whole NestJS pipeline.
  return app.getHttpAdapter().getInstance();
}

export const service = <T>(type: new (...args: any[]) => T): T => app!.get(type);
export const db = () => service(Database);
export const query = (text: string, params: unknown[] = []) => db().query(text, params);
export const rooms = () => service(RoomsService);
export const monitor = () => service(MonitorService);

export async function closeApp() {
  await app?.close();
  app = null;
}

/** Empty database with one carrot room, a farmer and a buyer (PIN 2580). */
export async function reset() {
  await getApp();
  await query(
    'TRUNCATE settings, cooperatives, room_commands, operator_rooms, collections, stock_movements, crop_profiles, photos, room_incidents, audit_log, admin_sessions, admins, firmware_releases, alerts, orders, listings, certificates, batches, readings, room_alert_state, push_tokens, sessions, users, cold_rooms CASCADE'
  );
  await service(CropsService).syncFromFiles(config.cropProfilesDir);
  rooms().clearSummaryCache();
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
    await query('INSERT INTO readings (room_id, at, chamber, humidity, battery) VALUES ($1, $2, $3, $4, 80)', ['cr-1', new Date(now - m * 60_000), values.chamber ?? 2, values.humidity ?? 94]);
  }
}
