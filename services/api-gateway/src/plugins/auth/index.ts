import type { FastifyPluginAsync } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { signupHandler, signinHandler, refreshHandler, signoutHandler, meHandler } from './handlers.js';

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Apply stricter rate limit to auth routes
  await fastify.register(rateLimit, {
    max: fastify.config.rateLimit.auth,
    timeWindow: '15 minutes',
    keyGenerator: (request) => {
      // Rate limit by IP + email for signin, IP only for signup
      const body = request.body as { email?: string } | undefined;
      return body?.email ? `${request.ip}:${body.email}` : request.ip;
    },
  });

  fastify.post('/auth/signup', signupHandler);
  fastify.post('/auth/signin', signinHandler);
  fastify.post('/auth/refresh', refreshHandler);
  fastify.post('/auth/signout', signoutHandler);
  fastify.get('/auth/me', {
    preHandler: [fastify.authenticate],
  }, meHandler);
};

export default authPlugin;
