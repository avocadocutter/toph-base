import * as jose from 'jose';
import type { PlatformJwtPayload, ProjectJwtPayload } from '../../types/fastify.js';
import type { Config } from '../../config.js';
import crypto from 'node:crypto';

let platformSecretKey: Uint8Array;

export function initPlatformJwt(config: Config) {
  platformSecretKey = new TextEncoder().encode(config.jwt.platformSecret);
}

// ── Platform JWT ──

export async function createPlatformAccessToken(
  userId: string,
  email: string,
  config: Config,
): Promise<string> {
  return new jose.SignJWT({
    sub: userId,
    email,
    role: 'admin',
    type: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.jwt.accessTokenExpiry}s`)
    .setIssuer('toph-platform')
    .sign(platformSecretKey);
}

export async function verifyPlatformAccessToken(token: string): Promise<PlatformJwtPayload> {
  const { payload } = await jose.jwtVerify(token, platformSecretKey, {
    issuer: 'toph-platform',
  });
  return payload as unknown as PlatformJwtPayload;
}

// ── Project JWT ──

export async function createProjectAccessToken(
  userId: string,
  email: string,
  role: string,
  projectRef: string,
  jwtSecret: string,
  expiresIn: number,
): Promise<string> {
  const secretKey = new TextEncoder().encode(jwtSecret);
  return new jose.SignJWT({
    sub: userId,
    email,
    role,
    type: 'access',
    project_ref: projectRef,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .setIssuer(`toph-project:${projectRef}`)
    .sign(secretKey);
}

export async function verifyProjectAccessToken(
  token: string,
  projectRef: string,
  jwtSecret: string,
): Promise<ProjectJwtPayload> {
  const secretKey = new TextEncoder().encode(jwtSecret);
  const { payload } = await jose.jwtVerify(token, secretKey, {
    issuer: `toph-project:${projectRef}`,
  });
  return payload as unknown as ProjectJwtPayload;
}

// ── API Keys (long-lived pre-signed JWTs) ──

export async function generateApiKey(
  role: 'anon' | 'service_role',
  projectRef: string,
  jwtSecret: string,
): Promise<string> {
  const secretKey = new TextEncoder().encode(jwtSecret);
  return new jose.SignJWT({
    sub: '00000000-0000-0000-0000-000000000000',
    role,
    type: 'access',
    project_ref: projectRef,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10y')
    .setIssuer(`toph-project:${projectRef}`)
    .sign(secretKey);
}

export function generateProjectJwtSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ── New API Key Generation (Supabase-compatible sb_publishable_*, sb_secret_*) ──

export function generatePublishableKey(): string {
  // sb_publishable_ + 40 hex characters (20 bytes)
  return `sb_publishable_${crypto.randomBytes(20).toString('hex')}`;
}

export function generateSecretKey(): string {
  // sb_secret_ + 40 hex characters (20 bytes)
  return `sb_secret_${crypto.randomBytes(20).toString('hex')}`;
}

export function isNewFormatKey(key: string): boolean {
  return key.startsWith('sb_publishable_') || key.startsWith('sb_secret_');
}

export function getKeyPrefix(key: string): 'publishable' | 'secret' | null {
  if (key.startsWith('sb_publishable_')) return 'publishable';
  if (key.startsWith('sb_secret_')) return 'secret';
  return null;
}

// ── Shared utilities ──

export async function createRefreshToken(): Promise<string> {
  return crypto.randomBytes(64).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
