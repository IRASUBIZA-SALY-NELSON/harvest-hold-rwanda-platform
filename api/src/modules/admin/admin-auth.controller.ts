import crypto from 'node:crypto';

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import bcrypt from 'bcryptjs';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { bearer } from '../../common/guards.js';
import { randomToken, sha256 } from '../../common/ids.js';
import { rules } from '../../config.js';
import { type Actor, AuditService } from '../audit/audit.service.js';
import { AdminActor, AdminGuard, AdminRoles, type AdminSession, AdminStage, CurrentAdmin } from './admin.guard.js';

const STRICT = { rateLimit: { max: 10, timeWindow: '1 minute' } };
export const hashPassword = (p: string) => bcrypt.hash(p, 12);
const DUMMY = bcrypt.hashSync('not-a-real-password', 12);

/** At least 12 characters, with letters and digits, and not containing the email name. */
export function checkPasswordPolicy(password: unknown, email = ''): string {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) throw new ApiError('passwordTooWeak');
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) throw new ApiError('passwordTooWeak');
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) throw new ApiError('passwordTooWeak');
  return password;
}

/** A readable temporary password, shown once to the admin who created or reset the account. */
export const temporaryPassword = () => `${crypto.randomBytes(9).toString('base64url')}-${crypto.randomInt(10, 99)}`;

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private db: Database,
    private audit: AuditService
  ) {}

  private actor(a: { id: string; name: string; role: string }, req: FastifyRequest): Actor {
    const ip = (req.headers['x-admin-client-ip'] as string | undefined)?.split(',')[0]?.trim() || req.ip;
    return { type: 'admin', id: a.id, name: `${a.name} (${a.role})`, ip };
  }

  /** Email and password. After a temporary password, the session only allows choosing a new one. */
  @Post('login')
  @HttpCode(200)
  @RouteConfig(STRICT)
  async login(@Body() b: any, @Req() req: FastifyRequest) {
    const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
    const password = typeof b?.password === 'string' ? b.password : '';
    const admin = await this.db.one('SELECT * FROM admins WHERE email = $1', [email]);
    if (!admin) {
      await bcrypt.compare(password, DUMMY);
      throw new ApiError('wrongCredentials', 401);
    }
    if (admin.status !== 'active') throw new ApiError('accountDisabled', 403);
    if (admin.locked_at) throw new ApiError('accountLocked', 423);
    if (!(await bcrypt.compare(password, admin.password_hash))) {
      await this.fail(admin, req, 'wrong password');
      throw new ApiError('wrongCredentials', 401);
    }
    const token = randomToken();
    await this.db.query(
      `INSERT INTO admin_sessions (token_hash, admin_id, ip, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
      [sha256(token), admin.id, req.headers['x-admin-client-ip'] ?? req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300), rules.admin.sessionHours]
    );
    await this.db.query('UPDATE admins SET failed_attempts = 0, last_login_at = now() WHERE id = $1', [admin.id]);
    await this.audit.record(this.actor(admin, req), { action: 'admin.login', entityType: 'admin', entityId: admin.id, summary: `${admin.email} signed in` });
    return { token, next: admin.must_change_password ? 'password' : 'portal' };
  }

  /** Counts a failed password; locks the account after rules.admin.maxFailures. */
  private async fail(admin: any, req: FastifyRequest, what: string) {
    const row = await this.db.one<{ locked: boolean }>(
      `UPDATE admins SET failed_attempts = failed_attempts + 1,
              locked_at = CASE WHEN failed_attempts + 1 >= $2 THEN now() ELSE NULL END
        WHERE id = $1 RETURNING locked_at IS NOT NULL AS locked`,
      [admin.id, rules.admin.maxFailures]
    );
    if (row?.locked) {
      await this.db.query('DELETE FROM admin_sessions WHERE admin_id = $1', [admin.id]);
      await this.audit.record(this.actor(admin, req), {
        action: 'admin.lock',
        entityType: 'admin',
        entityId: admin.id,
        summary: `${admin.email} was locked after ${rules.admin.maxFailures} failed sign-in attempts (${what})`,
      });
    }
  }

  /** Change password (required after a temporary one). Signs out the admin's other sessions. */
  @Post('password')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @AdminStage('password')
  async password(@CurrentAdmin() a: AdminSession, @Body() b: any, @Req() req: FastifyRequest) {
    const admin = await this.db.one('SELECT * FROM admins WHERE id = $1', [a.id]);
    if (!(await bcrypt.compare(typeof b?.current === 'string' ? b.current : '', admin.password_hash))) throw new ApiError('wrongCredentials', 401);
    const next = checkPasswordPolicy(b?.next, admin.email);
    if (await bcrypt.compare(next, admin.password_hash)) throw new ApiError('passwordReused');
    await this.db.query('UPDATE admins SET password_hash = $2, must_change_password = false WHERE id = $1', [a.id, await hashPassword(next)]);
    await this.db.query('DELETE FROM admin_sessions WHERE admin_id = $1 AND token_hash <> $2', [a.id, a.token_hash]);
    await this.audit.record(this.actor(admin, req), { action: 'admin.passwordChange', entityType: 'admin', entityId: a.id, summary: `${admin.email} changed their password` });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AdminGuard)
  @AdminStage('password')
  async me(@CurrentAdmin() a: AdminSession) {
    const me = await this.db.one('SELECT id, email, name, role, must_change_password, last_login_at FROM admins WHERE id = $1', [a.id]);
    // A cold room operator works only in these rooms.
    return { ...me, roomIds: a.role === 'operator' ? (a.roomIds ?? []) : null };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: FastifyRequest) {
    const token = bearer(req);
    if (token) await this.db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [sha256(token)]);
    return { ok: true };
  }

  /** The signed-in admin's sessions (browsers), to spot and end ones they don't recognise. */
  @Get('sessions')
  @UseGuards(AdminGuard)
  @AdminRoles('operator')
  async sessions(@CurrentAdmin() a: AdminSession) {
    const rows = await this.db.query('SELECT token_hash, ip, user_agent, created_at, last_used_at FROM admin_sessions WHERE admin_id = $1 AND expires_at > now() ORDER BY last_used_at DESC', [a.id]);
    return rows.map((r) => ({ id: r.token_hash.slice(0, 16), ip: r.ip, userAgent: r.user_agent, createdAt: r.created_at, lastUsedAt: r.last_used_at, current: r.token_hash === a.token_hash }));
  }

  @Delete('sessions/:id')
  @UseGuards(AdminGuard)
  @AdminRoles('operator')
  async endSession(@CurrentAdmin() a: AdminSession, @Param('id') id: string, @AdminActor() actor: Actor) {
    await this.db.query("DELETE FROM admin_sessions WHERE admin_id = $1 AND left(token_hash, 16) = $2", [a.id, id]);
    await this.audit.record(actor, { action: 'admin.sessionEnd', entityType: 'admin', entityId: a.id, summary: `${a.email} ended a session` });
    return { ok: true };
  }
}
