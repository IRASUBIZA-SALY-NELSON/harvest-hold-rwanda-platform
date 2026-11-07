import { Controller, Get, type MessageEvent, Query, Sse, UseGuards } from '@nestjs/common';
import { filter, interval, map, merge, type Observable } from 'rxjs';

import { Database } from '../../common/database.service.js';
import { EventsService } from '../events/events.service.js';
import { AdminGuard, AdminRoles, type AdminSession, CurrentAdmin, EVERYONE, roomScope } from './admin.guard.js';
import { InsightsService } from './insights.service.js';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminOverviewController {
  constructor(
    private db: Database,
    private insights: InsightsService,
    private events: EventsService
  ) {}

  @Get('overview')
  @AdminRoles(...EVERYONE)
  overview(@CurrentAdmin() admin: AdminSession) {
    return this.insights.overview(roomScope(admin));
  }

  @Get('analytics')
  analytics(@Query('days') days?: string) {
    const d = Number(days);
    return this.insights.analytics([7, 30, 90].includes(d) ? d : 30);
  }

  /**
   * Live events (Server-Sent Events): readings, alerts, incidents, orders and audit entries as
   * they happen, from every API instance. A heartbeat every 25 s keeps proxies from closing it.
   */
  @Sse('stream')
  @AdminRoles(...EVERYONE)
  stream(@CurrentAdmin() admin: AdminSession): Observable<MessageEvent> {
    const scope = roomScope(admin);
    // An operator hears only about their own rooms.
    const mine = (e: { roomId?: string; type: string }) => !scope || (!!e.roomId && scope.includes(e.roomId));
    return merge(
      this.events.events$.pipe(filter((e) => mine(e as any)), map((e) => ({ type: e.type, data: e }) as MessageEvent)),
      interval(25_000).pipe(map(() => ({ type: 'ping', data: { at: new Date().toISOString() } }) as MessageEvent))
    );
  }

  /** The portal's command palette (Ctrl+K): finds people, rooms, certificates, orders and listings. */
  @Get('search')
  async search(@Query('q') q = '') {
    const term = q.trim();
    if (term.length < 2) return { results: [] };
    const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
    const digits = term.replace(/\D/g, '');
    const [users, rooms, certificates, orders, listings] = await Promise.all([
      this.db.query(
        `SELECT id, name, role, phone, district FROM users
          WHERE name ILIKE $1 OR business_name ILIKE $1 OR id = $2 OR ($3 <> '' AND length($3) >= 4 AND phone LIKE '%' || $3 || '%') LIMIT 6`,
        [like, term, digits]
      ),
      this.db.query('SELECT id, name, district FROM cold_rooms WHERE name ILIKE $1 OR id ILIKE $1 OR district ILIKE $1 LIMIT 5', [like]),
      this.db.query("SELECT id, data->'farmer'->>'name' AS farmer, data->'batch'->>'crop' AS crop FROM certificates WHERE id ILIKE $1 LIMIT 5", [like]),
      this.db.query('SELECT id, crop, status FROM orders WHERE id ILIKE $1 LIMIT 5', [like]),
      this.db.query('SELECT l.id, l.crop, u.name AS farmer FROM listings l JOIN users u ON u.id = l.farmer_id WHERE l.id ILIKE $1 OR u.name ILIKE $1 LIMIT 5', [like]),
    ]);
    return {
      results: [
        ...users.map((u) => ({ type: 'user', id: u.id, title: u.name, subtitle: `${u.role} · ${u.district} · ${u.phone}` })),
        ...rooms.map((r) => ({ type: 'room', id: r.id, title: r.name, subtitle: `Cold room · ${r.district}` })),
        ...certificates.map((c) => ({ type: 'certificate', id: c.id, title: c.id, subtitle: `Certificate · ${c.crop} · ${c.farmer}` })),
        ...orders.map((o) => ({ type: 'order', id: o.id, title: o.id, subtitle: `Order · ${o.crop} · ${o.status}` })),
        ...listings.map((l) => ({ type: 'listing', id: l.id, title: `${l.crop} by ${l.farmer}`, subtitle: `Listing · ${l.id}` })),
      ],
    };
  }
}
