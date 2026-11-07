import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type pg from 'pg';

// migrations/ sits next to src/ and dist/.
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/** Applies every migrations/*.sql file that has not run yet, in name order. */
export async function migrate(pool: pg.Pool, log: (s: string) => void = console.log) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  // One process at a time (several API instances may start together).
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(72018331)');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`migrated ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(72018331)');
    client.release();
  }
}
