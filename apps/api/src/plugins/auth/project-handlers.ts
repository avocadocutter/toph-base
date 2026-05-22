import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hashPassword, verifyPassword } from './password.js';
import { createProjectAccessToken, createRefreshToken, hashRefreshToken } from './jwt.js';
import { BadRequestError, ConflictError, UnauthorizedError } from '../../lib/errors.js';
import crypto from 'node:crypto';

const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const signinSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export async function projectSignupHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = signupSchema.parse(request.body);
  const { email, password } = body;
  const db = request.projectDb!;
  const config = request.server.config;
  const project = request.project!;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE service_role`);

    const existing = await client.query(
      `SELECT id FROM auth.users WHERE email = $1`,
      [email],
    );
    if (existing.rows.length > 0) {
      throw new ConflictError('User with this email already exists');
    }

    const passwordHash = await hashPassword(password);
    const result = await client.query(
      `INSERT INTO auth.users (email, password_hash, role)
       VALUES ($1, $2, 'authenticated')
       RETURNING id, email, role, email_confirmed, is_disabled, created_at, updated_at`,
      [email, passwordHash],
    );

    const user = result.rows[0];

    const accessToken = await createProjectAccessToken(
      user.id, user.email, user.role, project.ref, project.jwtSecret, config.jwt.accessTokenExpiry,
    );
    const refreshToken = await createRefreshToken();
    const familyId = crypto.randomUUID();

    await client.query(
      `INSERT INTO auth.sessions (user_id, refresh_token_hash, family_id, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
      [user.id, hashRefreshToken(refreshToken), familyId, request.ip, request.headers['user-agent'] ?? null, config.jwt.refreshTokenExpiry],
    );

    await client.query('COMMIT');

    // Supabase-compatible response format
    reply.status(200).send({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: config.jwt.accessTokenExpiry,
      expires_at: Math.floor(Date.now() / 1000) + config.jwt.accessTokenExpiry,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        aud: 'authenticated',
        email: user.email,
        role: user.role,
        app_metadata: { provider: 'email' },
        user_metadata: {},
        email_confirmed_at: user.email_confirmed ? user.created_at : null,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function projectSigninHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = signinSchema.parse(request.body);
  const { email, password } = body;
  const db = request.projectDb!;
  const config = request.server.config;
  const project = request.project!;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE service_role`);

    const result = await client.query(
      `SELECT id, email, password_hash, role, is_disabled, email_confirmed, metadata, created_at, updated_at, last_sign_in_at
       FROM auth.users WHERE email = $1`,
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
      `UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1`,
      [user.id],
    );

    const accessToken = await createProjectAccessToken(
      user.id, user.email, user.role, project.ref, project.jwtSecret, config.jwt.accessTokenExpiry,
    );
    const refreshToken = await createRefreshToken();
    const familyId = crypto.randomUUID();

    await client.query(
      `INSERT INTO auth.sessions (user_id, refresh_token_hash, family_id, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
      [user.id, hashRefreshToken(refreshToken), familyId, request.ip, request.headers['user-agent'] ?? null, config.jwt.refreshTokenExpiry],
    );

    await client.query('COMMIT');

    // Supabase-compatible response format
    reply.send({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: config.jwt.accessTokenExpiry,
      expires_at: Math.floor(Date.now() / 1000) + config.jwt.accessTokenExpiry,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        aud: 'authenticated',
        email: user.email,
        role: user.role,
        app_metadata: { provider: 'email' },
        user_metadata: user.metadata || {},
        email_confirmed_at: user.email_confirmed ? user.created_at : null,
        last_sign_in_at: user.last_sign_in_at,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function projectRefreshHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { refresh_token: string };
  if (!body?.refresh_token) {
    throw new BadRequestError('Refresh token is required');
  }

  const db = request.projectDb!;
  const config = request.server.config;
  const project = request.project!;
  const tokenHash = hashRefreshToken(body.refresh_token);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE service_role`);

    const sessionResult = await client.query(
      `SELECT s.id, s.user_id, s.family_id, s.expires_at, u.email, u.role, u.is_disabled, u.email_confirmed, u.metadata, u.created_at, u.updated_at, u.last_sign_in_at
       FROM auth.sessions s
       JOIN auth.users u ON s.user_id = u.id
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

    await client.query(`DELETE FROM auth.sessions WHERE id = $1`, [session.id]);

    const newAccessToken = await createProjectAccessToken(
      session.user_id, session.email, session.role, project.ref, project.jwtSecret, config.jwt.accessTokenExpiry,
    );
    const newRefreshToken = await createRefreshToken();

    await client.query(
      `INSERT INTO auth.sessions (user_id, refresh_token_hash, family_id, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
      [session.user_id, hashRefreshToken(newRefreshToken), session.family_id, request.ip, request.headers['user-agent'] ?? null, config.jwt.refreshTokenExpiry],
    );

    await client.query('COMMIT');

    // Supabase-compatible response format
    reply.send({
      access_token: newAccessToken,
      token_type: 'bearer',
      expires_in: config.jwt.accessTokenExpiry,
      expires_at: Math.floor(Date.now() / 1000) + config.jwt.accessTokenExpiry,
      refresh_token: newRefreshToken,
      user: {
        id: session.user_id,
        aud: 'authenticated',
        email: session.email,
        role: session.role,
        app_metadata: { provider: 'email' },
        user_metadata: session.metadata || {},
        email_confirmed_at: session.email_confirmed ? session.created_at : null,
        last_sign_in_at: session.last_sign_in_at,
        created_at: session.created_at,
        updated_at: session.updated_at,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function projectSignoutHandler(request: FastifyRequest, reply: FastifyReply) {
  const db = request.projectDb!;

  if (request.userId) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE service_role`);
      await client.query(`DELETE FROM auth.sessions WHERE user_id = $1`, [request.userId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  reply.status(204).send();
}

export async function projectMeHandler(request: FastifyRequest, reply: FastifyReply) {
  if (!request.userId) {
    throw new UnauthorizedError();
  }

  const db = request.projectDb!;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE service_role`);

    const result = await client.query(
      `SELECT id, email, role, email_confirmed, is_disabled, metadata, created_at, updated_at, last_sign_in_at
       FROM auth.users WHERE id = $1`,
      [request.userId],
    );

    await client.query('COMMIT');

    if (result.rows.length === 0) {
      throw new UnauthorizedError('User not found');
    }

    const user = result.rows[0];

    // Supabase-compatible response format
    reply.send({
      id: user.id,
      aud: 'authenticated',
      email: user.email,
      role: user.role,
      app_metadata: { provider: 'email' },
      user_metadata: user.metadata || {},
      email_confirmed_at: user.email_confirmed ? user.created_at : null,
      created_at: user.created_at,
      updated_at: user.updated_at,
      last_sign_in_at: user.last_sign_in_at,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
