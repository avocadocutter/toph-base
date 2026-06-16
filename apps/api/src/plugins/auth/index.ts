import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { authenticateProject } from '../../hooks/authenticate.js';
import { resolveLocalProject } from '../../hooks/resolve-project.js';
import { BadRequestError } from '../../lib/errors.js';
import {
  projectSignupHandler,
  projectSigninHandler,
  projectRefreshHandler,
  projectSignoutHandler,
  projectMeHandler,
} from './project-handlers.js';

const authPlugin: FastifyPluginAsync = async (fastify) => {
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

  const tokenRateLimit = {
    config: {
      rateLimit: {
        max: fastify.config.rateLimit.auth * 4,
        timeWindow: '15 minutes',
        keyGenerator: (request: FastifyRequest) => {
          const body = request.body as { email?: string } | undefined;
          const grant = (request.query as { grant_type?: string }).grant_type ?? 'unknown';
          const key = body?.email ?? request.ip;
          return `${grant}:${key}`;
        },
      },
    },
  };

  // POST /auth/v1/signup
  fastify.post('/auth/v1/signup', {
    ...strictAuthRateLimit,
    preHandler: [resolveLocalProject],
  }, projectSignupHandler);

  // POST /auth/v1/token (password + refresh)
  fastify.post('/auth/v1/token', {
    ...tokenRateLimit,
    preHandler: [resolveLocalProject],
  }, async (request, reply) => {
    const query = request.query as { grant_type?: string };
    if (query.grant_type === 'password') return projectSigninHandler(request, reply);
    if (query.grant_type === 'refresh_token') return projectRefreshHandler(request, reply);
    throw new BadRequestError('Invalid grant_type. Must be "password" or "refresh_token"');
  });

  // POST /auth/v1/logout — empty-body safe
  fastify.register(async function logoutScope(scope) {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      if (!body || (body as string).trim() === '') {
        done(null, {});
      } else {
        try {
          done(null, JSON.parse(body as string));
        } catch {
          const e = new Error('Invalid JSON body') as Error & { statusCode: number };
          e.statusCode = 400;
          done(e, undefined);
        }
      }
    });
    scope.post('/auth/v1/logout', {
      preHandler: [resolveLocalProject, authenticateProject],
    }, projectSignoutHandler);
  });

  // GET /auth/v1/user
  fastify.get('/auth/v1/user', {
    preHandler: [resolveLocalProject, authenticateProject],
  }, projectMeHandler);
};

export default authPlugin;
