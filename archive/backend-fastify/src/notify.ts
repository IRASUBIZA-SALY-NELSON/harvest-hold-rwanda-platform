import type { Db } from './db.js';
import { pool, query } from './db.js';
import { newId } from './ids.js';
import { message, type Lang } from './messages.js';
import { sendPush } from './push.js';
import { sms } from './sms.js';

/** Room problems serious enough to also send an SMS. */
const SMS_TYPES = new Set(['chamberWarm', 'chamberCold', 'offline', 'coolerOverheat', 'coolerFault']);

export type Params = Record<string, string | number>;

/**
 * Records an in-app alert for a user, then sends push (and SMS for serious room problems)
 * in the background. Pass `db` to write the alert inside a transaction.
 */
export async function notify(userId: string, type: string, params: Params, link?: string, db: Db = pool) {
  await query('INSERT INTO alerts (id, user_id, type, params, link) VALUES ($1, $2, $3, $4, $5)', [newId('a'), userId, type, params, link ?? null], db);
  void deliver(userId, type, params, link);
}

async function deliver(userId: string, type: string, params: Params, link?: string) {
  try {
    const [user] = await query<{ phone: string; lang: Lang }>('SELECT phone, lang FROM users WHERE id = $1', [userId]);
    if (!user) return;
    const text = message(user.lang, type, params);
    await sendPush(userId, 'Harvest Hold', text, { link });
    if (SMS_TYPES.has(type)) await sms.send(user.phone, `Harvest Hold: ${text}`);
  } catch (e) {
    console.warn('notification delivery failed', e);
  }
}

/** Notifies every farmer who uses this cold room. */
export async function notifyRoom(roomId: string, type: string, params: Params) {
  const farmers = await query<{ id: string }>("SELECT id FROM users WHERE role = 'farmer' AND cold_room_id = $1", [roomId]);
  for (const f of farmers) await notify(f.id, type, params);
}
