import * as jose from 'jose';
import type { ProjectJwtPayload } from '../../types/fastify.js';
import crypto from 'node:crypto';

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
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .setIssuer(`vibebase:${projectRef}`)
    .sign(secretKey);
}

export async function verifyProjectAccessToken(
  token: string,
  projectRef: string,
  jwtSecret: string,
): Promise<ProjectJwtPayload> {
  const secretKey = new TextEncoder().encode(jwtSecret);
  const { payload } = await jose.jwtVerify(token, secretKey, {
    issuer: `vibebase:${projectRef}`,
  });
  return payload as unknown as ProjectJwtPayload;
}

export function generateProjectJwtSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Publishable key — safe to include in client-side code, used with createClient()
export function generatePublishableKey(): string {
  return `vb_publishable_${crypto.randomBytes(24).toString('hex')}`;
}

// Secret key — server-side only, bypasses RLS
export function generateSecretKey(): string {
  return `vb_secret_${crypto.randomBytes(24).toString('hex')}`;
}

// ── Shared utilities ──

export async function createRefreshToken(): Promise<string> {
  return crypto.randomBytes(64).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
