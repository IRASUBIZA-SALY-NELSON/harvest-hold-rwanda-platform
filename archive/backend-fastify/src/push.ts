import { query } from './db.js';

/** Expo push notifications. Works for app builds made with EAS (not inside Expo Go). */
export async function sendPush(userId: string, title: string, body: string, data: Record<string, unknown> = {}) {
  const tokens = await query<{ token: string }>('SELECT token FROM push_tokens WHERE user_id = $1', [userId]);
  if (!tokens.length) return;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map((t) => ({ to: t.token, title, body, data, sound: 'default' }))),
      signal: AbortSignal.timeout(10_000),
    });
    const json: any = await res.json().catch(() => ({}));
    // Forget tokens of uninstalled apps.
    const tickets: any[] = Array.isArray(json?.data) ? json.data : [];
    for (let i = 0; i < tickets.length; i++) {
      if (tickets[i]?.details?.error === 'DeviceNotRegistered') {
        await query('DELETE FROM push_tokens WHERE token = $1', [tokens[i].token]);
      }
    }
  } catch (e) {
    console.warn('push failed', e);
  }
}
