import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DbPool } from '../db/pool.js';
import type { ResolvedProject } from '../types/fastify.js';
import { NotFoundError } from '../lib/errors.js';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  project: ResolvedProject;
  expiresAt: number;
}

const projectCache = new Map<string, CacheEntry>();

export async function resolveProjectByRef(db: DbPool, ref: string): Promise<ResolvedProject> {
  const now = Date.now();
  const cached = projectCache.get(ref);
  if (cached && cached.expiresAt > now) {
    return cached.project;
  }

  const result = await db.query(
    `SELECT id, ref, schema_name, jwt_secret, status
     FROM toph_internal.projects
     WHERE ref = $1 AND status != 'deleted'`,
    [ref],
  );

  if (result.rows.length === 0) {
    throw new NotFoundError(`Project '${ref}' not found`);
  }

  const row = result.rows[0];
  const project: ResolvedProject = {
    id: row.id,
    ref: row.ref,
    schemaName: row.schema_name,
    jwtSecret: row.jwt_secret,
    status: row.status,
  };

  projectCache.set(ref, { project, expiresAt: now + CACHE_TTL_MS });
  return project;
}

export function createProjectResolver(db: DbPool) {
  return async function resolveProject(request: FastifyRequest, _reply: FastifyReply) {
    const { projectRef } = request.params as { projectRef: string };
    if (!projectRef) {
      throw new NotFoundError('Project reference is required');
    }

    request.project = await resolveProjectByRef(db, projectRef);
  };
}

export function invalidateProjectCache(ref?: string) {
  if (ref) {
    projectCache.delete(ref);
  } else {
    projectCache.clear();
  }
}
