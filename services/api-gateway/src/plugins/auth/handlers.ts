import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const signinSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});
import { hashPassword, verifyPassword } from './password.js';
import { createAccessToken, createRefreshToken, hashRefreshToken } from './jwt.js';
import { BadRequestError, ConflictError, UnauthorizedError } from '../../lib/errors.js';
import crypto from 'node:crypto';

export async function signupHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = signupSchema.parse(request.body);
  const { email, password } = body;
  const db = request.server.db;
  const config = request.server.config;

  if (!config.features.enableSignup) {
    throw new BadRequestError('Signups are currently disabled');
  }

  // Check existing user
  const existing = await db.query(
    'SELECT id FROM toph_internal.users WHERE email = $1',
    [email],
  );
  if (existing.rows.length > 0) {
    throw new ConflictError('User with this email already exists');
  }

  const passwordHash = await hashPassword(password);
  const result = await db.query(
    `INSERT INTO toph_internal.users (email, password_hash, role)
     VALUES ($1, $2, 'authenticated')
     RETURNING id, email, role, email_confirmed, is_disabled, created_at, updated_at`,
    [email, passwordHash],
  );

  const user = result.rows[0];
  const accessToken = await createAccessToken(user.id, user.email, user.role, config);
  const refreshToken = await createRefreshToken();
  const familyId = crypto.randomUUID();

  await db.query(
    `INSERT INTO toph_internal.sessions (user_id, refresh_token_hash, family_id, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
    [user.id, hashRefreshToken(refreshToken), familyId, request.ip, request.headers['user-agent'] ?? null, config.jwt.refreshTokenExpiry],
  );

  reply.status(201).send({
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
      lastSignInAt: null,
    },
  });
}

export async function signinHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = signinSchema.parse(request.body);
  const { email, password } = body;
  const db = request.server.db;
  const config = request.server.config;

  const result = await db.query(
    'SELECT id, email, password_hash, role, is_disabled, email_confirmed, created_at, updated_at, last_sign_in_at FROM toph_internal.users WHERE email = $1',
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

  // Update last sign in
  await db.query(
    'UPDATE toph_internal.users SET last_sign_in_at = now() WHERE id = $1',
    [user.id],
  );

  const accessToken = await createAccessToken(user.id, user.email, user.role, config);
  const refreshToken = await createRefreshToken();
  const familyId = crypto.randomUUID();

  await db.query(
    `INSERT INTO toph_internal.sessions (user_id, refresh_token_hash, family_id, ip_address, user_agent, expires_at)
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

export async function refreshHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { refreshToken: string };
  if (!body?.refreshToken) {
    throw new BadRequestError('Refresh token is required');
  }

  const db = request.server.db;
  const config = request.server.config;
  const tokenHash = hashRefreshToken(body.refreshToken);

  // Find the session
  const sessionResult = await db.query(
    `SELECT s.id, s.user_id, s.family_id, s.expires_at, u.email, u.role, u.is_disabled
     FROM toph_internal.sessions s
     JOIN toph_internal.users u ON s.user_id = u.id
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

  // Rotate: delete old session, create new one
  await db.query('DELETE FROM toph_internal.sessions WHERE id = $1', [session.id]);

  const newAccessToken = await createAccessToken(session.user_id, session.email, session.role, config);
  const newRefreshToken = await createRefreshToken();

  await db.query(
    `INSERT INTO toph_internal.sessions (user_id, refresh_token_hash, family_id, ip_address, user_agent, expires_at)
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

export async function signoutHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { refreshToken?: string };
  const db = request.server.db;

  if (body?.refreshToken) {
    const tokenHash = hashRefreshToken(body.refreshToken);
    await db.query('DELETE FROM toph_internal.sessions WHERE refresh_token_hash = $1', [tokenHash]);
  }

  reply.status(204).send();
}

export async function meHandler(request: FastifyRequest, reply: FastifyReply) {
  if (!request.userId) {
    throw new UnauthorizedError();
  }

  const db = request.server.db;
  const result = await db.query(
    `SELECT id, email, role, email_confirmed, is_disabled, metadata, created_at, updated_at, last_sign_in_at
     FROM toph_internal.users WHERE id = $1`,
    [request.userId],
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
