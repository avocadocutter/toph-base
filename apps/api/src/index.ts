import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { ProjectPoolManager } from './db/pool-manager.js';
import { initPlatformJwt } from './plugins/auth/jwt.js';
import { authenticatePlatform } from './hooks/authenticate.js';
import { hashPassword } from './plugins/auth/password.js';
import { AppError } from './lib/errors.js';
import authPlugin from './plugins/auth/index.js';
import introspectionPlugin from './plugins/introspection/index.js';
import restApiPlugin from './plugins/rest-api/index.js';
import rlsPlugin from './plugins/rls/index.js';
import adminPlugin from './plugins/admin/index.js';
import projectsPlugin from './plugins/projects/index.js';
import apiKeysPlugin from './plugins/api-keys/index.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const config = loadConfig();

  // Log database credentials for debugging
  console.log('Database credentials:');
  console.log('  Host:', config.postgres.host);
  console.log('  Port:', config.postgres.port);
  console.log('  Database:', config.postgres.database);
  console.log('  User:', config.postgres.user);
  console.log('  Password:', config.postgres.password);

  const fastify = Fastify({
    logger: {
      level: config.server.logLevel,
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // Create pool manager (platform + per-project pools)
  const poolManager = new ProjectPoolManager(config.postgres, {
    maxPools: config.poolManager.maxPools,
    idleEvictionMs: config.poolManager.idleEvictionMs,
    projectPoolSize: config.poolManager.projectPoolSize,
  });
  const db = poolManager.getPlatformPool();

  // Decorate fastify with shared instances
  fastify.decorate('db', db);
  fastify.decorate('config', config);
  fastify.decorate('authenticate', authenticatePlatform);
  fastify.decorate('projectPoolManager', poolManager);

  // Initialize platform JWT
  initPlatformJwt(config);

  // Register global plugins
  await fastify.register(cors, {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) {
        callback(null, true);
        return;
      }

      fastify.log.debug({ origin }, 'CORS origin check');

      const allowedOrigins = config.cors.allowedOrigins.split(',').map(s => s.trim());

      // Check if origin is in the allowed list
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // Allow subdomain-based project URLs and all localhost origins in development
      try {
        const originUrl = new URL(origin);

        // In development, allow all localhost origins regardless of port
        if (originUrl.hostname === 'localhost' || originUrl.hostname.endsWith('.localhost')) {
          callback(null, true);
          return;
        }

        // In production, be more restrictive with the host check
        const serverHost = config.server.host === '0.0.0.0' ? 'localhost' : config.server.host;
        if (
          originUrl.hostname === serverHost &&
          originUrl.port === config.server.port.toString()
        ) {
          callback(null, true);
          return;
        }
      } catch (err) {
        fastify.log.warn({ origin, err }, 'Invalid origin URL');
        callback(new Error('Not allowed by CORS'), false);
        return;
      }

      // Reject all other origins
      fastify.log.warn({ origin }, 'Origin not allowed by CORS');
      callback(new Error('Not allowed by CORS'), false);
    },
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

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

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

    // Zod validation errors
    if (error.name === 'ZodError') {
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: (error as unknown as { issues: unknown[] }).issues,
        },
      });
      return;
    }

    // @fastify/rate-limit errors
    const fastifyError = error as Error & { statusCode?: number };
    if (fastifyError.statusCode === 429) {
      reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: error.message,
        },
      });
      return;
    }

    request.log.error(error);
    reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
      },
    });
  });

  // Register application plugins
  await fastify.register(introspectionPlugin);
  await fastify.register(authPlugin);
  await fastify.register(projectsPlugin);
  await fastify.register(apiKeysPlugin);
  await fastify.register(restApiPlugin);
  await fastify.register(rlsPlugin);
  await fastify.register(adminPlugin);

  // Serve dashboard static files if they exist
  const dashboardPath = path.resolve(__dirname, '../../dashboard/dist');
  try {
    await fastify.register(fastifyStatic, {
      root: dashboardPath,
      prefix: '/',
      wildcard: false,
      decorateReply: true,
    });

    // SPA fallback — serve index.html for unknown routes
    fastify.setNotFoundHandler((request, reply) => {
      if (
        request.url.startsWith('/platform/') ||
        request.url.startsWith('/project/') ||
        request.url.startsWith('/rest/') ||
        request.url.startsWith('/auth/') ||
        request.url.startsWith('/health')
      ) {
        reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
      } else {
        reply.sendFile('index.html');
      }
    });
  } catch {
    fastify.log.info('Dashboard static files not found, serving API only');
  }

  // Bootstrap admin user
  await bootstrapAdmin(db, config);

  // Graceful shutdown handlers
  const shutdown = async () => {
    fastify.log.info('Shutting down gracefully...');
    setTimeout(() => {
      fastify.log.warn('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 5000).unref();
    await poolManager.shutdown();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start server
  await fastify.listen({ port: config.server.port, host: config.server.host });
  fastify.log.info(`toph-base gateway running on http://${config.server.host}:${config.server.port}`);
}

async function bootstrapAdmin(db: import('./db/pool.js').DbPool, config: ReturnType<typeof loadConfig>) {
  try {
    const existing = await db.query(
      'SELECT id FROM toph_internal.platform_users WHERE email = $1',
      [config.admin.email],
    );

    if (existing.rows.length === 0) {
      const passwordHash = await hashPassword(config.admin.password);
      await db.query(
        `INSERT INTO toph_internal.platform_users (email, password_hash, role, email_confirmed)
         VALUES ($1, $2, 'admin', true)`,
        [config.admin.email, passwordHash],
      );
      console.log(`Admin user created: ${config.admin.email}`);
    }
  } catch (err) {
    console.error('Failed to bootstrap admin user:', err);
  }
}

main().catch((err) => {
  console.error('Failed to start toph-base:', err);
  process.exit(1);
});
