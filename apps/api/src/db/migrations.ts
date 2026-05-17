import type { PGliteStore } from './pglite-store.js';

// Bootstrap SQL executed once on a fresh Vibebase project database.
// Creates the auth schema (users + sessions) and a public schema for user data.
const BOOTSTRAP_SQL = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS public;

CREATE TABLE IF NOT EXISTS auth.users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'authenticated',
  email_confirmed BOOLEAN NOT NULL DEFAULT false,
  is_disabled BOOLEAN NOT NULL DEFAULT false,
  metadata    JSONB,
  last_sign_in_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  family_id   UUID NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON auth.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON auth.sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON auth.sessions(expires_at);

-- Vibebase metadata table to track schema version
CREATE TABLE IF NOT EXISTS auth._vibebase_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO auth._vibebase_meta (key, value)
  VALUES ('schema_version', '1')
  ON CONFLICT (key) DO NOTHING;
`;

export async function runBootstrapMigrations(store: PGliteStore): Promise<boolean> {
  // Check if already bootstrapped
  try {
    const result = await store.query<{ value: string }>(
      `SELECT value FROM auth._vibebase_meta WHERE key = 'schema_version'`,
    );
    if (result.rows.length > 0) return false; // Already bootstrapped
  } catch {
    // Table doesn't exist yet — run bootstrap
  }

  // PGLite's exec() runs multi-statement SQL
  const { PGlite } = await import('@electric-sql/pglite');
  void PGlite; // type-only import guard
  // Use the store's internal db by going through exec via a raw query sequence
  await runMultiStatement(store, BOOTSTRAP_SQL);
  return true;
}

async function runMultiStatement(store: PGliteStore, sql: string): Promise<void> {
  // Split on semicolons, filter empty, run each statement
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    await store.query(stmt);
  }
}
