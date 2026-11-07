import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';

import { Database } from '../../common/database.service.js';
import { randomToken, sha256 } from '../../common/ids.js';
import { rules } from '../../config.js';

/**
 * PINs are never stored: only a bcrypt hash (salted, deliberately slow), so a copy of the
 * database does not reveal anyone's PIN.
 */
export const hashPin = (pin: string) => bcrypt.hash(pin, 12);
export const checkPin = (pin: string, hash: string) => bcrypt.compare(pin, hash);
/** Compared against when the phone number is unknown, so the reply takes the same time either way. */
const DUMMY_PIN_HASH = bcrypt.hashSync('not-a-real-pin', 12);
export const checkDummyPin = (pin: string) => bcrypt.compare(pin, DUMMY_PIN_HASH);

@Injectable()
export class UserAuthService {
  constructor(private db: Database) {}

  async createSession(userId: string): Promise<string> {
    const token = randomToken();
    await this.db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))', [sha256(token), userId, rules.sessionDays]);
    await this.db.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userId]);
    return token;
  }

  async deleteSession(token: string | null) {
    if (token) await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  }
}
