import path from 'node:path';
import os from 'node:os';
import type { ProjectConfig } from './lib/project-config.js';

export interface Config {
  project: {
    name: string;
    dataDir: string;
    jwtSecret: string;
    publishableKey: string;
    secretKey: string;
  };
  jwt: {
    accessTokenExpiry: number;
    refreshTokenExpiry: number;
  };
  server: {
    port: number;
    host: string;
    logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  };
  cors: { allowedOrigins: string };
  rateLimit: { auth: number; api: number };
  features: { requireAuthForApi: boolean };
  storage: { maxFileSizeBytes: number };
  functions: { dir: string | null };
  nodeFunctions: { dir: string | null };
  admin: {
    username: string;
    // Set when the password is stored hashed in config.json.
    passwordHash: string | null;
    // Set when TOPHBASE_ADMIN_PASSWORD is provided as an env var (e.g. Railway
    // variables) — compared with a timing-safe string comparison instead.
    passwordPlain: string | null;
  };
}

function defaultDataDir(name: string): string {
  return path.join(os.homedir(), '.tophbase', 'projects', name);
}

export function buildConfig(projectConfig: ProjectConfig, projectName = 'default'): Config {
  const env = process.env;
  const dataDir = env.TOPHBASE_DATA_DIR ?? defaultDataDir(projectName);
  return {
    project: {
      name: projectName,
      dataDir,
      jwtSecret: env.TOPHBASE_JWT_SECRET ?? projectConfig.jwtSecret,
      publishableKey: env.TOPHBASE_PUBLISHABLE_KEY ?? projectConfig.publishableKey,
      secretKey: env.TOPHBASE_SECRET_KEY ?? projectConfig.secretKey,
    },
    jwt: {
      accessTokenExpiry: Number(env.ACCESS_TOKEN_EXPIRY ?? 3600),
      refreshTokenExpiry: Number(env.REFRESH_TOKEN_EXPIRY ?? 604800),
    },
    server: {
      port: Number(env.TOPHBASE_PORT),
      host: env.TOPHBASE_HOST ?? '127.0.0.1',
      logLevel: (env.LOG_LEVEL as Config['server']['logLevel']) ?? 'info',
    },
    cors: { allowedOrigins: env.CORS_ALLOWED_ORIGINS ?? '*' },
    rateLimit: {
      auth: Number(env.RATE_LIMIT_AUTH ?? 10),
      api: Number(env.RATE_LIMIT_API ?? 1000),
    },
    features: { requireAuthForApi: env.REQUIRE_AUTH_FOR_API === 'true' },
    storage: {
      maxFileSizeBytes: Number(env.STORAGE_MAX_FILE_SIZE_BYTES ?? 52_428_800), // 50 MB
    },
    functions: {
      dir: env.TOPHBASE_FUNCTIONS_DIR ?? null,
    },
    nodeFunctions: {
      dir: env.TOPHBASE_NODE_FUNCTIONS_DIR ?? null,
    },
    admin: {
      username: env.TOPHBASE_ADMIN_USERNAME ?? projectConfig.adminUsername ?? 'admin',
      passwordHash: env.TOPHBASE_ADMIN_PASSWORD ? null : (projectConfig.adminPasswordHash ?? null),
      passwordPlain: env.TOPHBASE_ADMIN_PASSWORD ?? null,
    },
  };
}
