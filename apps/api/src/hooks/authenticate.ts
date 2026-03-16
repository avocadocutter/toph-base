import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyPlatformAccessToken, verifyProjectAccessToken } from '../plugins/auth/jwt.js';
import { UnauthorizedError } from '../lib/errors.js';

// ── Platform Auth Hooks ──

export async function authenticatePlatform(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);
  try {
    const payload = await verifyPlatformAccessToken(token);
    request.platformPayload = payload;
    request.platformUserId = payload.sub;
  } catch {
    throw new UnauthorizedError('Invalid or expired platform access token');
  }
}

export async function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply) {
  await authenticatePlatform(request, reply);
  if (request.platformPayload?.role !== 'admin') {
    throw new UnauthorizedError('Platform admin access required');
  }
}

// ── Project Auth Hooks ──

export async function authenticateProject(request: FastifyRequest, _reply: FastifyReply) {
  const project = request.project;
  if (!project) {
    throw new UnauthorizedError('Project context not resolved');
  }

  const token = extractProjectToken(request);
  if (!token) {
    throw new UnauthorizedError('Missing authorization. Provide a Bearer token or apikey header.');
  }

  try {
    const payload = await verifyProjectAccessToken(token, project.ref, project.jwtSecret);
    request.projectPayload = payload;
    request.jwtPayload = payload;
    request.userId = payload.sub;
    request.userRole = payload.role;
  } catch {
    throw new UnauthorizedError('Invalid or expired project access token');
  }
}

export async function authenticateProjectOptional(request: FastifyRequest, _reply: FastifyReply) {
  const project = request.project;
  if (!project) return;

  const token = extractProjectToken(request);
  if (!token) return;

  try {
    const payload = await verifyProjectAccessToken(token, project.ref, project.jwtSecret);
    request.projectPayload = payload;
    request.jwtPayload = payload;
    request.userId = payload.sub;
    request.userRole = payload.role;
  } catch {
    // Invalid token — continue as anonymous
  }
}

function extractProjectToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const apikey = request.headers['apikey'] as string | undefined;
  if (apikey) return apikey;
  return null;
}
