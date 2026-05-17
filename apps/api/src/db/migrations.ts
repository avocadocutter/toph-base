import type { PGliteStore } from './pglite-store.js';

const SETUP_SQL = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'authenticated',
  email_confirmed   BOOLEAN NOT NULL DEFAULT false,
  is_disabled       BOOLEAN NOT NULL DEFAULT false,
  metadata          JSONB,
  last_sign_in_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token_hash  TEXT NOT NULL UNIQUE,
  family_id           UUID NOT NULL,
  ip_address          TEXT,
  user_agent          TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx   ON auth.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON auth.sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON auth.sessions(expires_at);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
      NULLIF(current_setting('request.jwt.claim.sub', true), ''),
      current_setting('request.jwt.claims', true)::jsonb->>'sub'
    )::uuid
  $$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
      NULLIF(current_setting('request.jwt.claim.role', true), ''),
      current_setting('request.jwt.claims', true)::jsonb->>'role',
      'anon'
    )
  $$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
      NULLIF(current_setting('request.jwt.claim.email', true), ''),
      current_setting('request.jwt.claims', true)::jsonb->>'email'
    )
  $$;
`;

export async function runBootstrapMigrations(store: PGliteStore): Promise<void> {
  await store.exec(SETUP_SQL);
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
