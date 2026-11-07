import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { config } from '../src/config.js';

import { pool, query } from '../src/db.js';
import { evaluateReading } from '../src/monitor.js';
import { clearSummaryCache, energyToday, getRoomRow } from '../src/rooms.js';
import { addReadings, DEVICE_TOKEN, getApp, reset, sent, signIn } from './helpers.js';

const FARMER = '+250788000001';
const BUYER = '+250788000002';
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeEach(reset);
afterAll(() => pool.end());

describe('accounts', () => {
  const registration = { role: 'buyer', name: 'New Buyer', phone: '0788 111 222', pin: '2580', district: 'Gasabo', businessName: 'Cafe', businessType: 'restaurant' };

  it('registers and stores only a hash of the PIN', async () => {
    const app = await getApp();
    const ok = await app.inject({ method: 'POST', url: '/auth/register', payload: registration });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.phone).toBe('+250788111222');
    expect(ok.json().user).not.toHaveProperty('pin_hash');

    const [row] = await query("SELECT pin_hash FROM users WHERE phone = '+250788111222'");
    expect(row.pin_hash).toMatch(/^\$2[aby]\$12\$/); // bcrypt, cost 12
    expect(row.pin_hash).not.toContain('2580');
  });

  it('refuses easy PINs and taken numbers', async () => {
    const app = await getApp();
    const easy = await app.inject({ method: 'POST', url: '/auth/register', payload: { ...registration, pin: '1111' } });
    expect(easy.json().error).toBe('pinTooSimple');
    const taken = await app.inject({ method: 'POST', url: '/auth/register', payload: { ...registration, phone: FARMER } });
    expect(taken.json().error).toBe('phoneTaken');
  });

  it('locks the account after 5 wrong PINs, until an administrator reactivates it', async () => {
    const app = await getApp();
    const tryPin = (pin: string) => app.inject({ method: 'POST', url: '/auth/sign-in', payload: { phone: FARMER, pin } });
    for (let i = 0; i < 4; i++) expect((await tryPin('9999')).json().error).toBe('wrongCredentials');
    expect((await tryPin('9999')).json().error).toBe('accountLocked');

    // The right PIN does not help, and the lock does not expire by itself.
    await query("UPDATE users SET locked_at = now() - interval '30 days' WHERE phone = $1", [FARMER]);
    const right = await tryPin('2580');
    expect(right.statusCode).toBe(423);
    expect(right.json().error).toBe('accountLocked');

    // What the administrator tool will do.
    await query('UPDATE users SET locked_at = NULL, failed_pin_attempts = 0 WHERE phone = $1', [FARMER]);
    expect((await tryPin('2580')).statusCode).toBe(200);
  });

  it('starts counting again after a correct PIN', async () => {
    const app = await getApp();
    const tryPin = (pin: string) => app.inject({ method: 'POST', url: '/auth/sign-in', payload: { phone: FARMER, pin } });
    for (let i = 0; i < 4; i++) await tryPin('9999');
    expect((await tryPin('2580')).statusCode).toBe(200);
    for (let i = 0; i < 4; i++) expect((await tryPin('9999')).json().error).toBe('wrongCredentials');
  });

  it('gives the same answer for unknown numbers and wrong PINs', async () => {
    const app = await getApp();
    const unknown = await app.inject({ method: 'POST', url: '/auth/sign-in', payload: { phone: '0788999999', pin: '2580' } });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error).toBe('wrongCredentials');
  });

  it('rejects requests without a valid session', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/me', headers: auth('nonsense') });
    expect(res.statusCode).toBe(401);
  });
});

describe('controller', () => {
  it('needs the device token', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: '/devices/cr-1/readings', headers: auth('wrong'), payload: { chamber: 2 } });
    expect(res.statusCode).toBe(401);
  });

  it('stores readings and drops impossible values', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/devices/cr-1/readings',
      headers: auth(DEVICE_TOKEN),
      payload: { chamber: 2.3, humidity: 140, coilOutlet: 1.1, battery: 77, pump: true, door: 'closed', alerts: ['ice_bank_low'] },
    });
    expect(res.statusCode).toBe(200);
    const [r] = await query('SELECT * FROM readings');
    expect(r.chamber).toBeCloseTo(2.3);
    expect(r.humidity).toBeNull();
    expect(r.device_alerts).toEqual(['ice_bank_low']);
  });

  it('gets the crop profile of its room', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/devices/cr-1/profile', headers: auth(DEVICE_TOKEN) });
    expect(res.json()).toMatchObject({ crop: 'carrot', targetC: 2, freezeGuardC: 0 });
  });
});

describe('controller offline buffer', () => {
  const post = async (readings: unknown[], headers: Record<string, string> = {}) =>
    (await getApp()).inject({ method: 'POST', url: '/devices/cr-1/readings', headers: { ...auth(DEVICE_TOKEN), ...headers }, payload: { readings } });
  const secondsAgo = (s: number) => Math.floor(Date.now() / 1000) - s;

  it('stores a batch at the times the controller recorded them', async () => {
    const res = await post([
      { t: secondsAgo(7200), chamber: 2.1, humidity: 94 },
      { t: secondsAgo(7140), chamber: 2.2, humidity: 94 },
    ], { 'x-firmware-version': '3' });
    expect(res.json()).toEqual({ accepted: 2, duplicates: 0, skipped: 0 });
    const rows = await query('SELECT at FROM readings ORDER BY at');
    expect(Math.abs(rows[0].at.getTime() / 1000 - secondsAgo(7200))).toBeLessThanOrEqual(1);
    const [room] = await query("SELECT firmware_version FROM cold_rooms WHERE id = 'cr-1'");
    expect(room.firmware_version).toBe(3);
  });

  it('stores a batch sent twice only once', async () => {
    const batch = [{ t: secondsAgo(600), chamber: 2 }, { t: secondsAgo(540), chamber: 2 }];
    await post(batch);
    expect((await post(batch)).json()).toEqual({ accepted: 0, duplicates: 2, skipped: 0 });
    expect(await query('SELECT 1 FROM readings')).toHaveLength(2);
  });

  it('skips readings that are too old or in the future', async () => {
    const res = await post([{ t: secondsAgo(15 * 86400), chamber: 2 }, { t: secondsAgo(-3600), chamber: 2 }, { chamber: 2 }]);
    expect(res.json()).toEqual({ accepted: 0, duplicates: 0, skipped: 3 });
  });

  it('does not raise live alerts for an old backlog', async () => {
    const warm = Array.from({ length: 45 }, (_, i) => ({ t: secondsAgo(3 * 3600 - i * 60), chamber: 9, humidity: 94 }));
    await post(warm);
    expect(await query('SELECT 1 FROM alerts')).toHaveLength(0);
    expect(await query('SELECT 1 FROM room_alert_state')).toHaveLength(0);
  });

  it('counts the uploaded backlog in certificates', async () => {
    const app = await getApp();
    const token = await signIn(FARMER);
    await query("INSERT INTO batches (id, farmer_id, cold_room_id, crop, quantity, unit, stored_at) VALUES ('b-1', 'u-f', 'cr-1', 'carrot', 50, 'kg', now() - interval '60 minutes')");
    // The controller was offline for the whole hour, then sent everything at once.
    await post(Array.from({ length: 62 }, (_, i) => ({ t: secondsAgo(3720 - i * 60), chamber: 2, humidity: 94 })));
    const cert = (await app.inject({ method: 'POST', url: '/stock/b-1/certificates', headers: auth(token) })).json();
    expect(cert.conditions.freshness).toBe('fresh');
    expect(cert.conditions.minutesNoData).toBe(0);
  });
});

describe('Peltier prototype', () => {
  const secondsAgo = (s: number) => Math.floor(Date.now() / 1000) - s;

  it('stores the cooler readings and reports power and energy', async () => {
    const app = await getApp();
    const token = await signIn(FARMER);
    // One hour at 50 W, one reading a minute.
    const readings = Array.from({ length: 61 }, (_, i) => ({
      t: secondsAgo(3600 - i * 60), chamber: 2.1, humidity: 94, hotSide: 41.5, coolerDuty: 70, coolerCurrent: 4.1, coolerVoltage: 12.2, hotFan: true, fan: true,
    }));
    await app.inject({ method: 'POST', url: '/devices/cr-1/readings', headers: auth(DEVICE_TOKEN), payload: { readings } });

    const status = (await app.inject({ method: 'GET', url: '/cold-rooms/cr-1/status', headers: auth(token) })).json();
    expect(status.room.coolingType).toBe('peltier');
    expect(status.reading).toMatchObject({ hotSide: 41.5, coolerDuty: 70, coolerPower: 50, hotFan: true, fan: true });
    // Only the part of that hour after midnight in Kigali counts, so allow for the time of day.
    expect(status.energyTodayWh).toBeLessThanOrEqual(51);
    expect(status.energyTodayWh).toBeGreaterThanOrEqual(0);
  });

  it('counts energy exactly, and adds nothing for a gap in the data', async () => {
    const KIGALI = 2 * 3_600_000;
    const midnight = Math.floor((Date.now() + KIGALI) / 86_400_000) * 86_400_000 - KIGALI - 86_400_000; // yesterday, Kigali
    const at = (min: number) => new Date(midnight + min * 60_000);
    // 10 PM yesterday (before midnight): must not count.
    await query('INSERT INTO readings (room_id, at, cooler_voltage, cooler_current) VALUES ($1, $2, 12, 5)', ['cr-1', at(-120)]);
    // 01:00-02:00: 60 W for one hour = 60 Wh. Then 3 hours without data, then one last reading.
    for (let m = 60; m <= 120; m++) {
      await query('INSERT INTO readings (room_id, at, cooler_voltage, cooler_current) VALUES ($1, $2, 12, 5)', ['cr-1', at(m)]);
    }
    await query('INSERT INTO readings (room_id, at, cooler_voltage, cooler_current) VALUES ($1, $2, 12, 5)', ['cr-1', at(300)]);
    // The 02:00 reading counts for at most 5 min (5 Wh): 60 + 5 = 65.
    expect(await energyToday('cr-1', midnight + 400 * 60_000)).toBe(65);
  });

  it('raises an SMS alert when the hot side overheats, and says when it is back to normal', async () => {
    const room = await getRoomRow('cr-1');
    const start = Date.now();
    await evaluateReading(room, { chamber: 3, humidity: 94, battery: 80, hot_side: 61, device_alerts: ['hot_side_overheat'] }, start);
    expect(await query("SELECT * FROM alerts WHERE type = 'coolerOverheat'")).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.some((s) => s.to === FARMER && s.text.includes('hot side'))).toBe(true);

    await evaluateReading(room, { chamber: 3, humidity: 94, battery: 80, hot_side: 42, device_alerts: [] }, start + 60_000);
    expect(await query("SELECT * FROM alerts WHERE type = 'backToNormal'")).toHaveLength(1);
  });

  it('passes on cooler faults and capacity warnings from the controller, but not ice-bank alerts', async () => {
    const room = await getRoomRow('cr-1');
    await evaluateReading(room, { chamber: 6, humidity: 94, battery: 80, hot_side: 45, device_alerts: ['cooler_fault', 'cooling_capacity', 'ice_bank_low'] });
    const types = (await query('SELECT type FROM alerts ORDER BY type')).map((a) => a.type);
    expect(types).toEqual(['coolerFault', 'coolingCapacity']);
  });

  it('keeps the ice-bank alerts for ice-bank rooms', async () => {
    await query("UPDATE cold_rooms SET cooling_type = 'ice_bank' WHERE id = 'cr-1'");
    await evaluateReading(await getRoomRow('cr-1'), { chamber: 3, humidity: 94, battery: 80, device_alerts: ['ice_bank_low'] });
    expect((await query('SELECT type FROM alerts')).map((a) => a.type)).toEqual(['iceLow']);
  });
});

describe('firmware updates', () => {
  it('offers nothing until a release exists', async () => {
    const res = await (await getApp()).inject({ method: 'GET', url: '/devices/cr-1/firmware', headers: auth(DEVICE_TOKEN) });
    expect(res.statusCode).toBe(204);
  });

  it('serves the latest release with its size and checksum', async () => {
    const app = await getApp();
    const bin = Buffer.concat([Buffer.from([0xe9]), crypto.randomBytes(4095)]);
    fs.mkdirSync(config.firmwareDir, { recursive: true });
    fs.writeFileSync(path.join(config.firmwareDir, 'harvest-hold-v4.bin'), bin);
    const sha = crypto.createHash('sha256').update(bin).digest('hex');
    await query("INSERT INTO firmware_releases (version, file_name, size, sha256) VALUES (4, 'harvest-hold-v4.bin', $1, $2)", [bin.length, sha]);

    const info = await app.inject({ method: 'GET', url: '/devices/cr-1/firmware', headers: auth(DEVICE_TOKEN) });
    expect(info.json()).toEqual({ version: 4, size: 4096, sha256: sha });
    const download = await app.inject({ method: 'GET', url: '/devices/cr-1/firmware/download', headers: auth(DEVICE_TOKEN) });
    expect(download.headers['content-length']).toBe('4096');
    expect(download.rawPayload.equals(bin)).toBe(true);

    const noToken = await app.inject({ method: 'GET', url: '/devices/cr-1/firmware/download' });
    expect(noToken.statusCode).toBe(401);
  });
});

describe('cold room rules', () => {
  it('uses the carrot safe range', async () => {
    const app = await getApp();
    const token = await signIn(FARMER);
    const res = await app.inject({ method: 'GET', url: '/cold-rooms/cr-1/status', headers: auth(token) });
    expect(res.json().room).toMatchObject({ crop: 'carrot', safeMin: 0, safeMax: 5 });
    expect(res.json().reading).toBeNull();
  });

  it('keeps tomatoes out of a carrot room but accepts cabbage', async () => {
    const app = await getApp();
    const token = await signIn(FARMER);
    const tomato = await app.inject({ method: 'POST', url: '/stock', headers: auth(token), payload: { crop: 'tomato', quantity: 5, unit: 'crate' } });
    expect(tomato.json().error).toBe('cropNotAllowedInRoom');
    const cabbage = await app.inject({ method: 'POST', url: '/stock', headers: auth(token), payload: { crop: 'cabbage', quantity: 5, unit: 'crate' } });
    expect(cabbage.statusCode).toBe(200);
  });

  it('sets the storage time on the server', async () => {
    const app = await getApp();
    const token = await signIn(FARMER);
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const res = await app.inject({ method: 'POST', url: '/stock', headers: auth(token), payload: { crop: 'carrot', quantity: 100, unit: 'kg', storedAt: old } });
    expect(Math.abs(Date.parse(res.json().storedAt) - Date.now())).toBeLessThan(10_000);
  });

  it('only lets a farmer see their own room', async () => {
    const app = await getApp();
    const token = await signIn(BUYER);
    const res = await app.inject({ method: 'GET', url: '/cold-rooms/cr-1/status', headers: auth(token) });
    expect(res.statusCode).toBe(403);
  });
});

describe('certificates', () => {
  async function storedBatch(minutesAgo: number) {
    await query("INSERT INTO batches (id, farmer_id, cold_room_id, crop, quantity, unit, stored_at) VALUES ('b-1', 'u-f', 'cr-1', 'carrot', 100, 'kg', $1)", [
      new Date(Date.now() - minutesAgo * 60_000),
    ]);
  }

  it('is frozen once issued', async () => {
    const app = await getApp();
    const token = await signIn(FARMER);
    await storedBatch(120);
    await addReadings(125, 1);
    const first = (await app.inject({ method: 'POST', url: '/stock/b-1/certificates', headers: auth(token) })).json();
    expect(first.conditions.freshness).toBe('fresh');

    // Later the room overheats. The issued certificate must not change.
    await addReadings(0, 0, { chamber: 9 });
    await query("UPDATE readings SET chamber = 9 WHERE at > now() - interval '50 minutes'");
    clearSummaryCache();
    const again = (await app.inject({ method: 'GET', url: '/stock/b-1/certificate', headers: auth(token) })).json();
    expect(again).toEqual(first);

    const second = (await app.inject({ method: 'POST', url: '/stock/b-1/certificates', headers: auth(token) })).json();
    expect(second.id).not.toBe(first.id);
    expect(second.conditions.freshness).toBe('attention');
  });

  it('says "unknown" when the room was offline', async () => {
    const app = await getApp();
    const token = await signIn(FARMER);
    await storedBatch(180);
    await addReadings(185, 120);
    await addReadings(60, 1);
    const cert = (await app.inject({ method: 'POST', url: '/stock/b-1/certificates', headers: auth(token) })).json();
    expect(cert.conditions.freshness).toBe('unknown');
    expect(cert.conditions.minutesNoData).toBeGreaterThan(50);
  });

  it('can be checked on the public verify page', async () => {
    const app = await getApp();
    const token = await signIn(FARMER);
    await storedBatch(60);
    await addReadings(65, 1);
    const cert = (await app.inject({ method: 'POST', url: '/stock/b-1/certificates', headers: auth(token) })).json();
    const page = await app.inject({ method: 'GET', url: `/verify/${cert.id}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(cert.id);
    expect(page.body).toContain('Kept in the safe range');
    const fake = await app.inject({ method: 'GET', url: '/verify/HHR-FAKE-0000' });
    expect(fake.statusCode).toBe(404);
  });
});

describe('marketplace', () => {
  it('runs an order from listing to acceptance', async () => {
    const app = await getApp();
    const farmer = await signIn(FARMER);
    const buyer = await signIn(BUYER);
    await addReadings(10, 1);
    const batch = (await app.inject({ method: 'POST', url: '/stock', headers: auth(farmer), payload: { crop: 'carrot', quantity: 100, unit: 'kg' } })).json();
    const listing = (await app.inject({ method: 'POST', url: '/listings', headers: auth(farmer), payload: { batchId: batch.id, quantity: 80, pricePerUnit: 450 } })).json();

    // Listing a crop issues a certificate automatically, so buyers can open it.
    const cert = await app.inject({ method: 'GET', url: `/stock/${batch.id}/certificate`, headers: auth(buyer) });
    expect(cert.statusCode).toBe(200);

    const browse = (await app.inject({ method: 'GET', url: '/listings?crop=carrot', headers: auth(buyer) })).json();
    expect(browse).toHaveLength(1);
    expect(browse[0].farmer).not.toHaveProperty('phone');

    const tooMuch = await app.inject({ method: 'POST', url: '/orders', headers: auth(buyer), payload: { listingId: listing.id, quantity: 81 } });
    expect(tooMuch.json().error).toBe('moreThanAvailable');

    const order = (await app.inject({ method: 'POST', url: '/orders', headers: auth(buyer), payload: { listingId: listing.id, quantity: 30 } })).json();
    expect((await app.inject({ method: 'GET', url: '/alerts', headers: auth(farmer) })).json()[0].type).toBe('orderNew');

    const notMine = await app.inject({ method: 'POST', url: `/orders/${order.id}/respond`, headers: auth(buyer), payload: { accept: true } });
    expect(notMine.statusCode).toBe(403);

    await app.inject({ method: 'POST', url: `/orders/${order.id}/respond`, headers: auth(farmer), payload: { accept: true } });
    const twice = await app.inject({ method: 'POST', url: `/orders/${order.id}/respond`, headers: auth(farmer), payload: { accept: true } });
    expect(twice.json().error).toBe('orderNotPending');

    const [l] = await query('SELECT quantity FROM listings WHERE id = $1', [listing.id]);
    const [b] = await query('SELECT quantity FROM batches WHERE id = $1', [batch.id]);
    expect(l.quantity).toBe(50);
    expect(b.quantity).toBe(70);
    expect((await app.inject({ method: 'GET', url: '/alerts', headers: auth(buyer) })).json()[0].type).toBe('orderAccepted');
  });
});

describe('room alerts', () => {
  it('warns once after the grace period, then says when it is back to normal', async () => {
    const room = await getRoomRow('cr-1');
    const start = Date.now();
    const at = (min: number) => start + min * 60_000;

    await evaluateReading(room, { chamber: 7, humidity: 94, battery: 80 }, at(0));
    await evaluateReading(room, { chamber: 7.5, humidity: 94, battery: 80 }, at(20));
    expect(await query("SELECT * FROM alerts WHERE type = 'chamberWarm'")).toHaveLength(0);

    await evaluateReading(room, { chamber: 7.8, humidity: 94, battery: 80 }, at(31));
    await evaluateReading(room, { chamber: 8, humidity: 94, battery: 80 }, at(35));
    expect(await query("SELECT * FROM alerts WHERE type = 'chamberWarm'")).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 50)); // SMS is sent in the background
    expect(sent.some((s) => s.to === FARMER && s.text.includes('too warm'))).toBe(true);

    await evaluateReading(room, { chamber: 3, humidity: 94, battery: 80 }, at(40));
    expect(await query("SELECT * FROM alerts WHERE type = 'backToNormal'")).toHaveLength(1);
  });

  it('warns about freezing near the coil', async () => {
    const room = await getRoomRow('cr-1');
    const start = Date.now();
    await evaluateReading(room, { chamber: 1.5, coil_outlet: -0.6, humidity: 94, battery: 80 }, start);
    await evaluateReading(room, { chamber: 1.5, coil_outlet: -0.8, humidity: 94, battery: 80 }, start + 11 * 60_000);
    expect(await query("SELECT * FROM alerts WHERE type = 'chamberCold'")).toHaveLength(1);
  });
});
