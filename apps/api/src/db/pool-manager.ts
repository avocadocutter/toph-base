import pg from 'pg';
import type { Config } from '../config.js';

const { Pool } = pg;

interface PoolEntry {
  pool: pg.Pool;
  lastAccessed: number;
}

export class ProjectPoolManager {
  private pools = new Map<string, PoolEntry>();
  private platformPool: pg.Pool;
  private platformConfig: Config['postgres'];
  private maxPools: number;
  private idleEvictionMs: number;
  private projectPoolSize: number;
  private evictionTimer: ReturnType<typeof setInterval>;

  constructor(
    platformConfig: Config['postgres'],
    options?: { maxPools?: number; idleEvictionMs?: number; projectPoolSize?: number },
  ) {
    this.platformConfig = platformConfig;
    this.maxPools = options?.maxPools ?? 50;
    this.idleEvictionMs = options?.idleEvictionMs ?? 300_000; // 5 minutes
    this.projectPoolSize = options?.projectPoolSize ?? 5;

    this.platformPool = new Pool({
      host: platformConfig.host,
      port: platformConfig.port,
      database: platformConfig.database,
      user: platformConfig.user,
      password: platformConfig.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.evictionTimer = setInterval(() => this.evictIdlePools(), 60_000);
  }

  getPlatformPool(): pg.Pool {
    return this.platformPool;
  }

  getProjectPool(dbName: string): pg.Pool {
    const entry = this.pools.get(dbName);
    if (entry) {
      entry.lastAccessed = Date.now();
      return entry.pool;
    }

    // Evict LRU if at capacity
    if (this.pools.size >= this.maxPools) {
      this.evictLru();
    }

    const pool = new Pool({
      host: this.platformConfig.host,
      port: this.platformConfig.port,
      database: dbName,
      user: this.platformConfig.user,
      password: this.platformConfig.password,
      max: this.projectPoolSize,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pools.set(dbName, { pool, lastAccessed: Date.now() });
    return pool;
  }

  async closeProjectPool(dbName: string): Promise<void> {
    const entry = this.pools.get(dbName);
    if (entry) {
      this.pools.delete(dbName);
      await entry.pool.end();
    }
  }

  async shutdown(): Promise<void> {
    clearInterval(this.evictionTimer);
    const closes: Promise<void>[] = [];
    for (const [, entry] of this.pools) {
      closes.push(entry.pool.end());
    }
    closes.push(this.platformPool.end());
    await Promise.all(closes);
    this.pools.clear();
  }

  private evictIdlePools(): void {
    const now = Date.now();
    for (const [dbName, entry] of this.pools) {
      if (now - entry.lastAccessed > this.idleEvictionMs) {
        this.pools.delete(dbName);
        entry.pool.end().catch(() => {});
      }
    }
  }

  private evictLru(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [dbName, entry] of this.pools) {
      if (entry.lastAccessed < oldestTime) {
        oldest = dbName;
        oldestTime = entry.lastAccessed;
      }
    }
    if (oldest) {
      const entry = this.pools.get(oldest);
      this.pools.delete(oldest);
      entry?.pool.end().catch(() => {});
    }
  }
}
