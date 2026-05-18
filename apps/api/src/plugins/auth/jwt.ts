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
    .setIssuer(`tophbase:${projectRef}`)
    .sign(secretKey);
}

export async function verifyProjectAccessToken(
  token: string,
  projectRef: string,
  jwtSecret: string,
): Promise<ProjectJwtPayload> {
  const secretKey = new TextEncoder().encode(jwtSecret);
  const { payload } = await jose.jwtVerify(token, secretKey, {
    issuer: `tophbase:${projectRef}`,
  });
  return payload as unknown as ProjectJwtPayload;
}

export function generateProjectJwtSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Publishable key — JWT with role=anon, compatible with Supabase createClient()
export async function generatePublishableKey(jwtSecret: string): Promise<string> {
  const key = new TextEncoder().encode(jwtSecret);
  return new jose.SignJWT({ role: 'anon' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer('supabase')
    .setExpirationTime('100y')
    .sign(key);
}

// Secret key — JWT with role=service_role, server-side only, bypasses RLS
export async function generateSecretKey(jwtSecret: string): Promise<string> {
  const key = new TextEncoder().encode(jwtSecret);
  return new jose.SignJWT({ role: 'service_role' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer('supabase')
    .setExpirationTime('100y')
    .sign(key);
}

// ── Shared utilities ──

export async function createRefreshToken(): Promise<string> {
  return crypto.randomBytes(64).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
