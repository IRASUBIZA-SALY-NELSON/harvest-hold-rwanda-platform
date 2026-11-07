import crypto from 'node:crypto';

export const newId = (prefix: string) => `${prefix}-${crypto.randomBytes(6).toString('hex')}`;

const BASE32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1: easy to read aloud

/** Certificate numbers like HHR-7KQ4-M2XD. Random, so they cannot be guessed from another one. */
export function certificateId(): string {
  const bytes = crypto.randomBytes(8);
  const chars = Array.from(bytes, (b) => BASE32[b % BASE32.length]).join('');
  return `HHR-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export const randomToken = () => crypto.randomBytes(32).toString('base64url');
