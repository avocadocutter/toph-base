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

  // Strict rate limit for signup/signin (prevent brute force)
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

  // Moderate rate limit for token refresh and authenticated endpoints
  const moderateAuthRateLimit = {
    config: {
      rateLimit: {
        max: fastify.config.rateLimit.auth * 10, // 10x more lenient
        timeWindow: '15 minutes',
        keyGenerator: (request: FastifyRequest) => request.ip,
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

  // POST /auth/v1/signup (strict rate limit - prevent account spam)
  fastify.post('/auth/v1/signup', {
    ...strictAuthRateLimit,
    preHandler: [resolveProject],
  }, projectSignupHandler);

  // POST /auth/v1/token (strict for password, moderate for refresh)
  fastify.post('/auth/v1/token', {
    ...strictAuthRateLimit,
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

  // POST /auth/v1/logout (moderate rate limit)
  fastify.post('/auth/v1/logout', {
    ...moderateAuthRateLimit,
    preHandler: [resolveProject, authenticateProject],
  }, projectSignoutHandler);

  // GET /auth/v1/user (moderate rate limit)
  fastify.get('/auth/v1/user', {
    ...moderateAuthRateLimit,
    preHandler: [resolveProject, authenticateProject],
  }, projectMeHandler);
};

export default authPlugin;
