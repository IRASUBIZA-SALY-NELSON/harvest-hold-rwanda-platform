/**
 * Development demo data. Wipes the database! Refuses to run in production.
 * Creates 2 carrot cold rooms, demo farmers and a buyer (PIN 1234), stock, listings,
 * orders and 7 days of simulated sensor history.
 */
import { hashPin } from './auth.js';
import { config } from './config.js';
import { syncCropProfiles } from './crops.js';
import { pool, query } from './db.js';
import { sha256 } from './ids.js';
import { migrate } from './migrate.js';
import { simulatedPeltierReading, simulatedReading } from './sim.js';

if (config.production) throw new Error('seed is for development only');

const HOUR = 3_600_000;
const MINUTE = 60_000;
const now = Date.now();
const ago = (h: number) => new Date(now - h * HOUR);

export const DEV_DEVICE_TOKENS: Record<string, string> = {
  'cr-musanze': 'dev-device-token-musanze',
  'cr-bugesera': 'dev-device-token-bugesera',
};

await migrate();
await query(
  'TRUNCATE alerts, orders, listings, certificates, batches, readings, room_alert_state, push_tokens, sessions, users, cold_rooms CASCADE'
);
await syncCropProfiles(config.cropProfilesDir);

await query(
  // Kinigi is the Peltier prototype; Nyamata shows the full-size ice-bank design.
  `INSERT INTO cold_rooms (id, name, district, sector, crop, capacity_crates, device_token_hash, cooling_type) VALUES
   ('cr-musanze', 'Kinigi Cold Hub', 'Musanze', 'Kinigi', 'carrot', 12, $1, 'peltier'),
   ('cr-bugesera', 'Nyamata Cold Hub', 'Bugesera', 'Nyamata', 'carrot', 80, $2, 'ice_bank')`,
  [sha256(DEV_DEVICE_TOKENS['cr-musanze']), sha256(DEV_DEVICE_TOKENS['cr-bugesera'])]
);

const pin = await hashPin('1234');
await query(
  `INSERT INTO users (id, role, name, phone, pin_hash, district, cold_room_id, business_name, business_type, lang, created_at) VALUES
   ('u-farmer-1', 'farmer', 'Jean Bosco Habimana', '+250788123456', $1, 'Musanze', 'cr-musanze', NULL, NULL, 'en', $2),
   ('u-farmer-2', 'farmer', 'Aline Uwase', '+250788222333', $1, 'Bugesera', 'cr-bugesera', NULL, NULL, 'rw', $2),
   ('u-farmer-3', 'farmer', 'Eric Niyonzima', '+250788444555', $1, 'Musanze', 'cr-musanze', NULL, NULL, 'rw', $2),
   ('u-buyer-1', 'buyer', 'Diane Mukamana', '+250788654321', $1, 'Gasabo', NULL, 'Kigali Hills Hotel', 'hotel', 'en', $2)`,
  [pin, ago(24 * 20)]
);

// 7 days of readings every 2 minutes. Bugesera had a cooling failure 27-24.5 h ago;
// Musanze lost its connection for 50 min about 60 h ago.
const COLS = ['room_id', 'at', 'chamber', 'coil_outlet', 'product', 'humidity', 'ice_bank', 'outside', 'battery', 'battery_v', 'solar_v',
  'solar_charging', 'pump', 'fan', 'compressor', 'humidifier', 'door_open', 'profile_version',
  'hot_side', 'cooler_duty', 'cooler_current', 'cooler_voltage', 'hot_fan'];
for (const roomId of ['cr-musanze', 'cr-bugesera']) {
  const rows: unknown[][] = [];
  for (let t = now - 7 * 24 * HOUR; t <= now - MINUTE; t += 2 * MINUTE) {
    if (roomId === 'cr-musanze') {
      if (t > now - 60.5 * HOUR && t < now - 59.65 * HOUR) continue;
      const p = simulatedPeltierReading(roomId, 2, t);
      rows.push([roomId, new Date(t), p.chamber, p.coilOutlet, p.product, p.humidity, null, p.outside, p.battery, p.batteryV, p.solarV,
        p.solarCharging, null, p.fan, null, false, false, 2, p.hotSide, p.coolerDuty, p.coolerCurrent, p.coolerVoltage, p.hotFan]);
    } else {
      const warm = t > now - 27 * HOUR && t < now - 24.5 * HOUR;
      const r = simulatedReading(roomId, 2, t, warm);
      rows.push([roomId, new Date(t), r.chamber, r.coilOutlet, r.product, r.humidity, r.iceBank, r.outside, r.battery, r.batteryV, r.solarV,
        r.solarCharging, r.pump, r.fan, r.compressor, false, false, 2, null, null, null, null, null]);
    }
  }
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const values = chunk.map((_, j) => `(${COLS.map((__, k) => `$${j * COLS.length + k + 1}`).join(',')})`).join(',');
    await query(`INSERT INTO readings (${COLS.join(',')}) VALUES ${values}`, chunk.flat());
  }
}

await query(
  `INSERT INTO batches (id, farmer_id, cold_room_id, crop, quantity, unit, stored_at, status, removed_at) VALUES
   ('b-102', 'u-farmer-1', 'cr-musanze', 'carrot', 120, 'kg', $1, 'stored', NULL),
   ('b-103', 'u-farmer-1', 'cr-musanze', 'cabbage', 2, 'crate', $2, 'stored', NULL),
   ('b-104', 'u-farmer-1', 'cr-musanze', 'carrot', 6, 'crate', $3, 'removed', $4),
   ('b-201', 'u-farmer-2', 'cr-bugesera', 'carrot', 150, 'kg', $5, 'stored', NULL),
   ('b-301', 'u-farmer-3', 'cr-musanze', 'carrot', 3, 'crate', $6, 'stored', NULL)`,
  [ago(30), ago(8), ago(24 * 6), ago(24 * 4), ago(40), ago(70)]
);

await query(
  `INSERT INTO listings (id, batch_id, farmer_id, cold_room_id, crop, quantity, unit, price_per_unit, status, created_at) VALUES
   ('l-102', 'b-102', 'u-farmer-1', 'cr-musanze', 'carrot', 100, 'kg', 450, 'active', $1),
   ('l-103', 'b-103', 'u-farmer-1', 'cr-musanze', 'cabbage', 2, 'crate', 9000, 'active', $2),
   ('l-201', 'b-201', 'u-farmer-2', 'cr-bugesera', 'carrot', 150, 'kg', 420, 'active', $3),
   ('l-301', 'b-301', 'u-farmer-3', 'cr-musanze', 'carrot', 3, 'crate', 11000, 'active', $4)`,
  [ago(28), ago(6), ago(36), ago(60)]
);

await query(
  `INSERT INTO orders (id, listing_id, buyer_id, farmer_id, crop, quantity, unit, price_per_unit, note, status, created_at, updated_at) VALUES
   ('o-5001', 'l-102', 'u-buyer-1', 'u-farmer-1', 'carrot', 40, 'kg', 450, 'Pickup on Thursday morning, please.', 'pending', $1, $1),
   ('o-5000', 'l-301', 'u-buyer-1', 'u-farmer-3', 'carrot', 1, 'crate', 11000, '', 'accepted', $2, $3)`,
  [ago(3), ago(30), ago(26)]
);

await query(
  `INSERT INTO alerts (id, user_id, type, params, link, read, created_at) VALUES
   ('a-1', 'u-farmer-1', 'orderNew', '{"buyer":"Kigali Hills Hotel","quantity":40,"unit":"kg","crop":"carrot"}', '/order/o-5001', false, $1),
   ('a-4', 'u-farmer-2', 'chamberWarm', '{"room":"Nyamata Cold Hub","temp":8.1,"max":5}', NULL, false, $2),
   ('a-5', 'u-farmer-2', 'backToNormal', '{"room":"Nyamata Cold Hub"}', NULL, false, $3),
   ('a-6', 'u-buyer-1', 'orderAccepted', '{"farmer":"Eric Niyonzima","crop":"carrot"}', '/order/o-5000', true, $4)`,
  [ago(3), ago(26.5), ago(24.5), ago(26)]
);

// Certificates for the listed batches, issued now from the readings above.
const { issueCertificate } = await import('./certificates.js');
for (const id of ['b-102', 'b-103', 'b-201', 'b-301']) await issueCertificate(id);

console.log('Seeded demo data. Demo PIN for every account: 1234');
console.log('  farmer  078 812 3456 (Kinigi Cold Hub)');
console.log('  buyer   078 865 4321 (Kigali Hills Hotel)');
console.log('Device tokens for the simulator / test controllers:');
for (const [room, token] of Object.entries(DEV_DEVICE_TOKENS)) console.log(`  ${room}: ${token}`);
await pool.end();
