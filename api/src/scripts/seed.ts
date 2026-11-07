/**
 * Development demo data. Wipes the database! Refuses to run in production.
 * Creates a Peltier prototype room and an ice-bank room (carrots), demo farmers and a buyer
 * (PIN 1234), a cooperative, stock with batch codes, a collection with its storage charge, check-in photos, listings with photos, orders, 7 days of simulated
 * sensor history, past incidents, signed certificates and a demo superadmin.
 */
import sharp from 'sharp';

import { createApp } from '../bootstrap.js';
import { Database } from '../common/database.service.js';
import { sha256 } from '../common/ids.js';
import { config } from '../config.js';
import { simulatedPeltierReading, simulatedReading } from '../domain/sim.js';
import { hashPassword } from '../modules/admin/admin-auth.controller.js';
import { AuditService, SYSTEM } from '../modules/audit/audit.service.js';
import { hashPin } from '../modules/auth/user-auth.service.js';
import { CertificatesService } from '../modules/certificates/certificates.service.js';
import { CropsService } from '../modules/crops/crops.service.js';
import { MediaService } from '../modules/media/media.service.js';

if (config.production) throw new Error('seed is for development only');

const HOUR = 3_600_000;
const MINUTE = 60_000;
const now = Date.now();
const ago = (h: number) => new Date(now - h * HOUR);

export const DEV_DEVICE_TOKENS: Record<string, string> = {
  'HHR-001': 'dev-device-token-musanze',
  'HHR-002': 'dev-device-token-bugesera',
};
export const DEV_ADMIN = { email: 'admin@harvesthold.rw', password: 'HarvestHold-dev-2026' };
export const DEV_OPERATOR = { email: 'operator@harvesthold.rw', password: 'HarvestHold-op-2026' };

const app = await createApp({ logger: false });
const db = app.get(Database);
const query = (text: string, params: unknown[] = []) => db.query(text, params);

await query(
  'TRUNCATE storage_prices, storage_requests, settings, cooperatives, room_commands, operator_rooms, collections, stock_movements, photos, room_incidents, audit_log, admin_sessions, admins, alerts, orders, listings, certificates, batches, readings, room_alert_state, push_tokens, sessions, users, cold_rooms CASCADE'
);
await app.get(CropsService).syncFromFiles(config.cropProfilesDir);

await query(
  // Kinigi is the Peltier prototype; Nyamata shows the full-size ice-bank design.
  `INSERT INTO cold_rooms (id, name, district, sector, crop, capacity_crates, device_token_hash, cooling_type, latitude, longitude, firmware_version, firmware_channel) VALUES
   ('HHR-001', 'Kinigi Cold Hub', 'Musanze', 'Kinigi', 'carrot', 12, $1, 'peltier', -1.4317, 29.5936, 4, 'beta'),
   ('HHR-002', 'Nyamata Cold Hub', 'Bugesera', 'Nyamata', 'carrot', 80, $2, 'ice_bank', -2.1597, 30.0947, 3, 'stable')`,
  [sha256(DEV_DEVICE_TOKENS['HHR-001']), sha256(DEV_DEVICE_TOKENS['HHR-002'])]
);

await query("SELECT setval('cold_room_seq', 2)");
// Demo rates only: the real storage rates are set in the portal (Settings). Wiped with the rest of the demo data.
await query(`INSERT INTO settings (key, value) VALUES ('storage_rates', '{"kgPerDay": 8, "cratePerDay": 150}')`);
await query(`INSERT INTO cooperatives (id, name, district, sector, contact_name, contact_phone) VALUES
  ('co-1', 'Abahuzamugambi Musanze', 'Musanze', 'Kinigi', 'Marie Claire Uwimana', '+250788100200')`);

const pin = await hashPin('1234');
await query(
  `INSERT INTO users (id, role, name, phone, pin_hash, district, cold_room_id, business_name, business_type, lang, created_at) VALUES
   ('u-farmer-1', 'farmer', 'Jean Bosco Habimana', '+250788123456', $1, 'Musanze', 'HHR-001', NULL, NULL, 'en', $2),
   ('u-farmer-2', 'farmer', 'Aline Uwase', '+250788222333', $1, 'Bugesera', 'HHR-002', NULL, NULL, 'rw', $2),
   ('u-farmer-3', 'farmer', 'Eric Niyonzima', '+250788444555', $1, 'Musanze', 'HHR-001', NULL, NULL, 'rw', $2),
   ('u-buyer-1', 'buyer', 'Diane Mukamana', '+250788654321', $1, 'Gasabo', NULL, 'Kigali Hills Hotel', 'hotel', 'en', $2)`,
  [pin, ago(24 * 20)]
);
await query("UPDATE users SET cooperative_id = 'co-1' WHERE id IN ('u-farmer-1', 'u-farmer-3')");

// 7 days of readings every 2 minutes. Bugesera had a cooling failure 27-24.5 h ago;
// Musanze lost its connection for 50 min about 60 h ago.
const COLS = ['room_id', 'at', 'chamber', 'coil_outlet', 'product', 'humidity', 'ice_bank', 'outside', 'battery', 'battery_v', 'solar_v',
  'solar_charging', 'pump', 'fan', 'compressor', 'humidifier', 'door_open', 'profile_version',
  'hot_side', 'cooler_duty', 'cooler_current', 'cooler_voltage', 'hot_fan', 'solar_current', 'source'];
for (const roomId of ['HHR-001', 'HHR-002']) {
  const rows: unknown[][] = [];
  for (let t = now - 7 * 24 * HOUR; t <= now - MINUTE; t += 2 * MINUTE) {
    if (roomId === 'HHR-001') {
      if (t > now - 60.5 * HOUR && t < now - 59.65 * HOUR) continue;
      const p = simulatedPeltierReading(roomId, 2, t);
      rows.push([roomId, new Date(t), p.chamber, p.coilOutlet, p.product, p.humidity, null, p.outside, p.battery, p.batteryV, p.solarV,
        p.solarCharging, null, p.fan, null, false, false, 2, p.hotSide, p.coolerDuty, p.coolerCurrent, p.coolerVoltage, p.hotFan,
        p.solarCharging ? 3.1 : 0, 'simulated']);
    } else {
      const warm = t > now - 27 * HOUR && t < now - 24.5 * HOUR;
      const r = simulatedReading(roomId, 2, t, warm);
      rows.push([roomId, new Date(t), r.chamber, r.coilOutlet, r.product, r.humidity, r.iceBank, r.outside, r.battery, r.batteryV, r.solarV,
        r.solarCharging, r.pump, r.fan, r.compressor, false, false, 2, null, null, null, null, null, null, 'simulated']);
    }
  }
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const values = chunk.map((_, j) => `(${COLS.map((__, k) => `$${j * COLS.length + k + 1}`).join(',')})`).join(',');
    await query(`INSERT INTO readings (${COLS.join(',')}) VALUES ${values}`, chunk.flat());
  }
}

await query(
  `INSERT INTO batches (id, code, farmer_id, cold_room_id, crop, quantity, initial_quantity, unit, stored_at, status, removed_at, harvest_date, storage_location, cooperative_id, registered_by_name) VALUES
   ('b-102', 'HHB-A102-K7MQ', 'u-farmer-1', 'HHR-001', 'carrot', 120, 120, 'kg', $1, 'stored', NULL, current_date - 2, 'Rack A, shelf 1', 'co-1', 'Jean Bosco Habimana'),
   ('b-103', 'HHB-A103-P3XD', 'u-farmer-1', 'HHR-001', 'cabbage', 2, 2, 'crate', $2, 'stored', NULL, current_date - 1, 'Rack B', 'co-1', 'Demo Operator (operator)'),
   ('b-104', 'HHB-A104-N8RT', 'u-farmer-1', 'HHR-001', 'carrot', 0, 6, 'crate', $3, 'removed', $4, current_date - 8, 'Rack A, shelf 2', 'co-1', 'Jean Bosco Habimana'),
   ('b-201', 'HHB-B201-C5WH', 'u-farmer-2', 'HHR-002', 'carrot', 150, 150, 'kg', $5, 'stored', NULL, current_date - 3, '', NULL, 'Aline Uwase'),
   ('b-301', 'HHB-C301-Z2VJ', 'u-farmer-3', 'HHR-001', 'carrot', 3, 3, 'crate', $6, 'stored', NULL, current_date - 4, 'Rack C', 'co-1', 'Eric Niyonzima')`,
  [ago(30), ago(8), ago(24 * 6), ago(24 * 4), ago(40), ago(70)]
);
// Stock in and out of the rooms, and one collection with its storage charge (demo rate 150 RWF per crate per day).
await query(
  `INSERT INTO stock_movements (room_id, batch_id, kind, reason, quantity, unit, at, actor_name) VALUES
   ('HHR-001', 'b-102', 'in', 'checkin', 120, 'kg', $1, 'Jean Bosco Habimana'),
   ('HHR-001', 'b-103', 'in', 'checkin', 2, 'crate', $2, 'Demo Operator'),
   ('HHR-001', 'b-104', 'in', 'checkin', 6, 'crate', $3, 'Jean Bosco Habimana'),
   ('HHR-001', 'b-104', 'out', 'collection', 6, 'crate', $4, 'Kigali Fresh Market'),
   ('HHR-002', 'b-201', 'in', 'checkin', 150, 'kg', $5, 'Aline Uwase'),
   ('HHR-001', 'b-301', 'in', 'checkin', 3, 'crate', $6, 'Eric Niyonzima')`,
  [ago(30), ago(8), ago(24 * 6), ago(24 * 4), ago(40), ago(70)]
);
await query(
  `INSERT INTO collections (id, batch_id, room_id, farmer_id, quantity, unit, collected_at, collected_by_name, recorded_by_name, days, rate_rwf, charge_rwf)
   VALUES ('c-1', 'b-104', 'HHR-001', 'u-farmer-1', 6, 'crate', $1, 'Kigali Fresh Market', 'Demo Operator (operator)', 3, 150, 2700)`,
  [ago(24 * 4)]
);

await query(
  `INSERT INTO listings (id, batch_id, farmer_id, cold_room_id, crop, quantity, unit, price_per_unit, status, created_at) VALUES
   ('l-102', 'b-102', 'u-farmer-1', 'HHR-001', 'carrot', 100, 'kg', 450, 'active', $1),
   ('l-103', 'b-103', 'u-farmer-1', 'HHR-001', 'cabbage', 2, 'crate', 9000, 'active', $2),
   ('l-201', 'b-201', 'u-farmer-2', 'HHR-002', 'carrot', 150, 'kg', 420, 'active', $3),
   ('l-301', 'b-301', 'u-farmer-3', 'HHR-001', 'carrot', 3, 'crate', 11000, 'active', $4)`,
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


// A request waiting for the operator, and the price of carrots in Kinigi (demo values).
await query(
  `INSERT INTO storage_requests (id, farmer_id, cold_room_id, crop, unit, estimated_quantity, note, created_at)
   VALUES ('sr-1', 'u-farmer-3', 'HHR-001', 'carrot', 'kg', 100, 'Washed carrots, bringing them this afternoon', $1)`,
  [ago(2)]
);
await query("INSERT INTO storage_prices (crop, room_id, kg_per_day, crate_per_day) VALUES ('carrot', NULL, 6, 120)");

// Past incidents matching the history above (closed), so the portal's timeline has content.
await query(
  `INSERT INTO room_incidents (room_id, type, started_at, ended_at, details) VALUES
   ('HHR-002', 'chamberWarm', $1, $2, '{"room":"Nyamata Cold Hub","temp":8.1,"max":5}'),
   ('HHR-001', 'offline', $3, $4, '{"room":"Kinigi Cold Hub"}')`,
  [ago(26.5), ago(24.5), ago(60.4), ago(59.6)]
);

// Demo photos: simple generated pictures (the real ones come from farmers' phones).
async function demoPhoto(label: string, colors: [string, string]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>
    <rect width="1200" height="900" fill="url(#g)"/>
    ${Array.from({ length: 14 }, (_, i) => `<ellipse cx="${120 + (i % 7) * 160}" cy="${300 + Math.floor(i / 7) * 260}" rx="38" ry="120" fill="${colors[0]}" stroke="#7a2e0e" stroke-width="4" transform="rotate(${(i * 23) % 50 - 25} ${120 + (i % 7) * 160} ${300 + Math.floor(i / 7) * 260})"/>`).join('')}
    <rect x="0" y="780" width="1200" height="120" fill="rgba(0,0,0,0.35)"/>
    <text x="40" y="860" font-family="sans-serif" font-size="60" fill="#fff">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}
const media = app.get(MediaService);
const carrots: [string, string] = ['#F0892B', '#C9541A'];
const cabbage: [string, string] = ['#8DBF5A', '#4E7F2C'];
await media.save('u-farmer-1', 'checkin', 'b-102', await demoPhoto('Carrots · check-in', carrots));
await media.save('u-farmer-1', 'listing', 'l-102', await demoPhoto('Fresh carrots, Kinigi', carrots));
await media.save('u-farmer-1', 'listing', 'l-102', await demoPhoto('Washed and topped', ['#E9772A', '#A9461A']));
await media.save('u-farmer-1', 'listing', 'l-103', await demoPhoto('Cabbage', cabbage));
await media.save('u-farmer-3', 'checkin', 'b-301', await demoPhoto('Crates at check-in', carrots));
await media.save('u-farmer-3', 'listing', 'l-301', await demoPhoto('Carrots in crates', carrots));

// Certificates for the listed batches, issued and signed now from the readings above.
const certificates = app.get(CertificatesService);
for (const id of ['b-102', 'b-103', 'b-201', 'b-301']) await certificates.issue(id);

// Demo superadmin: must change this password at first sign-in.
await query("INSERT INTO admins (id, email, name, role, password_hash) VALUES ('ad-demo', $1, 'Demo Superadmin', 'superadmin', $2)", [DEV_ADMIN.email, await hashPassword(DEV_ADMIN.password)]);
// Demo cold room operator: works in Kinigi only (the room belongs to the farmers, not to them).
await query("INSERT INTO admins (id, email, name, role, password_hash) VALUES ('ad-op', $1, 'Demo Operator', 'operator', $2)", [DEV_OPERATOR.email, await hashPassword(DEV_OPERATOR.password)]);
await query("INSERT INTO operator_rooms (admin_id, room_id) VALUES ('ad-op', 'HHR-001')");
await app.get(AuditService).record(SYSTEM, { action: 'system.seed', summary: 'Loaded demo data' });

console.log('Seeded demo data. Demo PIN for every app account: 1234');
console.log('  farmer  078 812 3456 (Kinigi Cold Hub, Peltier)');
console.log('  buyer   078 865 4321 (Kigali Hills Hotel)');
console.log(`Admin portal: ${DEV_ADMIN.email} / ${DEV_ADMIN.password} (you will choose a new password)`);
console.log(`Cold room operator (Kinigi only): ${DEV_OPERATOR.email} / ${DEV_OPERATOR.password}`);
console.log('Seeded sensor history is marked SIMULATED. Real controllers send readings without that flag.');
console.log('Device tokens for the simulator / test controllers:');
for (const [room, token] of Object.entries(DEV_DEVICE_TOKENS)) console.log(`  ${room}: ${token}`);
await app.close();
