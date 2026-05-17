import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { buildConfig } from './config.js';
import { loadOrCreateProjectConfig } from './lib/project-config.js';
import type { Dialect } from './lib/project-config.js';
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
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { exec } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const projectName = process.env.TOPHBASE_PROJECT ?? 'default';
  const dataDir = process.env.TOPHBASE_DATA_DIR ?? path.join(os.homedir(), '.tophbase', 'projects', projectName);

  // Load or create project config (generates secrets on first run)
  await fs.mkdir(dataDir, { recursive: true });
  const projectConfig = await loadOrCreateProjectConfig(dataDir);
  const config = buildConfig(projectConfig, projectName);

  // PGLite needs its own subdirectory — the parent dataDir holds the JSON config file
  const pgliteDir = path.join(dataDir, 'data');
  await fs.mkdir(pgliteDir, { recursive: true });

  // Initialize PGLite storage — this may take 100-300ms on first run (WASM load)
  const store = new PGliteStore(pgliteDir);
  try {
    await store.init();
  } catch (err) {
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    if (major < 18) {
      console.error(`tophbase: requires Node.js 18+. You are running ${nodeVersion}.`);
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

  // Single-project mode: db IS the project database
  fastify.decorate('db', store);
  fastify.decorate('config', config);
  fastify.decorate('authenticate', authenticateProject);

  // Track dialect on the fastify instance for the tophbase status endpoint
  (fastify as unknown as { _tophbaseDialect: Dialect | null })._tophbaseDialect = projectConfig.dialect;

  // Global plugins
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

  // Global error handler
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

  // Application plugins
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

  // Serve dashboard static files.
  // Two layouts:
  //   repo dev:  apps/api/src/__dirname → ../../dashboard/dist = apps/dashboard/dist
  //   npm pkg:   apps/api/dist/__dirname → ../dashboard = bundled dashboard/
  const dashboardCandidates = [
    path.resolve(__dirname, '../dashboard'),          // npm package layout
    path.resolve(__dirname, '../../dashboard/dist'),  // repo layout
  ];
  const dashboardPath = (await Promise.all(
    dashboardCandidates.map(p => fs.access(p).then(() => p).catch(() => null))
  )).find(Boolean) ?? dashboardCandidates[1];
  try {
    await fs.access(dashboardPath);
    await fastify.register(fastifyStatic, {
      root: dashboardPath,
      prefix: '/',
      wildcard: false,
      decorateReply: true,
    });
    fastify.setNotFoundHandler((request, reply) => {
      const apiPrefixes = ['/rest/', '/auth/', '/realtime/', '/health', '/tophbase/'];
      if (apiPrefixes.some(p => request.url.startsWith(p))) {
        reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
      } else {
        reply.sendFile('index.html');
      }
    });
  } catch {
    fastify.log.debug('Dashboard not built — serving API only');
  }

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    fastify.log.info('Shutting down...');
    setTimeout(() => process.exit(1), 5000).unref();
    await fastify.close();
    await store.end();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await fastify.listen({ port: config.server.port, host: config.server.host });

  const url = `http://localhost:${config.server.port}`;
  console.log('');
  console.log(`  Tophbase running at ${url}`);
  console.log(`  Publishable key: ${config.project.publishableKey}`);
  console.log(`  Secret key:      ${config.project.secretKey}`);
  console.log('');

  // Open browser
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} ${url}`);
}

main().catch((err) => {
  console.error('tophbase: failed to start');
  console.error(err.message ?? err);
  process.exit(1);
});
