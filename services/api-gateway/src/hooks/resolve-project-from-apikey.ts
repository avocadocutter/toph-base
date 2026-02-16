import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DbPool } from '../db/pool.js';
import * as jose from 'jose';
import { resolveProjectByRef } from './resolve-project.js';
import { verifyProjectAccessToken } from '../plugins/auth/jwt.js';
import { UnauthorizedError } from '../lib/errors.js';

export function createApikeyResolver(db: DbPool) {
  return async function resolveProjectFromApikey(request: FastifyRequest, _reply: FastifyReply) {
    const apikey = request.headers['apikey'] as string | undefined;
    if (!apikey) {
      throw new UnauthorizedError('Missing apikey header');
    }

    // Decode (no verification) to extract project_ref
    let projectRef: string;
    try {
      const claims = jose.decodeJwt(apikey);
      projectRef = claims.project_ref as string;
      if (!projectRef) {
        throw new Error('No project_ref in apikey');
      }
    } catch {
      throw new UnauthorizedError('Invalid apikey: cannot decode JWT');
    }

    // Resolve project from ref (uses shared cache)
    const project = await resolveProjectByRef(db, projectRef);
    request.project = project;

    // Determine which token to verify for identity context
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const tokenToVerify = bearerToken && bearerToken !== apikey ? bearerToken : apikey;

    try {
      const payload = await verifyProjectAccessToken(tokenToVerify, project.ref, project.jwtSecret);
      request.projectPayload = payload;
      request.jwtPayload = payload;
      request.userId = payload.sub;
      request.userRole = payload.role;
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  };
}
