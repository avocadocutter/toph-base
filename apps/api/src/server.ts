import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { buildConfig, type Config } from './config.js';
import { loadOrCreateProjectConfig, type Dialect } from './lib/project-config.js';
import { PGliteStore } from './db/pglite-store.js';
import { runBootstrapMigrations } from './db/migrations.js';
import { authenticateProject, authenticateProjectOptional } from './hooks/authenticate.js';
import { resolveLocalProject } from './hooks/resolve-project.js';
import { AppError } from './lib/errors.js';
import authPlugin from './plugins/auth/index.js';
import introspectionPlugin from './plugins/introspection/index.js';
import restApiPlugin from './plugins/rest-api/index.js';
import rlsPlugin from './plugins/rls/index.js';
import realtimePlugin from './plugins/realtime/index.js';
import tophbasePlugin from './plugins/tophbase/index.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface ServerContext {
  fastify: FastifyInstance;
  config: Config;
  store: PGliteStore;
}

export async function createServer(): Promise<ServerContext> {
  const projectName = process.env.TOPHBASE_PROJECT ?? 'default';
  const dataDir = process.env.TOPHBASE_DATA_DIR ?? path.join(os.homedir(), '.tophbase', 'projects', projectName);

  await fs.mkdir(dataDir, { recursive: true });
  const projectConfig = await loadOrCreateProjectConfig(dataDir);
  const config = buildConfig(projectConfig, projectName);

  const pgliteDir = path.join(dataDir, 'data');
  await fs.mkdir(pgliteDir, { recursive: true });

  const store = new PGliteStore(pgliteDir);
  try {
    await store.init();
  } catch (err) {
    const major = parseInt(process.version.slice(1).split('.')[0], 10);
    if (major < 18) {
      console.error(`tophbase: requires Node.js 18+. You are running ${process.version}.`);
      console.error(`Fix: nvm install 18 && nvm use 18`);
    } else {
      console.error(`tophbase: failed to initialize storage at ${config.project.dataDir}`);
      console.error(`Error: ${(err as Error).message}`);
      console.error(`Check that ${config.project.dataDir} is writable.`);
    }
    process.exit(1);
  }

  await runBootstrapMigrations(store);

  const fastify = Fastify({
    logger: {
      level: config.server.logLevel,
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  fastify.decorate('db', store);
  fastify.decorate('config', config);
  fastify.decorate('authenticate', authenticateProject);

  (fastify as unknown as { _tophbaseDialect: Dialect | null })._tophbaseDialect = projectConfig.dialect;

  await fastify.register(cors, {
    origin: config.cors.allowedOrigins === '*' ? true : config.cors.allowedOrigins.split(',').map(s => s.trim()),
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Prefer',
      'apikey',
      'X-Client-Info',
      'x-supabase-api-version',
      'Accept-Profile',
      'Content-Profile',
      'Range',
    ],
    exposedHeaders: ['Content-Range', 'X-Total-Count', 'Content-Profile'],
  });

  await fastify.register(helmet, { contentSecurityPolicy: false });

  await fastify.register(rateLimit, {
    max: config.rateLimit.api,
    timeWindow: '1 minute',
  });

  fastify.setErrorHandler((error: Error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(error.toJSON());
      return;
    }
    if (error.name === 'ZodError') {
      reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: (error as unknown as { issues: unknown[] }).issues } });
      return;
    }
    const fe = error as Error & { statusCode?: number };
    if (fe.statusCode === 429) {
      reply.status(429).send({ error: { code: 'RATE_LIMITED', message: error.message } });
      return;
    }
    request.log.error(error);
    reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message } });
  });

  fastify.get('/health', async () => {
    let dbVersion = 'unknown';
    try {
      const result = await store.query<{ version: string }>('SELECT version()');
      dbVersion = result.rows[0]?.version ?? 'unknown';
    } catch { /* ignore */ }
    return { ok: true, version: dbVersion };
  });

  await fastify.register(tophbasePlugin);
  await fastify.register(realtimePlugin);
  await fastify.register(introspectionPlugin);
  await fastify.register(authPlugin);
  await fastify.register(restApiPlugin, {
    resolveFromApikey: resolveLocalProject,
    resolveProject: resolveLocalProject,
    authHook: config.features.requireAuthForApi ? authenticateProject : authenticateProjectOptional,
  });
  await fastify.register(rlsPlugin);

  return { fastify, config, store };
}
