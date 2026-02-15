import { z } from 'zod';

const configSchema = z.object({
  postgres: z.object({
    host: z.string().default('localhost'),
    port: z.coerce.number().default(5432),
    database: z.string().default('toph'),
    user: z.string().default('toph_admin'),
    password: z.string().default('changeme'),
  }),
  jwt: z.object({
    platformSecret: z.string().min(32).default('change-this-to-a-random-string-at-least-32-chars'),
    accessTokenExpiry: z.coerce.number().default(3600),
    refreshTokenExpiry: z.coerce.number().default(604800),
  }),
  admin: z.object({
    email: z.string().email().default('admin@toph.local'),
    password: z.string().min(8).default('changeme'),
  }),
  server: z.object({
    port: z.coerce.number().default(8000),
    host: z.string().default('0.0.0.0'),
    logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  }),
  cors: z.object({
    allowedOrigins: z.string().default('http://localhost:3000'),
  }),
  rateLimit: z.object({
    auth: z.coerce.number().default(5),
    api: z.coerce.number().default(100),
  }),
  features: z.object({
    enableSignup: z.coerce.boolean().default(true),
    requireAuthForApi: z.coerce.boolean().default(true),
  }),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const env = process.env;
  return configSchema.parse({
    postgres: {
      host: env.POSTGRES_HOST,
      port: env.POSTGRES_PORT,
      database: env.POSTGRES_DB,
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
    },
    jwt: {
      platformSecret: env.JWT_PLATFORM_SECRET ?? env.JWT_SECRET,
      accessTokenExpiry: env.ACCESS_TOKEN_EXPIRY,
      refreshTokenExpiry: env.REFRESH_TOKEN_EXPIRY,
    },
    admin: {
      email: env.ADMIN_EMAIL,
      password: env.ADMIN_PASSWORD,
    },
    server: {
      port: env.GATEWAY_PORT,
      host: env.GATEWAY_HOST,
      logLevel: env.LOG_LEVEL,
    },
    cors: {
      allowedOrigins: env.CORS_ALLOWED_ORIGINS,
    },
    rateLimit: {
      auth: env.RATE_LIMIT_AUTH,
      api: env.RATE_LIMIT_API,
    },
    features: {
      enableSignup: env.ENABLE_SIGNUP,
      requireAuthForApi: env.REQUIRE_AUTH_FOR_API,
    },
  });
}
