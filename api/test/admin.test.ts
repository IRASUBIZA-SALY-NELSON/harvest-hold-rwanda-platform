import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { newId } from '../src/common/ids.js';
import { hashPassword } from '../src/modules/admin/admin-auth.controller.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { MediaService } from '../src/modules/media/media.service.js';
import { closeApp, DEVICE_TOKEN, getApp, query, reset, service, signIn } from './helpers.js';

const FARMER = '+250788000001';
const BUYER = '+250788000002';
const PASSWORD = 'correct-horse-battery-9';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

beforeEach(reset);
afterAll(() => closeApp());

/** An admin who already chose their own password. Returns a signed-in session token. */
async function adminSession(role: 'superadmin' | 'support' | 'operations' | 'market' = 'superadmin', email = `${role}@test.rw`) {
  const app = await getApp();
  const id = newId('ad');
  await query('INSERT INTO admins (id, email, name, role, password_hash, must_change_password) VALUES ($1, $2, $3, $4, $5, false)', [
    id,
    email,
    `Test ${role}`,
    role,
    await hashPassword(PASSWORD),
  ]);
  const login = await app.inject({ method: 'POST', url: '/admin/auth/login', payload: { email, password: PASSWORD } });
  if (login.statusCode !== 200) throw new Error(login.body);
  return { token: login.json().token as string, id };
}

/** multipart/form-data body for inject(). */
function multipart(fields: Record<string, string>, file?: { name: string; data: Buffer; type: string }) {
  const boundary = '----hh' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** A JPEG with a GPS position in its EXIF, like a phone photo. */
const phonePhoto = () =>
  sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#e07b39' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestPhone' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '1/1 26/1 0/1' } })
    .toBuffer();

describe('admin sign-in', () => {
  it('signs in with email and password; a temporary password must be changed first', async () => {
    const app = await getApp();
    await query("INSERT INTO admins (id, email, name, role, password_hash) VALUES ('ad-1', 'new@test.rw', 'New Admin', 'superadmin', $1)", [await hashPassword(PASSWORD)]);

    const wrong = await app.inject({ method: 'POST', url: '/admin/auth/login', payload: { email: 'new@test.rw', password: 'nope' } });
    expect(wrong.json().error).toBe('wrongCredentials');

    const login = await app.inject({ method: 'POST', url: '/admin/auth/login', payload: { email: 'NEW@test.rw', password: PASSWORD } });
    expect(login.json().next).toBe('password');
    const token = login.json().token;

    // Still the temporary password: only the password change is allowed.
    expect((await app.inject({ method: 'GET', url: '/admin/overview', headers: bearer(token) })).json().error).toBe('passwordChangeRequired');
    expect((await app.inject({ method: 'GET', url: '/admin/auth/me', headers: bearer(token) })).json().must_change_password).toBe(true);
    const weak = await app.inject({ method: 'POST', url: '/admin/auth/password', headers: bearer(token), payload: { current: PASSWORD, next: 'short1' } });
    expect(weak.json().error).toBe('passwordTooWeak');
    const changed = await app.inject({ method: 'POST', url: '/admin/auth/password', headers: bearer(token), payload: { current: PASSWORD, next: 'a-much-better-passw0rd' } });
    expect(changed.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/admin/overview', headers: bearer(token) })).statusCode).toBe(200);

    const again = await app.inject({ method: 'POST', url: '/admin/auth/login', payload: { email: 'new@test.rw', password: 'a-much-better-passw0rd' } });
    expect(again.json().next).toBe('portal');
    const [entry] = await query("SELECT summary FROM audit_log WHERE action = 'admin.login' ORDER BY id DESC LIMIT 1");
    expect(entry.summary).toBe('new@test.rw signed in');
  });

  it('locks an admin after 5 failed attempts until another admin unlocks them', async () => {
    const app = await getApp();
    await adminSession('market', 'locked@test.rw');
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/admin/auth/login', payload: { email: 'locked@test.rw', password: 'wrong' } });
    const res = await app.inject({ method: 'POST', url: '/admin/auth/login', payload: { email: 'locked@test.rw', password: PASSWORD } });
    expect(res.json().error).toBe('accountLocked');
  });
});

describe('roles', () => {
  it('limits each role to its own area; superadmin can do everything', async () => {
    const app = await getApp();
    const support = await adminSession('support');
    const ops = await adminSession('operations');
    const room = { name: 'Nyabihu Hub', district: 'Nyabihu', sector: 'Mukamira', crop: 'carrot', capacityCrates: 20 };
    expect((await app.inject({ method: 'POST', url: '/admin/rooms', headers: bearer(support.token), payload: room })).statusCode).toBe(403);
    const created = await app.inject({ method: 'POST', url: '/admin/rooms', headers: bearer(ops.token), payload: room });
    expect(created.statusCode).toBe(200);
    expect(created.json().deviceToken).toMatch(/^[0-9a-f]{48}$/);
    expect((await app.inject({ method: 'GET', url: '/admin/staff', headers: bearer(ops.token) })).statusCode).toBe(403);
  });

  it('keeps one active superadmin', async () => {
    const app = await getApp();
    const me = await adminSession('superadmin');
    const self = await app.inject({ method: 'PATCH', url: `/admin/staff/${me.id}`, headers: bearer(me.token), payload: { status: 'disabled' } });
    expect(self.json().error).toBe('cannotChangeSelf');
  });
});

describe('managing farmers and buyers', () => {
  it('unlocks, resets a PIN and suspends, all in the audit trail', async () => {
    const app = await getApp();
    const { token } = await adminSession('support');
    const farmerToken = await signIn(FARMER);
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/auth/sign-in', payload: { phone: FARMER, pin: '9999' } });

    const noReason = await app.inject({ method: 'POST', url: '/admin/users/u-f/unlock', headers: bearer(token), payload: {} });
    expect(noReason.json().error).toBe('verificationRequired');
    await app.inject({ method: 'POST', url: '/admin/users/u-f/unlock', headers: bearer(token), payload: { verification: 'Called back on registered number' } });
    expect(await signIn(FARMER)).toBeTruthy();

    const reset = (await app.inject({ method: 'POST', url: '/admin/users/u-f/reset-pin', headers: bearer(token), payload: { verification: 'Visited the cold room in person' } })).json();
    expect(reset.pin).toMatch(/^\d{4}$/);
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(farmerToken) })).statusCode).toBe(401); // old sessions ended
    const newToken = await signIn(FARMER, reset.pin);

    await app.inject({ method: 'POST', url: '/admin/users/u-f/suspend', headers: bearer(token), payload: { reason: 'Fraudulent listings reported' } });
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(newToken) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/auth/sign-in', payload: { phone: FARMER, pin: reset.pin } })).json().error).toBe('accountSuspended');

    const actions = (await query("SELECT action FROM audit_log WHERE entity_id = 'u-f' ORDER BY id")).map((r) => r.action);
    expect(actions).toEqual(['user.lock', 'user.unlock', 'user.resetPin', 'user.suspend']);
  });
});

describe('audit trail', () => {
  it('is append-only and detects tampering', async () => {
    const app = await getApp();
    const { token } = await adminSession('superadmin');
    await app.inject({ method: 'POST', url: '/admin/users/u-f/sign-out', headers: bearer(token) });
    expect((await app.inject({ method: 'GET', url: '/admin/audit/verify', headers: bearer(token) })).json()).toMatchObject({ ok: true });

    await expect(query("UPDATE audit_log SET summary = 'nothing happened'")).rejects.toThrow(/append-only/);

    // Someone with direct database access disables the guard and rewrites history:
    await query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update');
    await query("UPDATE audit_log SET summary = 'nothing happened' WHERE action = 'user.signOut'");
    await query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update');
    const check = (await app.inject({ method: 'GET', url: '/admin/audit/verify', headers: bearer(token) })).json();
    expect(check.ok).toBe(false);
    expect(check.brokenAt).toBeGreaterThan(0);
  });
});

describe('photos', () => {
  it('stores phone photos resized, as WebP, without the GPS position', async () => {
    const app = await getApp();
    const farmer = await signIn(FARMER);
    await query("INSERT INTO batches (id, farmer_id, cold_room_id, crop, quantity, unit) VALUES ('b-t' || (SELECT count(*) FROM batches), 'u-f', 'cr-1', 'carrot', 50, 'kg')");
    const batch = (await query('SELECT id FROM batches ORDER BY stored_at DESC LIMIT 1'))[0];
    const form = multipart({ kind: 'checkin', entityId: batch.id }, { name: 'IMG_0001.jpg', data: await phonePhoto(), type: 'image/jpeg' });
    const res = await app.inject({ method: 'POST', url: '/photos', headers: { ...bearer(farmer), ...form.headers }, payload: form.payload });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ width: 1600, height: 1200 });

    const file = await app.inject({ method: 'GET', url: `/media/${res.json().id}` });
    expect(file.headers['content-type']).toBe('image/webp');
    const meta = await sharp(file.rawPayload).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();

    const thumb = await app.inject({ method: 'GET', url: `/media/${res.json().id}?size=thumb` });
    expect((await sharp(thumb.rawPayload).metadata()).width).toBe(480);

    // The stock item and the certificate show it.
    expect((await app.inject({ method: 'GET', url: `/stock/${batch.id}`, headers: bearer(farmer) })).json().batch.photos).toEqual([res.json().id]);
  });

  it('refuses files that are not pictures, and photos on someone else’s stock', async () => {
    const app = await getApp();
    const farmer = await signIn(FARMER);
    const buyer = await signIn(BUYER);
    await query("INSERT INTO batches (id, farmer_id, cold_room_id, crop, quantity, unit) VALUES ('b-t' || (SELECT count(*) FROM batches), 'u-f', 'cr-1', 'carrot', 50, 'kg')");
    const batch = (await query('SELECT id FROM batches ORDER BY stored_at DESC LIMIT 1'))[0];
    const fake = multipart({ kind: 'checkin', entityId: batch.id }, { name: 'photo.jpg', data: Buffer.from('<?php system($_GET["c"]); ?>'), type: 'image/jpeg' });
    expect((await app.inject({ method: 'POST', url: '/photos', headers: { ...bearer(farmer), ...fake.headers }, payload: fake.payload })).json().error).toBe('unsupportedImage');
    const real = multipart({ kind: 'checkin', entityId: batch.id }, { name: 'a.jpg', data: await phonePhoto(), type: 'image/jpeg' });
    expect((await app.inject({ method: 'POST', url: '/photos', headers: { ...bearer(buyer), ...real.headers }, payload: real.payload })).statusCode).toBe(403);
  });

  it('lets moderators remove a photo everywhere', async () => {
    const app = await getApp();
    const { token } = await adminSession('market');
    const farmer = await signIn(FARMER);
    const form = multipart({ kind: 'profile' }, { name: 'me.jpg', data: await phonePhoto(), type: 'image/jpeg' });
    const photo = (await app.inject({ method: 'POST', url: '/photos', headers: { ...bearer(farmer), ...form.headers }, payload: form.payload })).json();
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(farmer) })).json().photoId).toBe(photo.id);

    await app.inject({ method: 'POST', url: `/admin/photos/${photo.id}/remove`, headers: bearer(token), payload: { reason: 'Not a photo of the farmer' } });
    expect((await app.inject({ method: 'GET', url: `/media/${photo.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(farmer) })).json().photoId).toBeNull();
    expect((await app.inject({ method: 'GET', url: `/admin/photos/${photo.id}/file`, headers: bearer(token) })).statusCode).toBe(200);
  });

  it('deletes the files of photos removed more than 30 days ago; those cannot be restored', async () => {
    const app = await getApp();
    const { token } = await adminSession('market');
    const farmer = await signIn(FARMER);
    const upload = async () => {
      const form = multipart({ kind: 'profile' }, { name: 'me.jpg', data: await phonePhoto(), type: 'image/jpeg' });
      return (await app.inject({ method: 'POST', url: '/photos', headers: { ...bearer(farmer), ...form.headers }, payload: form.payload })).json().id as string;
    };
    const old = await upload();
    const recent = await upload(); // replaces `old` as the profile photo, which removes it
    await app.inject({ method: 'DELETE', url: `/photos/${recent}`, headers: bearer(farmer) });
    await query("UPDATE photos SET removed_at = now() - interval '31 days' WHERE id = $1", [old]);

    expect(await service(MediaService).purge()).toBe(1);
    expect(await service(MediaService).purge()).toBe(0);
    expect((await app.inject({ method: 'GET', url: `/admin/photos/${old}/file`, headers: bearer(token) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/admin/photos/${old}/restore`, headers: bearer(token) })).statusCode).toBe(404);
    // Removed only recently: the file is kept and can come back.
    expect((await app.inject({ method: 'POST', url: `/admin/photos/${recent}/restore`, headers: bearer(token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/media/${recent}` })).statusCode).toBe(200);
  });
});

describe('certificates and the market', () => {
  async function listedBatch() {
    const app = await getApp();
    const farmer = await signIn(FARMER);
    await query('INSERT INTO readings (room_id, at, chamber, humidity) SELECT $1, now() - make_interval(mins => g), 2, 94 FROM generate_series(1, 30) g', ['cr-1']);
    await query("INSERT INTO batches (id, farmer_id, cold_room_id, crop, quantity, unit) VALUES ('b-t' || (SELECT count(*) FROM batches), 'u-f', 'cr-1', 'carrot', 50, 'kg')");
    const batch = (await query('SELECT id FROM batches ORDER BY stored_at DESC LIMIT 1'))[0];
    const listing = (await app.inject({ method: 'POST', url: '/listings', headers: bearer(farmer), payload: { batchId: batch.id, quantity: 40, pricePerUnit: 450 } })).json();
    const cert = (await app.inject({ method: 'GET', url: `/stock/${batch.id}/certificate`, headers: bearer(farmer) })).json();
    return { farmer, batch, listing, cert };
  }

  it('signs certificates; editing the stored record breaks the signature', async () => {
    const app = await getApp();
    const { token } = await adminSession('market');
    const { cert } = await listedBatch();
    expect(cert.signed).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/verify/${cert.id}.json` })).json().signatureValid).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/verify/${cert.id}` })).body).toContain('Genuine: digitally signed');

    await query(`UPDATE certificates SET data = jsonb_set(data, '{conditions,freshness}', '"fresh"') || '{"tampered": true}' WHERE id = $1`, [cert.id]);
    expect((await app.inject({ method: 'GET', url: `/admin/certificates/${cert.id}`, headers: bearer(token) })).json().signatureValid).toBe(false);
    expect((await app.inject({ method: 'GET', url: `/verify/${cert.id}` })).body).toContain('this record was altered');
  });

  it('revokes a certificate: the public page says so and the farmer is told', async () => {
    const app = await getApp();
    const { token } = await adminSession('market');
    const { cert } = await listedBatch();
    await app.inject({ method: 'POST', url: `/admin/certificates/${cert.id}/revoke`, headers: bearer(token), payload: { reason: 'Crates found damaged at pickup' } });
    expect((await app.inject({ method: 'GET', url: `/verify/${cert.id}` })).body).toContain('Revoked');
    expect((await query("SELECT type FROM alerts WHERE user_id = 'u-f'")).map((a) => a.type)).toContain('certificateRevoked');
  });

  it('hides a listing from the market but not from its farmer', async () => {
    const app = await getApp();
    const { token } = await adminSession('market');
    const { farmer, listing } = await listedBatch();
    const buyer = await signIn(BUYER);
    await app.inject({ method: 'POST', url: `/admin/listings/${listing.id}/hide`, headers: bearer(token), payload: { reason: 'Price looks like a typing mistake' } });
    expect((await app.inject({ method: 'GET', url: '/listings', headers: bearer(buyer) })).json()).toHaveLength(0);
    expect((await app.inject({ method: 'POST', url: '/orders', headers: bearer(buyer), payload: { listingId: listing.id, quantity: 1 } })).statusCode).toBe(404);
    const mine = (await app.inject({ method: 'GET', url: '/my/listings', headers: bearer(farmer) })).json();
    expect(mine[0]).toMatchObject({ moderation: 'hidden', moderationReason: 'Price looks like a typing mistake' });
  });
});

describe('operations', () => {
  it('refuses unsafe crop profiles and sends safe changes to the controllers', async () => {
    const app = await getApp();
    const { token } = await adminSession('operations');
    const [profile] = await query("SELECT data FROM crop_profiles WHERE crop = 'carrot'");
    const unsafe = { ...profile.data, controller: { ...profile.data.controller, freezeGuardC: -5 } };
    const bad = await app.inject({ method: 'PUT', url: '/admin/crops/carrot', headers: bearer(token), payload: { data: unsafe, reason: 'Testing a deeper freeze guard' } });
    expect(bad.json().error).toBe('unsafeProfile');

    const safe = { ...profile.data, controller: { ...profile.data.controller, targetC: 2.5 } };
    const ok = await app.inject({ method: 'PUT', url: '/admin/crops/carrot', headers: bearer(token), payload: { data: safe, reason: 'Less frost on the Peltier heatsink' } });
    expect(ok.json().version).toBe(profile.data.version + 1);
    const device = await app.inject({ method: 'GET', url: '/devices/cr-1/profile', headers: bearer(DEVICE_TOKEN) });
    expect(device.json()).toMatchObject({ targetC: 2.5, version: profile.data.version + 1 });
    const [entry] = await query("SELECT summary, before, after FROM audit_log WHERE action = 'crop.update'");
    expect(entry.before).toEqual({ 'controller.targetC': 2 });
    expect(entry.after).toEqual({ 'controller.targetC': 2.5 });
  });

  it('offers a beta firmware only to beta rooms, and nothing once halted', async () => {
    const app = await getApp();
    const { token } = await adminSession('operations');
    const bin = Buffer.concat([Buffer.from([0xe9]), Buffer.alloc(2047, 1)]);
    const form = multipart({ version: '9', channel: 'beta', notes: 'Smoother PI tuning' }, { name: 'fw.bin', data: bin, type: 'application/octet-stream' });
    expect((await app.inject({ method: 'POST', url: '/admin/firmware', headers: { ...bearer(token), ...form.headers }, payload: form.payload })).statusCode).toBe(200);

    const offered = () => app.inject({ method: 'GET', url: '/devices/cr-1/firmware', headers: bearer(DEVICE_TOKEN) });
    expect((await offered()).statusCode).toBe(204); // cr-1 is on stable
    await app.inject({ method: 'PATCH', url: '/admin/rooms/cr-1', headers: bearer(token), payload: { firmwareChannel: 'beta' } });
    expect((await offered()).json().version).toBe(9);
    await app.inject({ method: 'POST', url: '/admin/firmware/9/halt', headers: bearer(token), payload: { reason: 'Rollbacks reported' } });
    expect((await offered()).statusCode).toBe(204);
  });

  it('publishes live readings to connected admins', async () => {
    const app = await getApp();
    const events = service(EventsService);
    const received = new Promise<any>((resolve) => {
      const sub = events.events$.subscribe((e) => {
        if (e.type === 'reading') {
          sub.unsubscribe();
          resolve(e);
        }
      });
    });
    await new Promise((r) => setTimeout(r, 300)); // listener connected
    await app.inject({ method: 'POST', url: '/devices/cr-1/readings', headers: bearer(DEVICE_TOKEN), payload: { chamber: 2.4, hotSide: 41, coolerDuty: 60 } });
    expect((await received).reading).toMatchObject({ chamber: 2.4, hotSide: 41, coolerDuty: 60 });
  });

  it('builds the overview and analytics', async () => {
    const app = await getApp();
    const { token } = await adminSession('support');
    await query('INSERT INTO readings (room_id, at, chamber, humidity, hot_side, cooler_duty) SELECT $1, now() - make_interval(mins => g), 2, 94, 40, 50 FROM generate_series(1, 120) g', ['cr-1']);
    const overview = (await app.inject({ method: 'GET', url: '/admin/overview', headers: bearer(token) })).json();
    expect(overview.kpis).toMatchObject({ rooms: 1, roomsOnline: 1, farmers: 1, buyers: 1 });
    expect(overview.rooms[0].health.score).toBeGreaterThan(0);
    expect(overview.rooms[0].health.factors.map((f: any) => f.key)).toEqual(['range', 'data', 'hotSide', 'coolerLoad', 'incidents']);
    const analytics = (await app.inject({ method: 'GET', url: '/admin/analytics?days=7', headers: bearer(token) })).json();
    expect(analytics.compliance.length).toBeGreaterThan(0);
    const csv = await app.inject({ method: 'GET', url: '/admin/export/users.csv', headers: bearer(token) });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Farmer One');
  });
});
