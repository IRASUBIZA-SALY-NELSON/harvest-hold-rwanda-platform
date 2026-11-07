import mqtt from 'mqtt';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { newId, sha256 } from '../src/common/ids.js';
import { hashPassword } from '../src/modules/admin/admin-auth.controller.js';
import { MqttService } from '../src/modules/mqtt/mqtt.service.js';
import { closeApp, DEVICE_TOKEN, getApp, query, reset, service, signIn } from './helpers.js';

const PASSWORD = 'correct-horse-battery-9';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const device = { authorization: `Bearer ${DEVICE_TOKEN}` };

beforeEach(reset);
afterAll(() => closeApp());

async function staff(role: string, email = `${role}@test.rw`) {
  const app = await getApp();
  const id = newId('ad');
  await query('INSERT INTO admins (id, email, name, role, password_hash, must_change_password) VALUES ($1, $2, $3, $4, $5, false)', [id, email, `Test ${role}`, role, await hashPassword(PASSWORD)]);
  const login = await app.inject({ method: 'POST', url: '/admin/auth/login', payload: { email, password: PASSWORD } });
  return { id, token: login.json().token as string };
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, token: string, payload?: unknown) {
  const app = await getApp();
  return app.inject({ method, url, headers: bearer(token), payload: payload as any });
}

async function secondRoom() {
  await query("INSERT INTO cold_rooms (id, name, district, sector, crop, capacity_crates) VALUES ('cr-2', 'Other Hub', 'Huye', 'Tumba', 'carrot', 40)");
}

describe('room ids', () => {
  it('gives new rooms HHR-001 style ids', async () => {
    const { token } = await staff('operations');
    const a = await call('POST', '/admin/rooms', token, { name: 'Musanze Hub', district: 'Musanze', sector: 'Kinigi', crop: 'carrot', capacityCrates: 50 });
    const b = await call('POST', '/admin/rooms', token, { name: 'Huye Hub', district: 'Huye', sector: 'Tumba', crop: 'carrot', capacityCrates: 50 });
    expect(a.json().id).toMatch(/^HHR-\d{3}$/);
    expect(Number(b.json().id.slice(4))).toBe(Number(a.json().id.slice(4)) + 1);
  });

  it('keeps a controller working that still uses the old id', async () => {
    await query("UPDATE cold_rooms SET id = 'HHR-900', legacy_id = 'cr-1' WHERE id = 'cr-1'");
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: '/devices/cr-1/readings', headers: device, payload: { chamber: 2.1 } });
    expect(res.statusCode).toBe(200);
    expect((await query("SELECT room_id FROM readings"))[0].room_id).toBe('HHR-900');
  });
});

describe('real and simulated readings', () => {
  it('marks simulated readings and shows it on the certificate record', async () => {
    const app = await getApp();
    await app.inject({ method: 'POST', url: '/devices/cr-1/readings', headers: device, payload: { chamber: 2, simulated: true } });
    await app.inject({ method: 'POST', url: '/devices/cr-1/readings', headers: device, payload: { readings: [{ t: Math.floor(Date.now() / 1000) - 600, chamber: 2 }] } });
    const rows = await query('SELECT source FROM readings ORDER BY at');
    expect(rows.map((r) => r.source).sort()).toEqual(['device', 'simulated']);
    const summary = await service((await import('../src/modules/rooms/rooms.service.js')).RoomsService).summarize(await service((await import('../src/modules/rooms/rooms.service.js')).RoomsService).getRow('cr-1'), Date.now() - 3600_000);
    expect(summary.dataSource).toBe('mixed');
  });
});

describe('remote commands', () => {
  it('delivers a command over HTTPS and records the answer', async () => {
    const { token } = await staff('operations');
    const sent = await call('POST', '/admin/rooms/cr-1/commands', token, { type: 'set_target', params: { targetC: 3, minutes: 60 }, reason: 'Gentler for a small load' });
    expect(sent.statusCode).toBe(200);
    const app = await getApp();
    const up = await app.inject({ method: 'POST', url: '/devices/cr-1/readings', headers: device, payload: { chamber: 2 } });
    expect(up.json().commands).toEqual([expect.objectContaining({ type: 'set_target', params: { targetC: 3, minutes: 60 } })]);
    const id = up.json().commands[0].id;
    await app.inject({ method: 'POST', url: `/devices/cr-1/commands/${id}/ack`, headers: device, payload: { ok: true } });
    expect((await query('SELECT status FROM room_commands WHERE id = $1', [id]))[0].status).toBe('done');
    expect((await query("SELECT 1 FROM audit_log WHERE action = 'command.create'")).length).toBe(1);
  });

  it('refuses a target outside the crop safety range, and a missing reason', async () => {
    const { token } = await staff('superadmin');
    const cold = await call('POST', '/admin/rooms/cr-1/commands', token, { type: 'set_target', params: { targetC: 0, minutes: 30 }, reason: 'Make it colder' });
    expect(cold.json().error).toBe('targetOutOfRange');
    const warm = await call('POST', '/admin/rooms/cr-1/commands', token, { type: 'set_target', params: { targetC: 9, minutes: 30 }, reason: 'Make it warmer' });
    expect(warm.json().error).toBe('targetOutOfRange');
    const noReason = await call('POST', '/admin/rooms/cr-1/commands', token, { type: 'cooling', params: { mode: 'off', minutes: 30 } });
    expect(noReason.json().error).toBe('reasonRequired');
    const tooLong = await call('POST', '/admin/rooms/cr-1/commands', token, { type: 'cooling', params: { mode: 'off', minutes: 1500 }, reason: 'Long defrost' });
    expect(tooLong.json().error).toBe('invalidDuration');
  });

  it('replaces an undelivered command of the same kind and drops an expired one', async () => {
    const { token } = await staff('operations');
    await call('POST', '/admin/rooms/cr-1/commands', token, { type: 'inside_fan', params: { mode: 'on', minutes: 30 }, reason: 'Stir the air' });
    await call('POST', '/admin/rooms/cr-1/commands', token, { type: 'inside_fan', params: { mode: 'on', minutes: 45 }, reason: 'Stir it longer' });
    expect((await query("SELECT status FROM room_commands ORDER BY id")).map((r) => r.status)).toEqual(['cancelled', 'pending']);
    await query("UPDATE room_commands SET expires_at = now() - interval '1 minute'");
    const app = await getApp();
    const up = await app.inject({ method: 'POST', url: '/devices/cr-1/readings', headers: device, payload: { chamber: 2 } });
    expect(up.json().commands).toEqual([]);
    expect((await query("SELECT status FROM room_commands WHERE id = (SELECT max(id) FROM room_commands)"))[0].status).toBe('expired');
  });
});

describe('cold room operator', () => {
  it('sees and controls only the assigned rooms', async () => {
    await secondRoom();
    const op = await staff('operator');
    await query("INSERT INTO operator_rooms (admin_id, room_id) VALUES ($1, 'cr-1')", [op.id]);
    const list = await call('GET', '/admin/rooms', op.token);
    expect(list.json().map((r: any) => r.id)).toEqual(['cr-1']);
    expect((await call('GET', '/admin/rooms/cr-2', op.token)).statusCode).toBe(403);
    expect((await call('POST', '/admin/rooms/cr-2/commands', op.token, { type: 'hot_fan', params: { mode: 'on', minutes: 20 }, reason: 'Cool the heatsink' })).statusCode).toBe(403);
    expect((await call('POST', '/admin/rooms/cr-1/commands', op.token, { type: 'hot_fan', params: { mode: 'on', minutes: 20 }, reason: 'Cool the heatsink' })).statusCode).toBe(200);
  });

  it('is kept out of everything not made for operators', async () => {
    const op = await staff('operator');
    for (const url of ['/admin/users', '/admin/staff', '/admin/analytics', '/admin/firmware', '/admin/crops', '/admin/audit', '/admin/certificates', '/admin/listings']) {
      expect((await call('GET', url, op.token)).statusCode, url).toBe(403);
    }
    expect((await call('POST', '/admin/rooms', op.token, { name: 'Mine Now', district: 'Musanze', sector: 'Kinigi', crop: 'carrot', capacityCrates: 5 })).statusCode).toBe(403);
    expect((await call('PUT', '/admin/settings', op.token, { storageRates: { kgPerDay: 1 } })).statusCode).toBe(403);
  });

  it('is assigned rooms by a superadmin', async () => {
    const boss = await staff('superadmin');
    const made = await call('POST', '/admin/staff', boss.token, { email: 'op@test.rw', name: 'Op Erator', role: 'operator', roomIds: ['cr-1'] });
    expect(made.statusCode).toBe(200);
    expect((await query('SELECT room_id FROM operator_rooms WHERE admin_id = $1', [made.json().id])).map((r) => r.room_id)).toEqual(['cr-1']);
    const bad = await call('PUT', `/admin/staff/${made.json().id}/rooms`, boss.token, { roomIds: ['nope'] });
    expect(bad.json().error).toBe('roomNotFound');
  });
});

describe('produce, collection and charges', () => {
  it('registers produce for a farmer with a batch code, harvest date and spot', async () => {
    await secondRoom();
    const op = await staff('operator');
    await query("INSERT INTO operator_rooms (admin_id, room_id) VALUES ($1, 'cr-1')", [op.id]);
    const made = await call('POST', '/admin/batches', op.token, { farmerId: 'u-f', crop: 'carrot', quantity: 40, unit: 'kg', harvestDate: new Date().toISOString().slice(0, 10), storageLocation: 'Rack B' });
    expect(made.statusCode).toBe(200);
    expect(made.json().code).toMatch(/^HHB-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(made.json().storageLocation).toBe('Rack B');
    expect((await query("SELECT kind, reason FROM stock_movements")).map((m) => `${m.kind}:${m.reason}`)).toEqual(['in:checkin']);
    const elsewhere = await call('POST', '/admin/batches', op.token, { farmerId: 'u-f', coldRoomId: 'cr-2', crop: 'carrot', quantity: 5, unit: 'kg' });
    expect(elsewhere.statusCode).toBe(403);
    const future = await call('POST', '/admin/batches', op.token, { farmerId: 'u-f', crop: 'carrot', quantity: 5, unit: 'kg', harvestDate: '2999-01-01' });
    expect(future.json().error).toBe('invalidHarvestDate');
  });

  it('works out the storage charge per day and freezes it on collection', async () => {
    const boss = await staff('superadmin');
    await call('PUT', '/admin/settings', boss.token, { storageRates: { kgPerDay: 5, cratePerDay: 100 } });
    const made = await call('POST', '/admin/batches', boss.token, { farmerId: 'u-f', crop: 'carrot', quantity: 100, unit: 'kg' });
    const id = made.json().id;
    // Stored three Kigali days ago: today counts, so 4 days.
    await query("UPDATE batches SET stored_at = now() - interval '3 days' WHERE id = $1", [id]);
    const farmer = await signIn('+250788000001');
    const charges = await (await getApp()).inject({ method: 'GET', url: '/stock/charges', headers: bearer(farmer) });
    expect(charges.json().runningRwf).toBe(100 * 4 * 5);
    const part = await call('POST', `/admin/batches/${id}/collect`, boss.token, { quantity: 40, collectedBy: 'Jean Claude' });
    expect(part.json()).toMatchObject({ quantity: 40, days: 4, rateRwf: 5, chargeRwf: 800, left: 60 });
    const rest = await call('POST', `/admin/batches/${id}/collect`, boss.token, { all: true, collectedBy: 'Jean Claude' });
    expect(rest.json().left).toBe(0);
    expect((await query('SELECT status FROM batches WHERE id = $1', [id]))[0].status).toBe('removed');
    const detail = await (await getApp()).inject({ method: 'GET', url: `/stock/${id}`, headers: bearer(farmer) });
    expect(detail.json().charges).toMatchObject({ collectedRwf: 2000, runningRwf: 0, dueRwf: 2000 });
    expect(detail.json().batch.collectionStatus).toBe('collected');
    const unpaid = await call('GET', '/admin/collections?payment=unpaid', boss.token);
    expect(unpaid.json().unpaidRwf).toBe(2000);
    const paid = await call('POST', `/admin/collections/${part.json().id}/payment`, boss.token, { method: 'momo', reference: 'MP123' });
    expect(paid.json().paymentStatus).toBe('paid');
  });

  it('shows no charge until a rate is set, and refuses to collect more than is there', async () => {
    const boss = await staff('superadmin');
    const made = await call('POST', '/admin/batches', boss.token, { farmerId: 'u-f', crop: 'carrot', quantity: 10, unit: 'kg' });
    const farmer = await signIn('+250788000001');
    const charges = await (await getApp()).inject({ method: 'GET', url: '/stock/charges', headers: bearer(farmer) });
    expect(charges.json().rateSet).toBe(false);
    const over = await call('POST', `/admin/batches/${made.json().id}/collect`, boss.token, { quantity: 11, collectedBy: 'Someone' });
    expect(over.json().error).toBe('moreThanStock');
  });

  it('lets a farmer ask for collection, but not take produce out without a record', async () => {
    const boss = await staff('superadmin');
    const made = await call('POST', '/admin/batches', boss.token, { farmerId: 'u-f', crop: 'carrot', quantity: 10, unit: 'kg' });
    const farmer = await signIn('+250788000001');
    const app = await getApp();
    expect((await app.inject({ method: 'POST', url: `/stock/${made.json().id}/request-collection`, headers: bearer(farmer) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/stock/${made.json().id}/remove`, headers: bearer(farmer) })).statusCode).toBe(404);
    const detail = await app.inject({ method: 'GET', url: `/stock/${made.json().id}`, headers: bearer(farmer) });
    expect(detail.json().batch.collectionStatus).toBe('requested');
  });

  it('records a market sale as stock out and a collection', async () => {
    const boss = await staff('superadmin');
    const made = await call('POST', '/admin/batches', boss.token, { farmerId: 'u-f', crop: 'carrot', quantity: 50, unit: 'kg' });
    const app = await getApp();
    const farmer = await signIn('+250788000001');
    const buyer = await signIn('+250788000002');
    const listing = await app.inject({ method: 'POST', url: '/listings', headers: bearer(farmer), payload: { batchId: made.json().id, quantity: 30, pricePerUnit: 600 } });
    expect(listing.statusCode).toBe(200);
    const detail = await app.inject({ method: 'GET', url: `/listings/${listing.json().id}`, headers: bearer(buyer) });
    expect(detail.json().contact).toMatchObject({ name: 'Farmer One', phone: '+250788000001' });
    const order = await app.inject({ method: 'POST', url: '/orders', headers: bearer(buyer), payload: { listingId: listing.json().id, quantity: 10 } });
    await app.inject({ method: 'POST', url: `/orders/${order.json().id}/respond`, headers: bearer(farmer), payload: { accept: true } });
    expect((await query("SELECT kind, quantity FROM collections")).map((c) => `${c.kind}:${c.quantity}`)).toEqual(['sale:10']);
    expect((await query('SELECT quantity FROM batches WHERE id = $1', [made.json().id]))[0].quantity).toBe(40);
    const paid = await call('POST', `/admin/orders/${order.json().id}/payment`, boss.token, { method: 'cash' });
    expect(paid.statusCode).toBe(200);
  });
});

describe('storage requests', () => {
  async function ask(quantity = 100, extra: object = {}) {
    const app = await getApp();
    const farmer = await signIn('+250788000001');
    const res = await app.inject({ method: 'POST', url: '/storage-requests', headers: bearer(farmer), payload: { crop: 'carrot', quantity, unit: 'kg', note: 'Washed carrots', ...extra } });
    return { farmer, res };
  }

  it('lets the operator weigh and confirm 95 kg of the 100 kg asked, and the farmer sees 95', async () => {
    const { farmer, res } = await ask(100);
    expect(res.statusCode).toBe(200);
    const op = await staff('operator');
    await query("INSERT INTO operator_rooms (admin_id, room_id) VALUES ($1, 'cr-1')", [op.id]);
    const queue = await call('GET', '/admin/storage-requests', op.token);
    expect(queue.json()).toEqual([expect.objectContaining({ id: res.json().id, estimatedQuantity: 100, farmerName: 'Farmer One', status: 'pending' })]);
    const done = await call('POST', `/admin/storage-requests/${res.json().id}/accept`, op.token, { quantity: 95, storageLocation: 'Rack A', inspectionNote: 'Five kg too damaged to store' });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ quantity: 95, requestedQuantity: 100, code: expect.stringMatching(/^HHB-/), storageLocation: 'Rack A' });
    const app = await getApp();
    const mine = await app.inject({ method: 'GET', url: '/storage-requests', headers: bearer(farmer) });
    expect(mine.json()[0]).toMatchObject({ status: 'accepted', confirmedQuantity: 95, estimatedQuantity: 100, batchCode: done.json().code });
    const stock = await app.inject({ method: 'GET', url: '/stock', headers: bearer(farmer) });
    expect(stock.json()[0].batch).toMatchObject({ quantity: 95, initialQuantity: 95, requestedQuantity: 100 });
    expect((await query("SELECT type FROM alerts WHERE user_id = 'u-f'")).map((a) => a.type)).toEqual(['storageAccepted']);
    // a second try on the same request is refused
    expect((await call('POST', `/admin/storage-requests/${res.json().id}/accept`, op.token, { quantity: 95 })).json().error).toBe('requestClosed');
  });

  it('keeps an operator to their own rooms and lets them decline with a reason', async () => {
    await secondRoom();
    const { res } = await ask(50);
    const other = await staff('operator');
    await query("INSERT INTO operator_rooms (admin_id, room_id) VALUES ($1, 'cr-2')", [other.id]);
    expect((await call('GET', '/admin/storage-requests', other.token)).json()).toEqual([]);
    expect((await call('POST', `/admin/storage-requests/${res.json().id}/accept`, other.token, { quantity: 50 })).statusCode).toBe(403);
    const boss = await staff('superadmin');
    expect((await call('POST', `/admin/storage-requests/${res.json().id}/decline`, boss.token, { reason: 'x' })).json().error).toBe('reasonRequired');
    const declined = await call('POST', `/admin/storage-requests/${res.json().id}/decline`, boss.token, { reason: 'The room is full this week' });
    expect(declined.json()).toMatchObject({ status: 'declined', declineReason: 'The room is full this week' });
    expect((await query("SELECT type FROM alerts WHERE user_id = 'u-f'")).map((a) => a.type)).toEqual(['storageDeclined']);
  });

  it('limits open requests and lets a farmer cancel one', async () => {
    for (let i = 0; i < 5; i++) expect((await ask(10)).res.statusCode).toBe(200);
    const { farmer, res } = await ask(10);
    expect(res.statusCode).toBe(429);
    const app = await getApp();
    const first = (await app.inject({ method: 'GET', url: '/storage-requests', headers: bearer(farmer) })).json()[0];
    const cancelled = await app.inject({ method: 'POST', url: `/storage-requests/${first.id}/cancel`, headers: bearer(farmer) });
    expect(cancelled.json().status).toBe('cancelled');
  });
});

describe('storage prices', () => {
  it('uses the most specific price: crop in a room, crop, room, then the system price', async () => {
    const boss = await staff('superadmin');
    const make = async () => (await call('POST', '/admin/batches', boss.token, { farmerId: 'u-f', crop: 'carrot', quantity: 100, unit: 'kg' })).json();
    const rateOf = async (id: string) => {
      const farmer = await signIn('+250788000001');
      return (await (await getApp()).inject({ method: 'GET', url: `/stock/${id}`, headers: bearer(farmer) })).json().charges.rateRwf;
    };
    const batch = await make();
    expect(await rateOf(batch.id)).toBeNull(); // nothing set: no rate, never 0
    await call('PUT', '/admin/settings', boss.token, { storageRates: { kgPerDay: 50, cratePerDay: 900 } });
    expect(await rateOf(batch.id)).toBe(50);
    await call('PATCH', '/admin/rooms/cr-1', boss.token, { storageRateKgDay: 70 });
    expect(await rateOf(batch.id)).toBe(70);
    await call('PUT', '/admin/prices', boss.token, { crop: 'carrot', kgPerDay: 100 });
    expect(await rateOf(batch.id)).toBe(100);
    await call('PUT', '/admin/prices', boss.token, { crop: 'carrot', roomId: 'cr-1', kgPerDay: 120 });
    expect(await rateOf(batch.id)).toBe(120);
    // the example from the CEO: 95 kg x 100 RWF x 5 days
    await call('PUT', '/admin/prices', boss.token, { crop: 'carrot', roomId: 'cr-1', kgPerDay: 100 });
    await query("UPDATE batches SET quantity = 95, initial_quantity = 95, stored_at = now() - interval '4 days' WHERE id = $1", [batch.id]);
    const col = await call('POST', `/admin/batches/${batch.id}/collect`, boss.token, { all: true, collectedBy: 'Jean' });
    expect(col.json()).toMatchObject({ quantity: 95, days: 5, rateRwf: 100, chargeRwf: 47_500 });
  });

  it('lets only the Super Admin change prices', async () => {
    const ops = await staff('operations');
    expect((await call('PUT', '/admin/prices', ops.token, { crop: 'carrot', kgPerDay: 100 })).statusCode).toBe(403);
    const op = await staff('operator');
    expect((await call('PUT', '/admin/prices', op.token, { crop: 'carrot', kgPerDay: 100 })).statusCode).toBe(403);
    expect((await call('GET', '/admin/prices', ops.token)).statusCode).toBe(200);
  });
});

describe('fans and cooling commands', () => {
  it('accepts ON and OFF for the fans and cooling, and refuses nonsense', async () => {
    const boss = await staff('superadmin');
    const send = (type: string, params: object) => call('POST', '/admin/rooms/cr-1/commands', boss.token, { type, params, reason: 'Testing the controls' });
    expect((await send('inside_fan', { mode: 'off', minutes: 60 })).statusCode).toBe(200);
    expect((await send('hot_fan', { mode: 'off', minutes: 30 })).statusCode).toBe(200);
    expect((await send('cooling', { mode: 'off', minutes: 1440 })).statusCode).toBe(200);
    expect((await send('cooling', { mode: 'on' })).json().params).toEqual({ mode: 'auto', minutes: 0 });
    expect((await send('cooling', { mode: 'sideways', minutes: 5 })).json().error).toBe('invalidCommand');
    expect((await send('hot_fan', { mode: 'on', minutes: 1441 })).json().error).toBe('invalidDuration');
  });
});

describe('traceability', () => {
  it('opens a public trace page and a QR image from the batch code', async () => {
    const boss = await staff('superadmin');
    const made = await call('POST', '/admin/batches', boss.token, { farmerId: 'u-f', crop: 'carrot', quantity: 10, unit: 'crate', storageLocation: 'Shelf 2' });
    const app = await getApp();
    const page = await app.inject({ method: 'GET', url: `/trace/${made.json().code}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(made.json().code);
    expect(page.body).toContain('Shelf 2');
    expect(page.body).not.toContain('+250788000001');
    const qr = await app.inject({ method: 'GET', url: `/trace/${made.json().code}/qr.svg` });
    expect(qr.headers['content-type']).toContain('image/svg+xml');
    expect((await app.inject({ method: 'GET', url: '/trace/HHB-NOPE-NOPE' })).statusCode).toBe(404);
  });
});

describe('inventory, energy and recommendations', () => {
  it('shows stock across every room', async () => {
    await secondRoom();
    const boss = await staff('superadmin');
    await call('POST', '/admin/batches', boss.token, { farmerId: 'u-f', crop: 'carrot', quantity: 10, unit: 'crate' });
    const inv = (await call('GET', '/admin/inventory', boss.token)).json();
    expect(inv.byRoom.map((r: any) => r.roomId).sort()).toEqual(['cr-1', 'cr-2']);
    expect(inv.totals).toMatchObject({ batches: 1, crates: 10 });
    expect(inv.byCrop[0]).toMatchObject({ crop: 'carrot', crates: 10 });
  });

  it('compares the energy of rooms and counts only what is installed', async () => {
    await secondRoom();
    const boss = await staff('superadmin');
    const now = Date.now();
    for (let m = 120; m >= 0; m--) {
      await query('INSERT INTO readings (room_id, at, chamber, outside, battery, cooler_voltage, cooler_current, cooler_duty, solar_v, solar_current) VALUES ($1, $2, 2, 20, 70, 12, 3, 60, 18, 2)', ['cr-1', new Date(now - m * 60_000)]);
      await query('INSERT INTO readings (room_id, at, chamber, outside) VALUES ($1, $2, 3, 22)', ['cr-2', new Date(now - m * 60_000)]);
    }
    await call('POST', '/admin/batches', boss.token, { farmerId: 'u-f', crop: 'carrot', quantity: 10, unit: 'crate' });
    await query("UPDATE stock_movements SET at = now() - interval '2 hours'");
    const report = (await call('GET', '/admin/energy?days=7', boss.token)).json();
    const one = report.rooms.find((r: any) => r.roomId === 'cr-1');
    const two = report.rooms.find((r: any) => r.roomId === 'cr-2');
    expect(one.hasPowerMeter).toBe(true);
    expect(one.kwh).toBeGreaterThan(0.05);
    expect(one.hasSolarMeter).toBe(true);
    expect(one.solarKwh).toBeGreaterThan(0);
    expect(one.whPerCrateDay).toBeGreaterThan(0);
    expect(two.hasPowerMeter).toBe(false);
    expect(two.kwh).toBeNull();
    expect(one.liftC).toBe(18);
  });

  it('gives crop tips and warnings from the readings', async () => {
    const boss = await staff('superadmin');
    for (let m = 100; m >= 0; m--) await query('INSERT INTO readings (room_id, at, chamber, humidity, hot_side, battery) VALUES ($1, $2, 7, 80, 54, 20)', ['cr-1', new Date(Date.now() - m * 60_000)]);
    const rec = (await call('GET', '/admin/rooms/cr-1/recommendations', boss.token)).json();
    const keys = rec.items.map((i: any) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['chamberWarm', 'hotSideHigh', 'humidityLow', 'batteryLow']));
    expect(rec.cropTips.tips.length).toBeGreaterThan(3);
  });
});

describe('MQTT backup channel', () => {
  async function broker() {
    const m = service(MqttService);
    await m.start();
    const port = await m.listenPlain(0);
    return { m, port };
  }
  const connect = (port: number, username: string, password: string) =>
    mqtt.connectAsync(`mqtt://127.0.0.1:${port}`, { username, password, reconnectPeriod: 0, connectTimeout: 4000 });

  it('takes readings the same way HTTPS does', async () => {
    const { port } = await broker();
    const c = await connect(port, 'cr-1', DEVICE_TOKEN);
    await c.subscribeAsync('hhr/cr-1/down/#', { qos: 1 });
    const echo = new Promise<any>((resolve) => c.on('message', (topic, payload) => topic.endsWith('/stored') && resolve(JSON.parse(payload.toString()))));
    await c.publishAsync('hhr/cr-1/up/readings', JSON.stringify({ batch: 7, readings: [{ t: Math.floor(Date.now() / 1000) - 60, chamber: 2.4, humidity: 94 }], firmware: 4 }), { qos: 1 });
    expect(await echo).toMatchObject({ batch: 7, accepted: 1 });
    const rows = await query('SELECT via, chamber FROM readings');
    expect(rows).toEqual([{ via: 'mqtt', chamber: 2.4 }]);
    expect((await query('SELECT last_upload_via, firmware_version FROM cold_rooms'))[0]).toMatchObject({ last_upload_via: 'mqtt', firmware_version: 4 });
    await c.endAsync();
  });

  it('refuses a wrong token and keeps a controller to its own topics', async () => {
    const { port } = await broker();
    await expect(connect(port, 'cr-1', 'wrong-token')).rejects.toThrow();
    const spy = await connect(port, 'cr-1', DEVICE_TOKEN);
    await expect(spy.subscribeAsync('hhr/#')).rejects.toMatchObject({ packet: { granted: [128] } });
    await expect(spy.subscribeAsync('hhr/cr-2/down/#')).rejects.toMatchObject({ packet: { granted: [128] } });
    spy.end(true);
    const c = await connect(port, 'cr-1', DEVICE_TOKEN);
    c.on('error', () => {});
    c.publish('hhr/cr-2/up/readings', JSON.stringify({ chamber: 1 }), { qos: 0 });
    await new Promise((r) => setTimeout(r, 400));
    expect(await query('SELECT 1 FROM readings')).toHaveLength(0);
    c.end(true);
  });

  it('pushes a command at once and takes the answer back', async () => {
    const { port } = await broker();
    const c = await connect(port, 'cr-1', DEVICE_TOKEN);
    await c.subscribeAsync('hhr/cr-1/down/command', { qos: 1 });
    const got = new Promise<any>((resolve) => c.on('message', (_t, payload) => resolve(JSON.parse(payload.toString()))));
    const { token } = await staff('operations');
    const sent = await call('POST', '/admin/rooms/cr-1/commands', token, { type: 'cooling', params: { mode: 'off', minutes: 15 }, reason: 'Defrost the coil' });
    const cmd = await got;
    expect(cmd).toMatchObject({ id: sent.json().id, type: 'cooling', params: { mode: 'off', minutes: 15 } });
    await c.publishAsync('hhr/cr-1/up/ack', JSON.stringify({ id: cmd.id, ok: true }), { qos: 1 });
    await new Promise((r) => setTimeout(r, 400));
    expect((await query('SELECT status, sent_via FROM room_commands'))[0]).toEqual({ status: 'done', sent_via: 'mqtt' });
    await c.endAsync();
  });

  it('drops a connected controller after its token is replaced', async () => {
    const { port } = await broker();
    const c = await connect(port, 'cr-1', DEVICE_TOKEN);
    await query("UPDATE cold_rooms SET device_token_hash = $1 WHERE id = 'cr-1'", [sha256('another-token')]);
    await c.publishAsync('hhr/cr-1/up/readings', JSON.stringify({ chamber: 2 }), { qos: 0 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    expect(await query('SELECT 1 FROM readings')).toHaveLength(0);
    c.end(true);
  });
});
