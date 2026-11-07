import { migrate } from '../common/migrate.js';
import pg from 'pg';

import { config } from '../config.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
await migrate(pool);
await pool.end();
