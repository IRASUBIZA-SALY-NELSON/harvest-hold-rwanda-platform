import { Global, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import { Subject } from 'rxjs';

import { Database } from '../../common/database.service.js';
import { config } from '../../config.js';

export type LiveEvent =
  | { type: 'reading'; roomId: string; reading: Record<string, unknown> }
  | { type: 'alert'; roomId?: string; userId: string; alertType: string; params: Record<string, unknown> }
  | { type: 'incident'; roomId: string; incidentType: string; state: 'open' | 'closed' }
  | { type: 'command'; roomId: string; commandId: number; status: string }
  | { type: 'order'; orderId: string; status: string }
  | { type: 'audit'; id: number; action: string; actor: string; summary: string };

const CHANNEL = 'hh_events';

/**
 * Live events for the admin portal. Published through PostgreSQL NOTIFY, so every API instance
 * (and every connected admin) receives them, not only the instance that handled the request.
 */
@Injectable()
export class EventsService implements OnModuleInit, OnModuleDestroy {
  readonly events$ = new Subject<LiveEvent>();
  private listener: pg.Client | null = null;
  private stopped = false;
  private readonly log = new Logger('Events');

  constructor(private db: Database) {}

  async onModuleInit() {
    await this.listen();
  }

  private async listen() {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: config.databaseUrl });
    client.on('notification', (msg) => {
      try {
        this.events$.next(JSON.parse(msg.payload ?? '{}'));
      } catch {
        /* ignore malformed */
      }
    });
    client.on('error', () => {
      this.listener = null;
      client.end().catch(() => {});
      if (!this.stopped) setTimeout(() => void this.listen(), 3000);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.listener = client;
    } catch (e) {
      this.log.warn(`live events unavailable, retrying: ${(e as Error).message}`);
      setTimeout(() => void this.listen(), 3000);
    }
  }

  /** Never throws: live updates must not break the request that caused them. */
  publish(event: LiveEvent) {
    const payload = JSON.stringify(event);
    if (payload.length > 7900) return; // NOTIFY payload limit is 8000 bytes
    this.db.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]).catch(() => {});
  }

  async onModuleDestroy() {
    this.stopped = true;
    await this.listener?.end().catch(() => {});
    this.events$.complete();
  }
}

@Global()
@Module({ providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
