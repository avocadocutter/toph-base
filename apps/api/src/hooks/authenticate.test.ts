import { describe, it, expect, beforeAll } from 'vitest';
import { authenticatePlatform, requirePlatformAdmin } from './authenticate.js';
import {
  initPlatformJwt,
  createPlatformAccessToken,
} from '../plugins/auth/jwt.js';
import { UnauthorizedError } from '../lib/errors.js';
import * as jose from 'jose';
import type { Config } from '../config.js';

const testConfig = {
  jwt: {
    platformSecret: 'test-platform-secret-that-is-long-enough-32chars',
    accessTokenExpiry: 3600,
    refreshTokenExpiry: 86400,
  },
} as unknown as Config;

beforeAll(() => {
  initPlatformJwt(testConfig);
});

function makeRequest(headers: Record<string, string> = {}): any {
  return {
    headers,
    platformPayload: undefined,
    platformUserId: undefined,
  };
}

const reply = {} as any;

describe('authenticatePlatform', () => {
  it('throws UnauthorizedError when Authorization header is missing', async () => {
    await expect(
      authenticatePlatform(makeRequest(), reply),
    ).rejects.toThrow(UnauthorizedError);

    await expect(
      authenticatePlatform(makeRequest(), reply),
    ).rejects.toThrow('Missing or invalid authorization header');
  });

  it('throws UnauthorizedError when Authorization header is not a Bearer token', async () => {
    await expect(
      authenticatePlatform(makeRequest({ authorization: 'Basic dXNlcjpwYXNz' }), reply),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when the Bearer token is signed with the wrong secret', async () => {
    const wrongSecret = new TextEncoder().encode('completely-different-secret-32ch');
    const badToken = await new jose.SignJWT({ sub: 'u1', role: 'admin', type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('toph-platform')
      .setExpirationTime('1h')
      .sign(wrongSecret);

    await expect(
      authenticatePlatform(makeRequest({ authorization: `Bearer ${badToken}` }), reply),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('sets platformPayload and platformUserId on the request when the token is valid', async () => {
    const token = await createPlatformAccessToken('user-999', 'admin@example.com', testConfig);
    const request = makeRequest({ authorization: `Bearer ${token}` });

    await authenticatePlatform(request, reply);

    expect(request.platformUserId).toBe('user-999');
    expect(request.platformPayload).toBeDefined();
    expect(request.platformPayload.role).toBe('admin');
  });
});

describe('requirePlatformAdmin', () => {
  it('throws UnauthorizedError when the token role is not admin', async () => {
    const secret = new TextEncoder().encode(testConfig.jwt.platformSecret);
    const nonAdminToken = await new jose.SignJWT({ sub: 'u1', role: 'viewer', type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('toph-platform')
      .setExpirationTime('1h')
      .sign(secret);

    const request = makeRequest({ authorization: `Bearer ${nonAdminToken}` });

    await expect(
      requirePlatformAdmin(request, reply),
    ).rejects.toThrow('Platform admin access required');
  });

  it('passes when the token has admin role', async () => {
    const token = await createPlatformAccessToken('admin-1', 'admin@example.com', testConfig);
    const request = makeRequest({ authorization: `Bearer ${token}` });

    await expect(requirePlatformAdmin(request, reply)).resolves.toBeUndefined();
  });
});
