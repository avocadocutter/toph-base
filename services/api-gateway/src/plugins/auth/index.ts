import type { FastifyPluginAsync } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { authenticatePlatform } from '../../hooks/authenticate.js';
import { authenticateProject } from '../../hooks/authenticate.js';
import { createProjectResolver } from '../../hooks/resolve-project.js';
import { platformSigninHandler, platformRefreshHandler, platformSignoutHandler, platformMeHandler } from './platform-handlers.js';
import { projectSignupHandler, projectSigninHandler, projectRefreshHandler, projectSignoutHandler, projectMeHandler } from './project-handlers.js';

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const resolveProject = createProjectResolver(fastify.db);

  // Apply stricter rate limit to auth routes
  await fastify.register(rateLimit, {
    max: fastify.config.rateLimit.auth,
    timeWindow: '15 minutes',
    keyGenerator: (request) => {
      const body = request.body as { email?: string } | undefined;
      return body?.email ? `${request.ip}:${body.email}` : request.ip;
    },
  });

  // ── Platform auth routes ──
  fastify.post('/platform/auth/signin', platformSigninHandler);
  fastify.post('/platform/auth/refresh', platformRefreshHandler);
  fastify.post('/platform/auth/signout', platformSignoutHandler);
  fastify.get('/platform/auth/me', {
    preHandler: [authenticatePlatform],
  }, platformMeHandler);

  // ── Project auth routes ──
  fastify.post('/project/:projectRef/auth/signup', {
    preHandler: [resolveProject],
  }, projectSignupHandler);

  fastify.post('/project/:projectRef/auth/signin', {
    preHandler: [resolveProject],
  }, projectSigninHandler);

  fastify.post('/project/:projectRef/auth/refresh', {
    preHandler: [resolveProject],
  }, projectRefreshHandler);

  fastify.post('/project/:projectRef/auth/signout', {
    preHandler: [resolveProject],
  }, projectSignoutHandler);

  fastify.get('/project/:projectRef/auth/me', {
    preHandler: [resolveProject, authenticateProject],
  }, projectMeHandler);
};

export default authPlugin;
