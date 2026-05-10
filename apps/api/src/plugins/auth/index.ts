import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { authenticatePlatform } from '../../hooks/authenticate.js';
import { authenticateProject } from '../../hooks/authenticate.js';
import { createProjectResolver } from '../../hooks/resolve-project.js';
import { BadRequestError } from '../../lib/errors.js';
import { platformSigninHandler, platformRefreshHandler, platformSignoutHandler, platformMeHandler } from './platform-handlers.js';
import { projectSignupHandler, projectSigninHandler, projectRefreshHandler, projectSignoutHandler, projectMeHandler } from './project-handlers.js';

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const resolveProject = createProjectResolver(fastify.db, fastify.projectPoolManager);

  // Strict rate limit for signup and password sign-in (prevent brute force).
  // Keyed by IP:email so each account has its own counter, not shared across all users on the IP.
  const strictAuthRateLimit = {
    config: {
      rateLimit: {
        max: fastify.config.rateLimit.auth,
        timeWindow: '15 minutes',
        keyGenerator: (request: FastifyRequest) => {
          const body = request.body as { email?: string } | undefined;
          return body?.email ? `${request.ip}:${body.email}` : request.ip;
        },
      },
    },
  };

  // Token route rate limit: password and refresh get separate counters via key prefix
  // so a burst of refreshes never exhausts the password-attempt budget.
  // Each key has its own independent counter; `max` applies per key independently.
  // - password:IP:email → config.rateLimit.auth per 15 min  (brute-force protection)
  // - refresh:IP        → config.rateLimit.auth per 15 min  (fine: ~1 refresh/hour normally)
  const tokenRateLimit = {
    config: {
      rateLimit: {
        max: fastify.config.rateLimit.auth,
        timeWindow: '15 minutes',
        keyGenerator: (request: FastifyRequest) => {
          const query = request.query as { grant_type?: string };
          const body = request.body as { email?: string } | undefined;
          if (query.grant_type === 'refresh_token') {
            return `refresh:${request.ip}`;
          }
          return `password:${request.ip}:${body?.email ?? ''}`;
        },
      },
    },
  };

  // ── Platform auth routes ──
  fastify.post('/platform/auth/signin', platformSigninHandler);
  fastify.post('/platform/auth/refresh', platformRefreshHandler);
  fastify.post('/platform/auth/signout', platformSignoutHandler);
  fastify.get('/platform/auth/me', {
    preHandler: [authenticatePlatform],
  }, platformMeHandler);

  // ── Supabase-compatible project auth routes ──

  // POST /auth/v1/signup — strict (prevent account spam)
  fastify.post('/auth/v1/signup', {
    ...strictAuthRateLimit,
    preHandler: [resolveProject],
  }, projectSignupHandler);

  // POST /auth/v1/token — password and refresh share the route but get separate rate-limit buckets
  fastify.post('/auth/v1/token', {
    ...tokenRateLimit,
    preHandler: [resolveProject],
  }, async (request, reply) => {
    const query = request.query as { grant_type?: string };

    if (query.grant_type === 'password') {
      return projectSigninHandler(request, reply);
    } else if (query.grant_type === 'refresh_token') {
      return projectRefreshHandler(request, reply);
    } else {
      throw new BadRequestError('Invalid grant_type. Must be "password" or "refresh_token"');
    }
  });

  // POST /auth/v1/logout — JWT-gated, uses global rate limit (no per-route override)
  fastify.post('/auth/v1/logout', {
    preHandler: [resolveProject, authenticateProject],
  }, projectSignoutHandler);

  // GET /auth/v1/user — JWT-gated read, uses global rate limit (no per-route override).
  // Called on every page load by the Supabase client; a per-route auth limit would block normal browsing.
  fastify.get('/auth/v1/user', {
    preHandler: [resolveProject, authenticateProject],
  }, projectMeHandler);
};

export default authPlugin;
