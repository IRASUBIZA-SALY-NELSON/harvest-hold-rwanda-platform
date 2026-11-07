import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { rules } from './config.js';
import { one, query } from './db.js';
import { ApiError } from './errors.js';
import { randomToken, sha256 } from './ids.js';

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

/**
 * PINs are never stored: only a bcrypt hash (salted, deliberately slow), so a copy of the
 * database does not reveal anyone's PIN.
 */
export const hashPin = (pin: string) => bcrypt.hash(pin, 12);
export const checkPin = (pin: string, hash: string) => bcrypt.compare(pin, hash);

/** Compared against when the phone number is unknown, so the reply takes the same time either way. */
export const DUMMY_PIN_HASH = bcrypt.hashSync('not-a-real-pin', 12);

export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  await query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))", [sha256(token), userId, rules.sessionDays]);
  return token;
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

export async function deleteSession(req: FastifyRequest) {
  const token = bearer(req);
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

/** preHandler: requires a signed-in user. */
export async function requireUser(req: FastifyRequest, _reply: FastifyReply) {
  const token = bearer(req);
  if (!token) throw new ApiError('signedOut', 401);
  const user = await one<SessionUser>(
    `SELECT u.id, u.role, u.name, u.cold_room_id, u.business_name
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)]
  );
  if (!user) throw new ApiError('signedOut', 401);
  req.user = user;
}

export const requireRole = (role: 'farmer' | 'buyer') => async (req: FastifyRequest, reply: FastifyReply) => {
  await requireUser(req, reply);
  if (req.user!.role !== role) throw new ApiError('notAllowed', 403);
};

/** preHandler for controllers: Authorization: Bearer <device token> for the room in the URL. */
export async function requireDevice(req: FastifyRequest<{ Params: { id: string } }>) {
  const token = bearer(req);
  const room = await one<{ device_token_hash: string | null }>('SELECT device_token_hash FROM cold_rooms WHERE id = $1', [req.params.id]);
  if (!token || !room?.device_token_hash || room.device_token_hash !== sha256(token)) throw new ApiError('notAllowed', 401);
}
