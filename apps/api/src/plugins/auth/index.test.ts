import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from '../../config.js';
import type { DbPool } from '../../db/pool.js';
import type { ProjectPoolManager } from '../../db/pool-manager.js';
import authPlugin from './index.js';

const stubConfig = {
  rateLimit: { auth: 10, global: 100 },
  jwt: {
    platformSecret: 'test-platform-secret-that-is-long-enough-32chars',
    accessTokenExpiry: 3600,
    refreshTokenExpiry: 86400,
  },
} as unknown as Config;

// Returns no rows — resolveProject will throw NotFoundError (404)
const stubDb = {
  query: async () => ({ rows: [], rowCount: 0 }),
} as unknown as DbPool;

const stubPoolManager = {
  getProjectPool: () => stubDb,
} as unknown as ProjectPoolManager;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('db', stubDb);
  app.decorate('config', stubConfig);
  app.decorate('projectPoolManager', stubPoolManager);
  await app.register(authPlugin);
  await app.ready();
  return app;
}

describe('POST /auth/v1/logout body parsing', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts Content-Type: application/json with no body', async () => {
    // Replicates @supabase/auth-js signOut() — sends Content-Type: application/json but
    // no body (JSON.stringify(undefined) === undefined). Without the custom parser this
    // would return 400; anything else means body parsing succeeded.
    const response = await app.inject({
      method: 'POST',
      url: '/auth/v1/logout',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).not.toBe(400);
    expect(response.statusCode).not.toBe(500);
  });

  it('accepts Content-Type: application/json with an empty JSON object body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/v1/logout',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).not.toBe(400);
    expect(response.statusCode).not.toBe(500);
  });

  it('rejects malformed JSON', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/v1/logout',
      headers: { 'content-type': 'application/json' },
      payload: '{invalid',
    });

    expect(response.statusCode).toBe(400);
  });
});
