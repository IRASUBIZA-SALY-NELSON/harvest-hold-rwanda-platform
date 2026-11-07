import type { FastifyInstance } from 'fastify';

import { checkPin, createSession, deleteSession, DUMMY_PIN_HASH, hashPin, requireUser } from '../auth.js';
import { rules } from '../config.js';
import { one, query } from '../db.js';
import { ApiError } from '../errors.js';
import { newId } from '../ids.js';
import { body, BUSINESS_TYPES, LANGS, normalizePhone, oneOf, pin, text } from '../validate.js';
import { userView } from '../views.js';

const DISTRICTS = new Set([
  'Bugesera', 'Burera', 'Gakenke', 'Gasabo', 'Gatsibo', 'Gicumbi', 'Gisagara', 'Huye', 'Kamonyi', 'Karongi',
  'Kayonza', 'Kicukiro', 'Kirehe', 'Muhanga', 'Musanze', 'Ngoma', 'Ngororero', 'Nyabihu', 'Nyagatare', 'Nyamagabe',
  'Nyamasheke', 'Nyanza', 'Nyarugenge', 'Nyaruguru', 'Rubavu', 'Ruhango', 'Rulindo', 'Rusizi', 'Rutsiro', 'Rwamagana',
]);

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/auth/register', strict, async (req) => {
    const b = body(req);
    const role = oneOf(b.role, ['farmer', 'buyer'] as const, 'notAllowed');
    const name = text(b.name, 'nameRequired', { min: 2, max: 80 });
    const phone = normalizePhone(b.phone);
    const newPin = pin(b.pin);
    if (typeof b.district !== 'string' || !DISTRICTS.has(b.district)) throw new ApiError('districtRequired');
    const lang = LANGS.includes(b.lang as any) ? b.lang : 'rw';
    let coldRoomId: string | null = null;
    let businessName: string | null = null;
    let businessType: string | null = null;
    if (role === 'farmer') {
      if (typeof b.coldRoomId !== 'string' || !(await one('SELECT 1 FROM cold_rooms WHERE id = $1', [b.coldRoomId]))) throw new ApiError('coldRoomRequired');
      coldRoomId = b.coldRoomId;
    } else {
      businessName = text(b.businessName, 'businessRequired', { min: 2, max: 120 });
      businessType = oneOf(b.businessType ?? 'retailer', BUSINESS_TYPES, 'businessRequired');
    }
    if (await one('SELECT 1 FROM users WHERE phone = $1', [phone])) throw new ApiError('phoneTaken');

    const id = newId('u');
    const user = await one(
      `INSERT INTO users (id, role, name, phone, pin_hash, district, cold_room_id, business_name, business_type, lang)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, role, name, phone, await hashPin(newPin), b.district, coldRoomId, businessName, businessType, lang]
    );
    return { token: await createSession(id), user: userView(user) };
  });

  /**
   * Wrong PINs are counted per account. After rules.pin.maxFailures in a row the account is
   * locked, and stays locked until an administrator reactivates it (users.locked_at = NULL).
   * A locked account cannot sign in even with the right PIN, so guessing cannot continue.
   */
  app.post('/auth/sign-in', strict, async (req) => {
    const b = body(req);
    const phone = normalizePhone(b.phone);
    const given = typeof b.pin === 'string' ? b.pin : '';
    const user = await one('SELECT * FROM users WHERE phone = $1', [phone]);
    if (!user) {
      await checkPin(given, DUMMY_PIN_HASH);
      throw new ApiError('wrongCredentials', 401);
    }
    if (user.locked_at) throw new ApiError('accountLocked', 423);
    if (!(await checkPin(given, user.pin_hash))) {
      const row = await one<{ locked: boolean }>(
        `UPDATE users SET failed_pin_attempts = failed_pin_attempts + 1,
                locked_at = CASE WHEN failed_pin_attempts + 1 >= $2 THEN now() ELSE NULL END
          WHERE id = $1 RETURNING locked_at IS NOT NULL AS locked`,
        [user.id, rules.pin.maxFailures]
      );
      if (row?.locked) throw new ApiError('accountLocked', 423);
      throw new ApiError('wrongCredentials', 401);
    }
    await query('UPDATE users SET failed_pin_attempts = 0 WHERE id = $1', [user.id]);
    return { token: await createSession(user.id), user: userView(user) };
  });

  app.post('/auth/sign-out', async (req) => {
    await deleteSession(req);
    return { ok: true };
  });

  app.get('/me', { preHandler: requireUser }, async (req) => {
    return userView(await one('SELECT * FROM users WHERE id = $1', [req.user!.id]));
  });

  app.patch('/me', { preHandler: requireUser }, async (req) => {
    const lang = oneOf(body(req).lang, LANGS, 'unknown');
    return userView(await one('UPDATE users SET lang = $2 WHERE id = $1 RETURNING *', [req.user!.id, lang]));
  });

  app.post('/me/push-token', { preHandler: requireUser }, async (req) => {
    const token = text(body(req).token, 'unknown', { max: 300 });
    await query(
      'INSERT INTO push_tokens (token, user_id) VALUES ($1, $2) ON CONFLICT (token) DO UPDATE SET user_id = $2, updated_at = now()',
      [token, req.user!.id]
    );
    return { ok: true };
  });
}
