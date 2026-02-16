import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createProjectAccessToken, createRefreshToken, hashRefreshToken, verifyProjectAccessToken } from '../auth/jwt.js';
import { createApikeyResolver } from '../../hooks/resolve-project-from-apikey.js';
import { resolveProjectByRef } from '../../hooks/resolve-project.js';
import { BadRequestError, ConflictError, UnauthorizedError } from '../../lib/errors.js';
import { quoteIdentifier } from '../../lib/sql-helpers.js';
import { toGoTrueUser, toGoTrueSession } from './gotrue-format.js';
import * as jose from 'jose';
import crypto from 'node:crypto';

const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const signinSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

function usersTable(schema: string) {
  return `${quoteIdentifier(schema)}."users"`;
}

function sessionsTable(schema: string) {
  return `${quoteIdentifier(schema)}."sessions"`;
}

async function resolveProjectFromApikeyOnly(request: FastifyRequest) {
  const apikey = request.headers['apikey'] as string | undefined;
  if (!apikey) {
    throw new UnauthorizedError('Missing apikey header');
  }

  let projectRef: string;
  try {
    const claims = jose.decodeJwt(apikey);
    projectRef = claims.project_ref as string;
    if (!projectRef) throw new Error('No project_ref');
  } catch {
    throw new UnauthorizedError('Invalid apikey: cannot decode JWT');
  }

  request.project = await resolveProjectByRef(request.server.db, projectRef);
}

const compatAuthPlugin: FastifyPluginAsync = async (fastify) => {
  const resolveFromApikey = createApikeyResolver(fastify.db);

  // POST /auth/v1/signup
  fastify.post('/auth/v1/signup', {
    preHandler: [async (request: FastifyRequest, _reply: FastifyReply) => {
      await resolveProjectFromApikeyOnly(request);
    }],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = signupSchema.parse(request.body);
    const { email, password } = body;
    const db = fastify.db;
    const config = fastify.config;
    const project = request.project!;
    const schema = project.schemaName;

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE service_role');

      const existing = await client.query(
        `SELECT id FROM ${usersTable(schema)} WHERE email = $1`,
        [email],
      );
      if (existing.rows.length > 0) {
        throw new ConflictError('User with this email already exists');
      }

      const passwordHash = await hashPassword(password);
      const result = await client.query(
        `INSERT INTO ${usersTable(schema)} (email, password_hash, role)
         VALUES ($1, $2, 'authenticated')
         RETURNING id, email, role, email_confirmed, is_disabled, metadata, created_at, updated_at`,
        [email, passwordHash],
      );

      const user = result.rows[0];
      const accessToken = await createProjectAccessToken(
        user.id, user.email, user.role, project.ref, project.jwtSecret, config.jwt.accessTokenExpiry,
      );
      const refreshToken = await createRefreshToken();
      const familyId = crypto.randomUUID();

      await client.query(
        `INSERT INTO ${sessionsTable(schema)} (user_id, refresh_token_hash, family_id, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
        [user.id, hashRefreshToken(refreshToken), familyId, request.ip, request.headers['user-agent'] ?? null, config.jwt.refreshTokenExpiry],
      );

      await client.query('COMMIT');

      const gotrueUser = toGoTrueUser(user);
      const session = toGoTrueSession(accessToken, refreshToken, config.jwt.accessTokenExpiry, gotrueUser);
      reply.status(200).send(session);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  // POST /auth/v1/token?grant_type=password
  // POST /auth/v1/token?grant_type=refresh_token
  fastify.post('/auth/v1/token', {
    preHandler: [async (request: FastifyRequest, _reply: FastifyReply) => {
      await resolveProjectFromApikeyOnly(request);
    }],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { grant_type } = request.query as { grant_type?: string };
    const db = fastify.db;
    const config = fastify.config;
    const project = request.project!;
    const schema = project.schemaName;

    if (grant_type === 'password') {
      const body = signinSchema.parse(request.body);
      const { email, password } = body;

      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE service_role');

        const result = await client.query(
          `SELECT id, email, password_hash, role, is_disabled, email_confirmed, metadata, created_at, updated_at, last_sign_in_at
           FROM ${usersTable(schema)} WHERE email = $1`,
          [email],
        );

        if (result.rows.length === 0) {
          throw new UnauthorizedError('Invalid email or password');
        }

        const user = result.rows[0];

        if (user.is_disabled) {
          throw new UnauthorizedError('Account is disabled');
        }

        const valid = await verifyPassword(user.password_hash, password);
        if (!valid) {
          throw new UnauthorizedError('Invalid email or password');
        }

        await client.query(
          `UPDATE ${usersTable(schema)} SET last_sign_in_at = now() WHERE id = $1`,
          [user.id],
        );

        const accessToken = await createProjectAccessToken(
          user.id, user.email, user.role, project.ref, project.jwtSecret, config.jwt.accessTokenExpiry,
        );
        const refreshToken = await createRefreshToken();
        const familyId = crypto.randomUUID();

        await client.query(
          `INSERT INTO ${sessionsTable(schema)} (user_id, refresh_token_hash, family_id, ip_address, user_agent, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
          [user.id, hashRefreshToken(refreshToken), familyId, request.ip, request.headers['user-agent'] ?? null, config.jwt.refreshTokenExpiry],
        );

        await client.query('COMMIT');

        const gotrueUser = toGoTrueUser({ ...user, last_sign_in_at: new Date().toISOString() });
        const session = toGoTrueSession(accessToken, refreshToken, config.jwt.accessTokenExpiry, gotrueUser);
        return session;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } else if (grant_type === 'refresh_token') {
      const body = request.body as { refresh_token?: string };
      if (!body?.refresh_token) {
        throw new BadRequestError('refresh_token is required');
      }

      const tokenHash = hashRefreshToken(body.refresh_token);
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE service_role');

        const sessionResult = await client.query(
          `SELECT s.id, s.user_id, s.family_id, s.expires_at,
                  u.id AS uid, u.email, u.role, u.is_disabled, u.email_confirmed, u.metadata, u.created_at, u.updated_at, u.last_sign_in_at
           FROM ${sessionsTable(schema)} s
           JOIN ${usersTable(schema)} u ON s.user_id = u.id
           WHERE s.refresh_token_hash = $1 AND s.expires_at > now()`,
          [tokenHash],
        );

        if (sessionResult.rows.length === 0) {
          throw new UnauthorizedError('Invalid or expired refresh token');
        }

        const session = sessionResult.rows[0];

        if (session.is_disabled) {
          throw new UnauthorizedError('Account is disabled');
        }

        await client.query(`DELETE FROM ${sessionsTable(schema)} WHERE id = $1`, [session.id]);

        const newAccessToken = await createProjectAccessToken(
          session.user_id, session.email, session.role, project.ref, project.jwtSecret, config.jwt.accessTokenExpiry,
        );
        const newRefreshToken = await createRefreshToken();

        await client.query(
          `INSERT INTO ${sessionsTable(schema)} (user_id, refresh_token_hash, family_id, ip_address, user_agent, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
          [session.user_id, hashRefreshToken(newRefreshToken), session.family_id, request.ip, request.headers['user-agent'] ?? null, config.jwt.refreshTokenExpiry],
        );

        await client.query('COMMIT');

        const gotrueUser = toGoTrueUser({
          id: session.uid,
          email: session.email,
          role: session.role,
          email_confirmed: session.email_confirmed,
          is_disabled: session.is_disabled,
          metadata: session.metadata,
          created_at: session.created_at,
          updated_at: session.updated_at,
          last_sign_in_at: session.last_sign_in_at,
        });
        return toGoTrueSession(newAccessToken, newRefreshToken, config.jwt.accessTokenExpiry, gotrueUser);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } else {
      throw new BadRequestError(`Unsupported grant_type: ${grant_type}`);
    }
  });

  // POST /auth/v1/logout
  fastify.post('/auth/v1/logout', {
    preHandler: [resolveFromApikey],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const project = request.project!;
    const schema = project.schemaName;

    // Try to invalidate the session via the access token's sub
    if (request.userId) {
      const client = await fastify.db.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE service_role');
        // Delete all sessions for this user (scope: global logout per GoTrue behavior)
        await client.query(`DELETE FROM ${sessionsTable(schema)} WHERE user_id = $1`, [request.userId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }

    reply.status(204).send('');
  });

  // GET /auth/v1/user
  fastify.get('/auth/v1/user', {
    preHandler: [resolveFromApikey],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.userId) {
      throw new UnauthorizedError();
    }

    const project = request.project!;
    const schema = project.schemaName;

    const client = await fastify.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE service_role');

      const result = await client.query(
        `SELECT id, email, role, email_confirmed, is_disabled, metadata, created_at, updated_at, last_sign_in_at
         FROM ${usersTable(schema)} WHERE id = $1`,
        [request.userId],
      );

      await client.query('COMMIT');

      if (result.rows.length === 0) {
        throw new UnauthorizedError('User not found');
      }

      return toGoTrueUser(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });
};

export default compatAuthPlugin;
