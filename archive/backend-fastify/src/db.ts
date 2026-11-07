import pg from 'pg';

import { config } from './config.js';

// Return BIGINT/COUNT as numbers (our counts are small).
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Db = Pick<pg.PoolClient, 'query'>;

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool) {
  return (await db.query<T>(text, params)).rows;
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool) {
  return (await db.query<T>(text, params)).rows[0] as T | undefined;
}

/** Runs fn inside a transaction. */
export async function tx<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
