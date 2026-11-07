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

/** Batch codes like HHB-7KQ4-M2XD: printed on the label and in the QR code. */
export function batchCode(): string {
  const bytes = crypto.randomBytes(8);
  const chars = Array.from(bytes, (b) => BASE32[b % BASE32.length]).join('');
  return `HHB-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** Cold room ids: HHR-001, HHR-002, ... (1000 and above keep growing: HHR-1000). */
export const roomCode = (n: number) => `HHR-${String(n).padStart(3, '0')}`;
