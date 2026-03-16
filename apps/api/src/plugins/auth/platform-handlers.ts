import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { verifyPassword } from './password.js';
import { createPlatformAccessToken, createRefreshToken, hashRefreshToken } from './jwt.js';
import { BadRequestError, UnauthorizedError } from '../../lib/errors.js';
import crypto from 'node:crypto';

const signinSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export async function platformSigninHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = signinSchema.parse(request.body);
  const { email, password } = body;
  const db = request.server.db;
  const config = request.server.config;

  const result = await db.query(
    `SELECT id, email, password_hash, role, is_disabled, email_confirmed, created_at, updated_at, last_sign_in_at
     FROM toph_internal.platform_users WHERE email = $1`,
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

  await db.query(
    'UPDATE toph_internal.platform_users SET last_sign_in_at = now() WHERE id = $1',
    [user.id],
  );

  const accessToken = await createPlatformAccessToken(user.id, user.email, config);
  const refreshToken = await createRefreshToken();
  const familyId = crypto.randomUUID();

  await db.query(
    `INSERT INTO toph_internal.platform_sessions (user_id, refresh_token_hash, family_id, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
    [user.id, hashRefreshToken(refreshToken), familyId, request.ip, request.headers['user-agent'] ?? null, config.jwt.refreshTokenExpiry],
  );

  reply.send({
    tokens: {
      accessToken,
      refreshToken,
      expiresIn: config.jwt.accessTokenExpiry,
      tokenType: 'Bearer',
    },
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      emailConfirmed: user.email_confirmed,
      isDisabled: user.is_disabled,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      lastSignInAt: user.last_sign_in_at,
    },
  });
}

export async function platformRefreshHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { refreshToken: string };
  if (!body?.refreshToken) {
    throw new BadRequestError('Refresh token is required');
  }

  const db = request.server.db;
  const config = request.server.config;
  const tokenHash = hashRefreshToken(body.refreshToken);

  const sessionResult = await db.query(
    `SELECT s.id, s.user_id, s.family_id, s.expires_at, u.email, u.role, u.is_disabled
     FROM toph_internal.platform_sessions s
     JOIN toph_internal.platform_users u ON s.user_id = u.id
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

  await db.query('DELETE FROM toph_internal.platform_sessions WHERE id = $1', [session.id]);

  const newAccessToken = await createPlatformAccessToken(session.user_id, session.email, config);
  const newRefreshToken = await createRefreshToken();

  await db.query(
    `INSERT INTO toph_internal.platform_sessions (user_id, refresh_token_hash, family_id, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
    [session.user_id, hashRefreshToken(newRefreshToken), session.family_id, request.ip, request.headers['user-agent'] ?? null, config.jwt.refreshTokenExpiry],
  );

  reply.send({
    tokens: {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: config.jwt.accessTokenExpiry,
      tokenType: 'Bearer',
    },
  });
}

export async function platformSignoutHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { refreshToken?: string };
  const db = request.server.db;

  if (body?.refreshToken) {
    const tokenHash = hashRefreshToken(body.refreshToken);
    await db.query('DELETE FROM toph_internal.platform_sessions WHERE refresh_token_hash = $1', [tokenHash]);
  }

  reply.status(204).send();
}

export async function platformMeHandler(request: FastifyRequest, reply: FastifyReply) {
  if (!request.platformUserId) {
    throw new UnauthorizedError();
  }

  const db = request.server.db;
  const result = await db.query(
    `SELECT id, email, role, email_confirmed, is_disabled, metadata, created_at, updated_at, last_sign_in_at
     FROM toph_internal.platform_users WHERE id = $1`,
    [request.platformUserId],
  );

  if (result.rows.length === 0) {
    throw new UnauthorizedError('User not found');
  }

  const user = result.rows[0];
  reply.send({
    id: user.id,
    email: user.email,
    role: user.role,
    emailConfirmed: user.email_confirmed,
    isDisabled: user.is_disabled,
    metadata: user.metadata,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastSignInAt: user.last_sign_in_at,
  });
}
