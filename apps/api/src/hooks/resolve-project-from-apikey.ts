import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DbPool } from '../db/pool.js';
import type { ProjectPoolManager } from '../db/pool-manager.js';
import * as jose from 'jose';
import { resolveProjectByRef } from './resolve-project.js';
import { verifyProjectAccessToken, isNewFormatKey, getKeyPrefix } from '../plugins/auth/jwt.js';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';

interface ApiKeyRecord {
  id: string;
  project_id: string;
  project_ref: string;
  key_prefix: 'publishable' | 'secret';
  role: string;
  jwt_secret: string;
  revoked_at: Date | null;
}

function isBrowserRequest(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  const browserPatterns = /Mozilla|Chrome|Safari|Firefox|Edge|Opera/i;
  return browserPatterns.test(userAgent);
}

export function createApikeyResolver(db: DbPool, poolManager?: ProjectPoolManager) {
  return async function resolveProjectFromApikey(request: FastifyRequest, _reply: FastifyReply) {
    const apikey = request.headers['apikey'] as string | undefined;
    if (!apikey) {
      throw new UnauthorizedError('Missing apikey header');
    }

    let projectRef: string;
    let role: string;
    let jwtSecret: string;

    // Only accept new format keys (sb_publishable_* or sb_secret_*)
    if (!isNewFormatKey(apikey)) {
      throw new UnauthorizedError('Invalid API key format. Only sb_publishable_* and sb_secret_* keys are supported.');
    }

    const keyPrefix = getKeyPrefix(apikey);

    // Security check: secret keys cannot be used from browsers
    if (keyPrefix === 'secret') {
      const userAgent = request.headers['user-agent'];
      if (isBrowserRequest(userAgent)) {
        throw new ForbiddenError('Secret keys cannot be used from browsers. Use a publishable key instead.');
      }
    }

    // Look up the key in the database
    const result = await db.query<ApiKeyRecord>(
      `SELECT ak.id, ak.project_id, ak.key_prefix, ak.role, ak.revoked_at,
              p.ref AS project_ref, p.jwt_secret
       FROM toph_internal.api_keys ak
       JOIN toph_internal.projects p ON ak.project_id = p.id
       WHERE ak.key_value = $1 AND p.status = 'active'`,
      [apikey],
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedError('Invalid API key');
    }

    const keyRecord = result.rows[0];

    if (keyRecord.revoked_at) {
      throw new UnauthorizedError('API key has been revoked');
    }

    projectRef = keyRecord.project_ref;
    role = keyRecord.role;
    jwtSecret = keyRecord.jwt_secret;

    // Track key usage (fire and forget)
    db.query('SELECT toph_internal.record_api_key_usage($1)', [apikey]).catch((err) => {
      request.log.warn({ err, keyId: keyRecord.id }, 'Failed to record API key usage');
    });

    // Resolve project from ref (uses shared cache)
    const project = await resolveProjectByRef(db, projectRef);
    request.project = project;

    if (poolManager) {
      request.projectDb = poolManager.getProjectPool(project.dbName);
    }

    // Handle user JWT in Authorization header (if present)
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (bearerToken && bearerToken !== apikey) {
      // User provided a separate JWT for authentication
      try {
        const payload = await verifyProjectAccessToken(bearerToken, project.ref, jwtSecret);
        request.projectPayload = payload;
        request.jwtPayload = payload;
        request.userId = payload.sub;
        request.userRole = payload.role;
      } catch {
        throw new UnauthorizedError('Invalid or expired user token');
      }
    } else {
      // No separate user JWT - use the role from the API key
      // Create a synthetic payload for compatibility
      request.projectPayload = {
        sub: '00000000-0000-0000-0000-000000000000',
        role,
        type: 'access',
        project_ref: projectRef,
      } as any;
      request.jwtPayload = request.projectPayload;
      request.userId = '00000000-0000-0000-0000-000000000000';
      request.userRole = role;
    }
  };
}
