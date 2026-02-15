import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../plugins/auth/jwt.js';
import { UnauthorizedError } from '../lib/errors.js';

export async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);
  try {
    const payload = await verifyAccessToken(token);
    request.jwtPayload = payload;
    request.userId = payload.sub;
    request.userRole = payload.role;
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }
}

export async function authenticateOptional(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return; // No token, continue as anonymous
  }

  const token = authHeader.slice(7);
  try {
    const payload = await verifyAccessToken(token);
    request.jwtPayload = payload;
    request.userId = payload.sub;
    request.userRole = payload.role;
  } catch {
    // Invalid token, continue as anonymous
  }
}

export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply) {
  await authenticate(request, _reply);
  if (request.userRole !== 'admin') {
    throw new UnauthorizedError('Admin access required');
  }
}
