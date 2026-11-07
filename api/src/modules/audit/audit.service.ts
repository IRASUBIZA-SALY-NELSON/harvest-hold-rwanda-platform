import { Global, Injectable, Module } from '@nestjs/common';

import { canonicalJson } from '../../common/canonical-json.js';
import { Database } from '../../common/database.service.js';
import { sha256 } from '../../common/ids.js';
import { EventsService } from '../events/events.service.js';

export interface Actor {
  type: 'admin' | 'user' | 'device' | 'system';
  id?: string | null;
  name?: string | null;
  ip?: string | null;
}

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
}

const GENESIS = '0'.repeat(64);
export const SYSTEM: Actor = { type: 'system', name: 'Harvest Hold' };

/** What each entry's hash covers. Changing any of it, or removing an entry, breaks the chain. */
function hashOf(prevHash: string, row: any) {
  return sha256(
    prevHash +
      canonicalJson({
        at: new Date(row.at).toISOString(),
        actorType: row.actor_type,
        actorId: row.actor_id,
        actorName: row.actor_name,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        summary: row.summary,
        before: row.before,
        after: row.after,
        ip: row.ip,
      })
  );
}

/** Append-only, hash-chained audit trail of everything that changes the system. */
@Injectable()
export class AuditService {
  constructor(
    private db: Database,
    private events: EventsService
  ) {}

  async record(actor: Actor, e: AuditEntry) {
    const row = await this.db.tx(async (c) => {
      // One writer at a time keeps the chain in a single line.
      await c.query('SELECT pg_advisory_xact_lock(72018332)');
      const prev = (await this.db.one<{ hash: string }>('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1', [], c))?.hash ?? GENESIS;
      const values = {
        at: new Date(),
        actor_type: actor.type,
        actor_id: actor.id ?? null,
        actor_name: actor.name ?? null,
        action: e.action,
        entity_type: e.entityType ?? null,
        entity_id: e.entityId ?? null,
        summary: e.summary,
        // Stored as jsonb, which drops undefined: normalise first so the hash matches what is read back.
        before: e.before === undefined ? null : JSON.parse(JSON.stringify(e.before)),
        after: e.after === undefined ? null : JSON.parse(JSON.stringify(e.after)),
        ip: actor.ip ?? null,
      };
      const hash = hashOf(prev, values);
      return this.db.one<{ id: number }>(
        `INSERT INTO audit_log (at, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, before, after, ip, prev_hash, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [values.at, values.actor_type, values.actor_id, values.actor_name, values.action, values.entity_type, values.entity_id, values.summary, values.before, values.after, values.ip, prev, hash],
        c
      );
    });
    this.events.publish({ type: 'audit', id: row!.id, action: e.action, actor: actor.name ?? actor.type, summary: e.summary });
    return row!.id;
  }

  /** Walks the whole chain. Reports the first entry that does not match (edited, deleted or inserted). */
  async verifyChain(): Promise<{ ok: boolean; checked: number; brokenAt: number | null; lastHash: string }> {
    let prev = GENESIS;
    let checked = 0;
    let lastId = 0;
    for (;;) {
      const rows = await this.db.query('SELECT * FROM audit_log WHERE id > $1 ORDER BY id LIMIT 2000', [lastId]);
      if (!rows.length) break;
      for (const row of rows) {
        if (row.prev_hash !== prev || hashOf(prev, row) !== row.hash) return { ok: false, checked, brokenAt: row.id, lastHash: prev };
        prev = row.hash;
        lastId = row.id;
        checked++;
      }
    }
    return { ok: true, checked, brokenAt: null, lastHash: prev };
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
