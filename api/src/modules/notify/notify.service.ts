import { Global, Injectable, Logger, Module } from '@nestjs/common';

import { Database, type Queryable } from '../../common/database.service.js';
import { newId } from '../../common/ids.js';
import { message, type Lang } from '../../domain/messages.js';
import { EventsService } from '../events/events.service.js';
import { SmsService } from './sms.service.js';

/** Room problems serious enough to also send an SMS. */
const SMS_TYPES = new Set(['chamberWarm', 'chamberCold', 'offline', 'coolerOverheat', 'coolerFault']);

export type Params = Record<string, string | number>;

@Injectable()
export class NotifyService {
  private readonly log = new Logger('Notify');

  constructor(
    private db: Database,
    private sms: SmsService,
    private events: EventsService
  ) {}

  /**
   * Records an in-app alert for a user, then sends push (and SMS for serious room problems)
   * in the background. Call it after the transaction that caused it has committed.
   */
  async notify(userId: string, type: string, params: Params, link?: string, roomId?: string, db: Queryable = this.db.pool) {
    await this.db.query('INSERT INTO alerts (id, user_id, type, params, link) VALUES ($1, $2, $3, $4, $5)', [newId('a'), userId, type, params, link ?? null], db);
    this.events.publish({ type: 'alert', userId, roomId, alertType: type, params });
    void this.deliver(userId, type, params, link);
  }

  /** Notifies every farmer who uses this cold room. */
  async notifyRoom(roomId: string, type: string, params: Params) {
    const farmers = await this.db.query<{ id: string }>("SELECT id FROM users WHERE role = 'farmer' AND cold_room_id = $1", [roomId]);
    for (const f of farmers) await this.notify(f.id, type, params, undefined, roomId);
  }

  private async deliver(userId: string, type: string, params: Params, link?: string) {
    try {
      const user = await this.db.one<{ phone: string; lang: Lang }>('SELECT phone, lang FROM users WHERE id = $1', [userId]);
      if (!user) return;
      const text = message(user.lang, type, params);
      await this.push(userId, 'Harvest Hold', text, { link });
      if (SMS_TYPES.has(type)) await this.sms.send(user.phone, `Harvest Hold: ${text}`);
    } catch (e) {
      this.log.warn(`notification delivery failed: ${(e as Error).message}`);
    }
  }

  /** Expo push notifications. Works for app builds made with EAS (not inside Expo Go). */
  async push(userId: string, title: string, body: string, data: Record<string, unknown> = {}) {
    const tokens = await this.db.query<{ token: string }>('SELECT token FROM push_tokens WHERE user_id = $1', [userId]);
    if (!tokens.length) return;
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(tokens.map((t) => ({ to: t.token, title, body, data, sound: 'default' }))),
        signal: AbortSignal.timeout(10_000),
      });
      const json: any = await res.json().catch(() => ({}));
      const tickets: any[] = Array.isArray(json?.data) ? json.data : [];
      for (let i = 0; i < tickets.length; i++) {
        if (tickets[i]?.details?.error === 'DeviceNotRegistered') await this.db.query('DELETE FROM push_tokens WHERE token = $1', [tokens[i].token]);
      }
    } catch (e) {
      this.log.warn(`push failed: ${(e as Error).message}`);
    }
  }
}

@Global()
@Module({ providers: [SmsService, NotifyService], exports: [SmsService, NotifyService] })
export class NotifyModule {}
