import type { DbPool } from '../db/pool.js';
import type { Config } from '../config.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: DbPool;
    config: Config;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    jwtPayload?: JwtPayload;
    userId?: string;
    userRole?: string;
  }
}
