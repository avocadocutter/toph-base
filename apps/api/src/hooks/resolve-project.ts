import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyProjectAccessToken } from '../plugins/auth/jwt.js';

export async function resolveLocalProject(request: FastifyRequest, _reply: FastifyReply) {
  const { project } = request.server.config;
  request.project = { ref: project.name, jwtSecret: project.jwtSecret };
  request.projectDb = request.server.branchManager.getActiveStore();

  const authHeader = request.headers.authorization;
  const apikey = request.headers['apikey'] as string | undefined;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (apikey ?? null);

  if (!token || token === project.publishableKey) return;

  if (token === project.secretKey) {
    request.userRole = 'service_role';
    return;
  }

  try {
    const payload = await verifyProjectAccessToken(token, project.name, project.jwtSecret);
    request.jwtPayload = payload;
    request.userId = payload.sub;
    request.userRole = payload.role;
  } catch {
    // invalid token — leave as anon; strict routes reject via authenticateProject
  }
}
