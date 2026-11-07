import { Global, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';

import { config } from '../config.js';

// Return BIGINT/COUNT as numbers (our counts are small).
pg.types.setTypeParser(20, (v) => Number(v));
// DATE as 'YYYY-MM-DD' (harvest dates are calendar days, not moments).
pg.types.setTypeParser(1082, (v) => v);
// NUMERIC as numbers (used by analytics aggregates).
pg.types.setTypeParser(1700, (v) => Number(v));

export type Queryable = Pick<pg.PoolClient, 'query'>;

/** PostgreSQL access. Plain SQL: the queries are the documentation of what the API does. */
@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new pg.Pool({ connectionString: config.databaseUrl, max: 15 });

  async query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Queryable = this.pool): Promise<T[]> {
    return (await db.query<T>(text, params)).rows;
  }

  async one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Queryable = this.pool): Promise<T | undefined> {
    return (await db.query<T>(text, params)).rows[0];
  }

  /** Runs fn inside a transaction. */
  async tx<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
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

  async onModuleDestroy() {
    await this.pool.end();
  }
}

@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
