import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { bearer } from '../../common/guards.js';
import { sha256 } from '../../common/ids.js';
import type { Actor } from '../audit/audit.service.js';

export type AdminRole = 'superadmin' | 'support' | 'operations' | 'market' | 'operator';

export interface AdminSession {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  must_change_password: boolean;
  token_hash: string;
  /** Operators only: the rooms assigned to them. Other roles see every room. */
  roomIds?: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminSession;
  }
}

const ROLES = 'hh:admin-roles';
const STAGE = 'hh:admin-stage';

/**
 * Roles allowed on a route, besides superadmin (always allowed). No decorator = any staff role
 * except a cold room operator: operators only reach routes that name them (fail closed), and those
 * routes must limit what they return to `roomScope(admin)`.
 */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ROLES, roles);
/** Routes still open while a temporary password has not been changed yet. */
export const AdminStage = (stage: 'password') => SetMetadata(STAGE, stage);

/**
 * Admin portal: Authorization: Bearer <admin session token>, sent by the portal's server.
 * A session only opens the portal once the temporary password has been changed.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private db: Database,
    private reflector: Reflector
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const token = bearer(req);
    if (!token) throw new ApiError('signedOut', 401);
    const admin = await this.db.one<AdminSession & { status: string; locked_at: Date | null }>(
      `UPDATE admin_sessions s SET last_used_at = now()
         FROM admins a
        WHERE s.token_hash = $1 AND s.expires_at > now() AND a.id = s.admin_id
        RETURNING a.id, a.email, a.name, a.role, a.status, a.locked_at, a.must_change_password, s.token_hash`,
      [sha256(token)]
    );
    if (!admin || admin.status !== 'active' || admin.locked_at) throw new ApiError('signedOut', 401);
    req.admin = admin;

    const stage = this.reflector.getAllAndOverride<'password'>(STAGE, [ctx.getHandler(), ctx.getClass()]);
    if (!stage && admin.must_change_password) throw new ApiError('passwordChangeRequired', 403);

    const roles = this.reflector.getAllAndOverride<AdminRole[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && admin.role !== 'superadmin' && !roles.includes(admin.role)) throw new ApiError('notAllowed', 403);
    if (admin.role === 'operator') {
      if (!roles?.includes('operator') && !stage) throw new ApiError('notAllowed', 403);
      admin.roomIds = (await this.db.query<{ room_id: string }>('SELECT room_id FROM operator_rooms WHERE admin_id = $1', [admin.id])).map((r) => r.room_id);
    }
    return true;
  }
}

export const CurrentAdmin = createParamDecorator((_d: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<FastifyRequest>().admin!);

/** The audit-trail actor for the signed-in admin. */
export const AdminActor = createParamDecorator((_d: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  // The portal's server forwards the browser's address.
  const forwarded = (req.headers['x-admin-client-ip'] as string | undefined)?.split(',')[0]?.trim();
  return { type: 'admin', id: req.admin!.id, name: `${req.admin!.name} (${req.admin!.role})`, ip: forwarded || req.ip };
});

/** null = every room; otherwise only these (a cold room operator's assigned rooms). */
export const roomScope = (admin: AdminSession): string[] | null => (admin.role === 'operator' ? (admin.roomIds ?? []) : null);

/** Throws unless this staff member may work with the room. */
export function assertRoom(admin: AdminSession, roomId: string) {
  const scope = roomScope(admin);
  if (scope && !scope.includes(roomId)) throw new ApiError('notAllowed', 403);
}

/** For routes any staff member may use, a cold room operator included (who then only sees their rooms). */
export const EVERYONE: AdminRole[] = ['support', 'operations', 'market', 'operator'];
/** For routes that run a room: operations staff and the operators assigned to it. */
export const ROOM_STAFF: AdminRole[] = ['operations', 'operator'];
