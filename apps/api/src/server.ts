import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
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
import localAdminPlugin from './plugins/local-admin/index.js';
import storagePlugin from './plugins/storage/index.js';
import edgeFunctionsPlugin from './plugins/edge-functions/index.js';
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

  await fastify.register(multipart, { limits: { fileSize: config.storage.maxFileSizeBytes } });

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
      'x-upsert',
      'x-metadata',
      'cache-control',
    ],
    exposedHeaders: ['Content-Range', 'X-Total-Count', 'Content-Profile', 'ETag'],
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

  const storageDir = path.join(dataDir, 'storage');
  await fs.mkdir(storageDir, { recursive: true });

  await fastify.register(tophbasePlugin);
  await fastify.register(localAdminPlugin);
  await fastify.register(storagePlugin, { storageDir, prefix: '/storage/v1' });
  await fastify.register(realtimePlugin);
  await fastify.register(introspectionPlugin);
  await fastify.register(authPlugin);
  await fastify.register(restApiPlugin, {
    resolveFromApikey: resolveLocalProject,
    resolveProject: resolveLocalProject,
    authHook: config.features.requireAuthForApi ? authenticateProject : authenticateProjectOptional,
  });
  await fastify.register(rlsPlugin);

  if (config.functions.dir) {
    await fastify.register(edgeFunctionsPlugin, {
      functionsDir: config.functions.dir,
      supabaseUrl: `http://${config.server.host}:${config.server.port}`,
      publishableKey: config.project.publishableKey,
      secretKey: config.project.secretKey,
    });
  }

  startCronBridge(store);

  return { fastify, config, store };
}

function matchCronField(field: string, value: number): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) return value % parseInt(field.slice(2), 10) === 0;
  if (field.includes(',')) return field.split(',').some(v => parseInt(v, 10) === value);
  if (field.includes('-')) {
    const [a, b] = field.split('-').map(Number);
    return value >= a && value <= b;
  }
  return parseInt(field, 10) === value;
}

function cronMatches(schedule: string, now: Date): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, month, dow] = parts;
  return (
    matchCronField(min,   now.getMinutes()) &&
    matchCronField(hour,  now.getHours()) &&
    matchCronField(dom,   now.getDate()) &&
    matchCronField(month, now.getMonth() + 1) &&
    matchCronField(dow,   now.getDay())
  );
}

function startCronBridge(store: PGliteStore): void {
  setInterval(async () => {
    const now = new Date();
    let jobs: { jobid: number; schedule: string; command: string }[] = [];
    try {
      const result = await store.query<{ jobid: number; schedule: string; command: string }>(
        `SELECT jobid, schedule, command FROM cron.job WHERE active = true`,
      );
      jobs = result.rows;
    } catch {
      return; // cron schema not yet bootstrapped
    }

    for (const job of jobs) {
      if (!cronMatches(job.schedule, now)) continue;
      const start = new Date();
      let status = 'succeeded';
      let message = '';
      try {
        await store.exec(job.command);
      } catch (err) {
        status = 'failed';
        message = (err as Error).message;
      }
      await store.query(
        `INSERT INTO cron.job_run_details (jobid, command, status, return_message, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [job.jobid, job.command, status, message, start],
      ).catch(() => {});
    }
  }, 60_000).unref();
}
