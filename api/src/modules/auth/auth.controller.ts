import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { bearer, CurrentUser, type SessionUser, UserGuard } from '../../common/guards.js';
import { newId } from '../../common/ids.js';
import { BUSINESS_TYPES, LANGS, normalizePhone, oneOf, pin, text } from '../../common/validate.js';
import { userView } from '../../common/views.js';
import { rules } from '../../config.js';
import { AuditService, SYSTEM } from '../audit/audit.service.js';
import { checkDummyPin, checkPin, hashPin, UserAuthService } from './user-auth.service.js';

const DISTRICTS = new Set([
  'Bugesera', 'Burera', 'Gakenke', 'Gasabo', 'Gatsibo', 'Gicumbi', 'Gisagara', 'Huye', 'Kamonyi', 'Karongi',
  'Kayonza', 'Kicukiro', 'Kirehe', 'Muhanga', 'Musanze', 'Ngoma', 'Ngororero', 'Nyabihu', 'Nyagatare', 'Nyamagabe',
  'Nyamasheke', 'Nyanza', 'Nyarugenge', 'Nyaruguru', 'Rubavu', 'Ruhango', 'Rulindo', 'Rusizi', 'Rutsiro', 'Rwamagana',
]);
export const isDistrict = (d: unknown): d is string => typeof d === 'string' && DISTRICTS.has(d);

const STRICT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

/** Farmers' and buyers' accounts (mobile app). */
@Controller()
export class AuthController {
  constructor(
    private db: Database,
    private auth: UserAuthService,
    private audit: AuditService
  ) {}

  @Post('auth/register')
  @HttpCode(200)
  @RouteConfig(STRICT)
  async register(@Body() b: any = {}, @Req() req: FastifyRequest) {
    b ??= {};
    const role = oneOf(b.role, ['farmer', 'buyer'] as const, 'notAllowed');
    const name = text(b.name, 'nameRequired', { min: 2, max: 80 });
    const phone = normalizePhone(b.phone);
    const newPin = pin(b.pin);
    if (!isDistrict(b.district)) throw new ApiError('districtRequired');
    const lang = LANGS.includes(b.lang) ? b.lang : 'rw';
    let coldRoomId: string | null = null;
    let businessName: string | null = null;
    let businessType: string | null = null;
    if (role === 'farmer') {
      if (typeof b.coldRoomId !== 'string' || !(await this.db.one("SELECT 1 FROM cold_rooms WHERE id = $1 AND status <> 'retired'", [b.coldRoomId]))) {
        throw new ApiError('coldRoomRequired');
      }
      coldRoomId = b.coldRoomId;
    } else {
      businessName = text(b.businessName, 'businessRequired', { min: 2, max: 120 });
      businessType = oneOf(b.businessType ?? 'retailer', BUSINESS_TYPES, 'businessRequired');
    }
    if (await this.db.one('SELECT 1 FROM users WHERE phone = $1', [phone])) throw new ApiError('phoneTaken');

    const id = newId('u');
    const user = await this.db.one(
      `INSERT INTO users (id, role, name, phone, pin_hash, district, cold_room_id, business_name, business_type, lang)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, role, name, phone, await hashPin(newPin), b.district, coldRoomId, businessName, businessType, lang]
    );
    await this.audit.record(
      { type: 'user', id, name, ip: req.ip },
      { action: 'user.register', entityType: 'user', entityId: id, summary: `${name} registered as a ${role}`, after: { role, district: b.district, coldRoomId, businessName } }
    );
    return { token: await this.auth.createSession(id), user: userView(user) };
  }

  /**
   * Wrong PINs are counted per account. After rules.pin.maxFailures in a row the account is
   * locked, and stays locked until an administrator reactivates it (users.locked_at = NULL).
   * A locked account cannot sign in even with the right PIN, so guessing cannot continue.
   */
  @Post('auth/sign-in')
  @HttpCode(200)
  @RouteConfig(STRICT)
  async signIn(@Body() b: any, @Req() req: FastifyRequest) {
    b ??= {};
    const phone = normalizePhone(b.phone);
    const given = typeof b.pin === 'string' ? b.pin : '';
    const user = await this.db.one('SELECT * FROM users WHERE phone = $1', [phone]);
    if (!user) {
      await checkDummyPin(given);
      throw new ApiError('wrongCredentials', 401);
    }
    if (user.locked_at) throw new ApiError('accountLocked', 423);
    if (user.status === 'suspended') throw new ApiError('accountSuspended', 403);
    if (!(await checkPin(given, user.pin_hash))) {
      const row = await this.db.one<{ locked: boolean }>(
        `UPDATE users SET failed_pin_attempts = failed_pin_attempts + 1,
                locked_at = CASE WHEN failed_pin_attempts + 1 >= $2 THEN now() ELSE NULL END
          WHERE id = $1 RETURNING locked_at IS NOT NULL AS locked`,
        [user.id, rules.pin.maxFailures]
      );
      if (row?.locked) {
        await this.audit.record(
          { ...SYSTEM, ip: req.ip },
          { action: 'user.lock', entityType: 'user', entityId: user.id, summary: `${user.name}'s account was locked after ${rules.pin.maxFailures} wrong PINs` }
        );
        throw new ApiError('accountLocked', 423);
      }
      throw new ApiError('wrongCredentials', 401);
    }
    await this.db.query('UPDATE users SET failed_pin_attempts = 0 WHERE id = $1', [user.id]);
    return { token: await this.auth.createSession(user.id), user: userView(user) };
  }

  @Post('auth/sign-out')
  @HttpCode(200)
  async signOut(@Req() req: FastifyRequest) {
    await this.auth.deleteSession(bearer(req));
    return { ok: true };
  }

  @Get('me')
  @UseGuards(UserGuard)
  async me(@CurrentUser() u: SessionUser) {
    return userView(await this.db.one('UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING *', [u.id]));
  }

  @Patch('me')
  @UseGuards(UserGuard)
  async update(@CurrentUser() u: SessionUser, @Body() b: any) {
    const lang = oneOf(b?.lang, LANGS, 'unknown');
    return userView(await this.db.one('UPDATE users SET lang = $2 WHERE id = $1 RETURNING *', [u.id, lang]));
  }

  @Post('me/push-token')
  @HttpCode(200)
  @UseGuards(UserGuard)
  async pushToken(@CurrentUser() u: SessionUser, @Body() b: any) {
    const token = text(b?.token, 'unknown', { max: 300 });
    await this.db.query(
      'INSERT INTO push_tokens (token, user_id) VALUES ($1, $2) ON CONFLICT (token) DO UPDATE SET user_id = $2, updated_at = now()',
      [token, u.id]
    );
    return { ok: true };
  }
}
