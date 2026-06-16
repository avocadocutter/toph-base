import type { DbPool } from '../db/pglite-store.js';
import type { Config } from '../config.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { FastifyRequest, FastifyReply } from 'fastify';

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

// The resolved local project — always the same in single-project mode.
export interface ResolvedProject {
  ref: string;
  jwtSecret: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: DbPool;
    config: Config;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    project?: ResolvedProject;
    projectDb?: DbPool;
    jwtPayload?: ProjectJwtPayload;
    userId?: string;
    userRole?: string;
  }
}
