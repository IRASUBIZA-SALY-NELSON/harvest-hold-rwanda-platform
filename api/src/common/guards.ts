import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { ApiError } from './api-error.js';
import { Database } from './database.service.js';
import { sha256 } from './ids.js';

export interface SessionUser {
  id: string;
  role: 'farmer' | 'buyer';
  name: string;
  cold_room_id: string | null;
  business_name: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

const ROLES = 'hh:roles';
/** Limits a route to farmers or buyers. Use with @UseGuards(UserGuard). */
export const Roles = (...roles: SessionUser['role'][]) => SetMetadata(ROLES, roles);

/** Mobile app: requires a signed-in farmer or buyer (Authorization: Bearer <session token>). */
@Injectable()
export class UserGuard implements CanActivate {
  constructor(
    private db: Database,
    private reflector: Reflector
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const token = bearer(req);
    if (!token) throw new ApiError('signedOut', 401);
    const user = await this.db.one<SessionUser & { status: string }>(
      `SELECT u.id, u.role, u.name, u.cold_room_id, u.business_name, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)]
    );
    // An account suspended by an administrator is signed out everywhere at once.
    if (!user || user.status === 'suspended') throw new ApiError('signedOut', 401);
    req.user = user;
    const roles = this.reflector.getAllAndOverride<SessionUser['role'][]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(user.role)) throw new ApiError('notAllowed', 403);
    return true;
  }
}

/** Controllers: Authorization: Bearer <device token> for the room in the URL. */
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(private db: Database) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<FastifyRequest<{ Params: { id: string } }>>();
    const token = bearer(req);
    const room = await this.db.one<{ device_token_hash: string | null }>('SELECT device_token_hash FROM cold_rooms WHERE id = $1 OR legacy_id = $1 ORDER BY (id = $1) DESC LIMIT 1', [req.params.id]);
    if (!token || !room?.device_token_hash || room.device_token_hash !== sha256(token)) throw new ApiError('notAllowed', 401);
    return true;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<FastifyRequest>().user!);
