import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import replyFrom from '@fastify/reply-from';
import { createApikeyResolver } from '../../hooks/resolve-project-from-apikey.js';
import { AppError } from '../../lib/errors.js';
import { generateApiKey } from '../auth/jwt.js';

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

      // Check if we need to generate a JWT for PostgREST
      // We need to generate if:
      // 1. No Authorization header exists, OR
      // 2. Authorization header contains the API key (not a JWT)
      const apikey = request.headers.apikey as string | undefined;
      const authHeader = headers.authorization;
      const needsJwt = !authHeader || (apikey && authHeader === `Bearer ${apikey}`);

      request.log.info({
        hasAuthHeader: !!authHeader,
        authHeaderPreview: authHeader?.substring(0, 100),
        userRole: request.userRole,
        needsJwt,
      }, 'PostgREST proxy - checking authorization');

      if (needsJwt) {
        // Generate a JWT for PostgREST using the role from the API key
        const role = request.userRole || 'anon';

        request.log.info({
          role,
          projectRef: project.ref,
          hasJwtSecret: !!project.jwtSecret,
          jwtSecretLength: project.jwtSecret?.length
        }, 'Generating JWT for PostgREST');

        const jwt = await generateApiKey(
          role as 'anon' | 'service_role',
          project.ref,
          project.jwtSecret,
        );

        request.log.info({
          jwtLength: jwt.length,
          jwtPreview: jwt,
          jwtParts: jwt.split('.').length
        }, 'Generated JWT');

        headers.authorization = `Bearer ${jwt}`;
      }

      // Remove the apikey header - PostgREST doesn't need it, it just needs the JWT
      delete headers.apikey;

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
