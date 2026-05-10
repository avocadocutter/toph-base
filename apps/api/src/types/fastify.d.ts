import type { DbPool } from '../db/pool.js';
import type { Config } from '../config.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ProjectPoolManager } from '../db/pool-manager.js';

export interface PlatformJwtPayload {
  sub: string;
  email: string;
  role: 'admin';
  type: 'access';
  iss: 'toph-platform';
  iat: number;
  exp: number;
}

export interface ProjectJwtPayload {
  sub: string;
  email: string;
  role: string;
  type: 'access';
  iss: string;
  project_ref: string;
  iat: number;
  exp: number;
}

export interface ResolvedProject {
  id: string;
  ref: string;
  dbName: string;
  jwtSecret: string;
  status: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: DbPool;
    config: Config;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    projectPoolManager: ProjectPoolManager;
  }

  interface FastifyRequest {
    // Platform auth
    platformPayload?: PlatformJwtPayload;
    platformUserId?: string;
    // Project auth
    projectPayload?: ProjectJwtPayload;
    project?: ResolvedProject;
    // Project database pool (set by project resolver)
    projectDb?: DbPool;
    // Unified (set by project auth for RLS context compat)
    jwtPayload?: ProjectJwtPayload;
    userId?: string;
    userRole?: string;
  }
}
