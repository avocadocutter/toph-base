import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from '../../config.js';
import type { DbPool } from '../../db/pool.js';
import authPlugin from './index.js';

const ANON_KEY = 'vb_publishable_test_key_abc123';

const stubConfig: Config = {
  project: {
    name: 'test',
    dataDir: '/tmp/test',
    jwtSecret: 'test-jwt-secret-that-is-long-enough-32chars!',
    publishableKey: ANON_KEY,
    secretKey: 'vb_secret_test_key_xyz789',
  },
  jwt: { accessTokenExpiry: 3600, refreshTokenExpiry: 86400 },
  server: { port: 8000, host: '127.0.0.1', logLevel: 'warn' },
  cors: { allowedOrigins: '*' },
  rateLimit: { auth: 10, api: 1000 },
  features: { requireAuthForApi: false },
  storage: { maxFileSizeBytes: 52_428_800 },
  functions: { dir: null, invokeTimeoutMs: 30_000 },
  nodeFunctions: { dir: null, invokeTimeoutMs: 30_000 },
  jobs: { maxAttempts: 5 },
  admin: { username: 'admin', passwordHash: null, passwordPlain: null },
};

const stubDb: DbPool = {
  query: async () => ({ rows: [], rowCount: 0 }),
  exec: async () => {},
  connect: async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  }),
  end: async () => {},
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('db', stubDb);
  app.decorate('config', stubConfig);
  app.decorate('authenticate', async () => {});
  await app.register(authPlugin);
  await app.ready();
  return app;
}

describe('POST /auth/v1/logout body parsing', () => {
  let app: FastifyInstance;

  beforeEach(async () => { app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('accepts Content-Type: application/json with no body', async () => {
    // Supabase JS signOut() sends Content-Type: application/json with no body.
    // The custom parser must handle this without a 400 or 500.
    const response = await app.inject({
      method: 'POST',
      url: '/auth/v1/logout',
      headers: {
        'content-type': 'application/json',
        'apikey': ANON_KEY,
      },
    });
    expect(response.statusCode).not.toBe(400);
    expect(response.statusCode).not.toBe(500);
  });

  it('accepts Content-Type: application/json with an empty JSON object body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/v1/logout',
      headers: {
        'content-type': 'application/json',
        'apikey': ANON_KEY,
      },
      payload: '{}',
    });
    expect(response.statusCode).not.toBe(400);
    expect(response.statusCode).not.toBe(500);
  });

  it('rejects malformed JSON', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/v1/logout',
      headers: {
        'content-type': 'application/json',
        'apikey': ANON_KEY,
      },
      payload: '{invalid',
    });
    expect(response.statusCode).toBe(400);
  });
});
