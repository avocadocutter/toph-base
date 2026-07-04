import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from '../../config.js';
import type { DbPool } from '../../db/pool.js';
import { hashPassword } from '../auth/password.js';
import tophbasePlugin from './index.js';

const stubDb: DbPool = {
  query: async () => ({ rows: [], rowCount: 0 }),
  exec: async () => {},
  connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => {} }),
  end: async () => {},
};

function buildConfig(admin: Config['admin']): Config {
  return {
    project: {
      name: 'test',
      dataDir: '/tmp/test',
      jwtSecret: 'test-jwt-secret-that-is-long-enough-32chars!',
      publishableKey: 'vb_publishable_test',
      secretKey: 'vb_secret_test',
    },
    jwt: { accessTokenExpiry: 3600, refreshTokenExpiry: 86400 },
    server: { port: 8000, host: '127.0.0.1', logLevel: 'warn' },
    cors: { allowedOrigins: '*' },
    rateLimit: { auth: 10, api: 1000 },
    features: { requireAuthForApi: false },
    storage: { maxFileSizeBytes: 52_428_800 },
    functions: { dir: null },
    nodeFunctions: { dir: null },
    admin,
  };
}

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return header?.split(';')[0] ?? '';
}

describe('tophbase plugin — admin auth', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    fastify.decorate('db', stubDb);
    fastify.decorate('config', buildConfig({
      username: 'admin',
      passwordHash: await hashPassword('correct horse battery staple'),
      passwordPlain: null,
    }));
    (fastify as unknown as { _tophbaseDialect: unknown })._tophbaseDialect = 'supabase';
    await fastify.register(tophbasePlugin);
    await fastify.ready();
  });

  it('rejects /tophbase/status without a session cookie', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/tophbase/status' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects login with the wrong password and sets no cookie', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/tophbase/login',
      payload: { username: 'admin', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('logs in with correct credentials and unlocks /tophbase/status using the session cookie', async () => {
    const loginRes = await fastify.inject({
      method: 'POST',
      url: '/tophbase/login',
      payload: { username: 'admin', password: 'correct horse battery staple' },
    });
    expect(loginRes.statusCode).toBe(200);
    const cookie = extractCookie(loginRes.headers['set-cookie']);
    expect(cookie).toContain('tophbase_session=');

    const statusRes = await fastify.inject({
      method: 'GET',
      url: '/tophbase/status',
      headers: { cookie },
    });
    expect(statusRes.statusCode).toBe(200);
  });

  it('logout clears the cookie so a subsequent request is rejected again', async () => {
    const loginRes = await fastify.inject({
      method: 'POST',
      url: '/tophbase/login',
      payload: { username: 'admin', password: 'correct horse battery staple' },
    });
    const cookie = extractCookie(loginRes.headers['set-cookie']);

    const logoutRes = await fastify.inject({ method: 'POST', url: '/tophbase/logout', headers: { cookie } });
    const clearedCookie = extractCookie(logoutRes.headers['set-cookie']);

    const statusRes = await fastify.inject({
      method: 'GET',
      url: '/tophbase/status',
      headers: { cookie: clearedCookie },
    });
    expect(statusRes.statusCode).toBe(401);
  });

  it('accepts credentials from a plaintext env-var password (Railway-style)', async () => {
    const app = Fastify({ logger: false });
    app.decorate('db', stubDb);
    app.decorate('config', buildConfig({ username: 'admin', passwordHash: null, passwordPlain: 'railway-secret' }));
    await app.register(tophbasePlugin);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/tophbase/login',
      payload: { username: 'admin', password: 'railway-secret' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
