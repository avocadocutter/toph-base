import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import replyFrom from '@fastify/reply-from';
import { createApikeyResolver } from '../../hooks/resolve-project-from-apikey.js';
import { AppError } from '../../lib/errors.js';

const postgrestProxyPlugin: FastifyPluginAsync = async (fastify) => {
  const resolveFromApikey = createApikeyResolver(fastify.db);

  await fastify.register(replyFrom, {
    undici: {
      connections: 64,
      pipelining: 1,
    },
  });

  // Catch-all route for /rest/v1/*
  // Works with subdomain routing: https://{ref}.yourdomain.com/rest/v1/...
  fastify.all(
    '/rest/v1/*',
    {
      preHandler: [resolveFromApikey],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const project = request.project;
      if (!project) {
        throw new AppError(401, 'UNAUTHORIZED', 'Invalid API key');
      }

      const baseUrl = fastify.postgrestManager.getUrl(project.ref);

      if (!baseUrl) {
        throw new AppError(
          503,
          'SERVICE_UNAVAILABLE',
          'No PostgREST instance configured for this project. Please configure a PostgREST URL in project settings.'
        );
      }

      if (!fastify.postgrestManager.isHealthy(project.ref)) {
        throw new AppError(
          503,
          'SERVICE_UNAVAILABLE',
          'PostgREST instance is not healthy. Check if it is running.'
        );
      }

      // Extract the path after /rest/v1/
      const upstreamPath = request.url.replace(/^\/rest\/v1/, '');
      const upstream = `${baseUrl}${upstreamPath}`;

      // Forward headers
      const headers = { ...request.headers };

      // Handle Authorization header based on key type
      // New format keys (sb_publishable_*, sb_secret_*) are NOT JWTs and cannot go in Authorization header
      // Only legacy JWT-based keys or user JWTs should be forwarded
      const apikey = headers.apikey as string | undefined;
      const isNewFormat = apikey?.startsWith('sb_publishable_') || apikey?.startsWith('sb_secret_');

      if (!headers.authorization && apikey && !isNewFormat) {
        // Legacy JWT-based key - forward as Authorization Bearer
        headers.authorization = `Bearer ${apikey}`;
      }

      // Note: For new format keys, the apikey header is kept but NOT forwarded in Authorization.
      // PostgREST should be configured to read the apikey header directly.
      // If a user JWT is present in Authorization, it's already there and will be forwarded.

      // Set schema profile headers for PostgREST
      // PostgREST uses these headers to determine which schema to use
      headers['accept-profile'] = project.schemaName;
      headers['content-profile'] = project.schemaName;

      // Remove host header to avoid conflicts
      delete headers.host;

      return reply.from(upstream, {
        rewriteRequestHeaders: (_req, existingHeaders) => ({
          ...existingHeaders,
          ...headers,
        }),
      });
    }
  );
};

export default postgrestProxyPlugin;
