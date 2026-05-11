import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DbPool } from '../db/pool.js';
import type { ResolvedProject } from '../types/fastify.js';
import type { ProjectPoolManager } from '../db/pool-manager.js';
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
    `SELECT id, ref, db_name, jwt_secret, status
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
    dbName: row.db_name,
    jwtSecret: row.jwt_secret,
    status: row.status,
  };

  projectCache.set(ref, { project, expiresAt: now + CACHE_TTL_MS });
  return project;
}

export function createProjectResolver(db: DbPool, poolManager?: ProjectPoolManager) {
  return async function resolveProject(request: FastifyRequest, _reply: FastifyReply) {
    // Try to get project ref from multiple sources:
    // 1. Route params (e.g., /project/:projectRef/...)
    // 2. Subdomain (e.g., 3aca04e1.localhost:8000)
    // 3. Host header for subdomain routing

    let projectRef: string | undefined;

    // First try route params
    const params = request.params as { projectRef?: string };
    projectRef = params.projectRef;

    // If not in params, try extracting from subdomain
    if (!projectRef) {
      const host = request.headers.host;
      if (host) {
        // Extract subdomain from host (e.g., "3aca04e1.localhost:8000" -> "3aca04e1")
        const parts = host.split('.');
        if (parts.length >= 2) {
          // Check if first part looks like a project ref (not "www", "api", etc.)
          const subdomain = parts[0].split(':')[0]; // Remove port if present
          if (subdomain && !['www', 'api', 'app', 'localhost'].includes(subdomain)) {
            projectRef = subdomain;
          }
        }
      }
    }

    if (!projectRef) {
      throw new NotFoundError('Project reference is required');
    }

    const project = await resolveProjectByRef(db, projectRef);
    request.project = project;

    if (poolManager) {
      request.projectDb = poolManager.getProjectPool(project.dbName);
    }
  };
}

export function invalidateProjectCache(ref?: string) {
  if (ref) {
    projectCache.delete(ref);
  } else {
    projectCache.clear();
  }
}
