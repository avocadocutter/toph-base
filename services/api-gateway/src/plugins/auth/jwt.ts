import * as jose from 'jose';
import type { JwtPayload } from '../../types/fastify.js';
import type { Config } from '../../config.js';
import crypto from 'node:crypto';

let secretKey: Uint8Array;

export function initJwt(config: Config) {
  secretKey = new TextEncoder().encode(config.jwt.secret);
}

export async function createAccessToken(
  userId: string,
  email: string,
  role: string,
  config: Config,
): Promise<string> {
  return new jose.SignJWT({
    sub: userId,
    email,
    role,
    type: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.jwt.accessTokenExpiry}s`)
    .setIssuer('toph-base')
    .sign(secretKey);
}

export async function createRefreshToken(): Promise<string> {
  return crypto.randomBytes(64).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const { payload } = await jose.jwtVerify(token, secretKey, {
    issuer: 'toph-base',
  });
  return payload as unknown as JwtPayload;
}
