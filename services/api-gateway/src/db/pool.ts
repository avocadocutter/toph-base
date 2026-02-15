import pg from 'pg';
import type { Config } from '../config.js';

const { Pool } = pg;

export function createPool(config: Config['postgres']): pg.Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient;
