import { describe, it, expect, beforeAll } from 'vitest';
import {
  initPlatformJwt,
  createPlatformAccessToken,
  verifyPlatformAccessToken,
  createProjectAccessToken,
  verifyProjectAccessToken,
  generatePublishableKey,
  generateSecretKey,
  isNewFormatKey,
  getKeyPrefix,
  hashRefreshToken,
} from './jwt.js';
import type { Config } from '../../config.js';

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

describe('platform JWT', () => {
  it('rejects a platform token signed with the wrong secret', async () => {
    const wrongConfig = {
      jwt: { ...testConfig.jwt, platformSecret: 'completely-different-secret-32ch' },
    } as unknown as Config;
    initPlatformJwt(wrongConfig);
    const badToken = await createPlatformAccessToken('user-1', 'user@example.com', wrongConfig);

    // Re-init with correct secret before verifying
    initPlatformJwt(testConfig);

    await expect(verifyPlatformAccessToken(badToken)).rejects.toThrow();
  });

  it('issues and verifies a valid platform access token with correct claims', async () => {
    const token = await createPlatformAccessToken('user-123', 'admin@example.com', testConfig);
    const payload = await verifyPlatformAccessToken(token);

    expect(payload.sub).toBe('user-123');
    expect(payload.email).toBe('admin@example.com');
    expect(payload.role).toBe('admin');
    expect(payload.type).toBe('access');
  });
});

describe('key utilities', () => {
  it('returns false for isNewFormatKey when the key has no recognised prefix', () => {
    expect(isNewFormatKey('legacy_key_abc123')).toBe(false);
    expect(isNewFormatKey('')).toBe(false);
    expect(isNewFormatKey('eyJhbGciOiJIUzI1NiJ9')).toBe(false);
  });

  it('recognises sb_publishable_ and sb_secret_ as new-format keys', () => {
    expect(isNewFormatKey('sb_publishable_abc')).toBe(true);
    expect(isNewFormatKey('sb_secret_abc')).toBe(true);
  });

  it('returns correct prefix type from getKeyPrefix', () => {
    expect(getKeyPrefix('sb_publishable_abc')).toBe('publishable');
    expect(getKeyPrefix('sb_secret_abc')).toBe('secret');
    expect(getKeyPrefix('legacy_key')).toBeNull();
  });

  it('generates a publishable key with the correct prefix and 40-char hex suffix', () => {
    const key = generatePublishableKey();
    expect(key).toMatch(/^sb_publishable_[0-9a-f]{40}$/);
  });

  it('generates a secret key with the correct prefix and 40-char hex suffix', () => {
    const key = generateSecretKey();
    expect(key).toMatch(/^sb_secret_[0-9a-f]{40}$/);
  });

  it('generates unique keys on each call', () => {
    expect(generatePublishableKey()).not.toBe(generatePublishableKey());
    expect(generateSecretKey()).not.toBe(generateSecretKey());
  });

  it('produces a consistent sha256 hash for hashRefreshToken', () => {
    const hash1 = hashRefreshToken('my-token');
    const hash2 = hashRefreshToken('my-token');
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken('different-token')).not.toBe(hash1);
  });
});

describe('project JWT', () => {
  const projectRef = 'proj_abc123';
  const jwtSecret = 'project-jwt-secret-that-is-32-ch';

  it('rejects a project token when the issuer project_ref does not match', async () => {
    const token = await createProjectAccessToken(
      'user-1', 'user@example.com', 'member', projectRef, jwtSecret, 3600,
    );

    await expect(
      verifyProjectAccessToken(token, 'proj_other', jwtSecret),
    ).rejects.toThrow();
  });

  it('issues and verifies a valid project token with correct claims', async () => {
    const token = await createProjectAccessToken(
      'user-456', 'member@example.com', 'member', projectRef, jwtSecret, 3600,
    );
    const payload = await verifyProjectAccessToken(token, projectRef, jwtSecret);

    expect(payload.sub).toBe('user-456');
    expect(payload.role).toBe('member');
    expect(payload.project_ref).toBe(projectRef);
    expect(payload.type).toBe('access');
  });
});
