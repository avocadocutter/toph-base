import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyProjectAccessToken } from '../plugins/auth/jwt.js';
import { UnauthorizedError } from '../lib/errors.js';

export async function authenticateProject(request: FastifyRequest, _reply: FastifyReply) {
  const project = request.project;
  if (!project) throw new UnauthorizedError('Project context not resolved');

  const token = extractToken(request);
  if (!token) throw new UnauthorizedError('Missing authorization. Provide a Bearer token or apikey header.');

  const { publishableKey, secretKey } = request.server.config.project;

  // Publishable key — unauthenticated pass-through (anonymous access)
  if (token === publishableKey) return;

  // Secret key — full admin access, bypasses RLS
  if (token === secretKey) {
    request.userRole = 'service_role';
    return;
  }

  try {
    const payload = await verifyProjectAccessToken(token, project.ref, project.jwtSecret);
    request.jwtPayload = payload;
    request.userId = payload.sub;
    request.userRole = payload.role;
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }
}

export async function authenticateProjectOptional(request: FastifyRequest, _reply: FastifyReply) {
  const project = request.project;
  if (!project) return;

  const token = extractToken(request);
  if (!token) return;

  const { publishableKey, secretKey } = request.server.config.project;

  if (token === publishableKey) return;

  if (token === secretKey) {
    request.userRole = 'service_role';
    return;
  }

  try {
    const payload = await verifyProjectAccessToken(token, project.ref, project.jwtSecret);
    request.jwtPayload = payload;
    request.userId = payload.sub;
    request.userRole = payload.role;
  } catch {
    // Invalid token — continue as anonymous
  }
}

function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  const apikey = request.headers['apikey'] as string | undefined;
  return apikey ?? null;
}
