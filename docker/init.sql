-- Toph-Base Database Initialization
-- This runs on first boot only (when the data volume is empty)

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create internal schemas
CREATE SCHEMA IF NOT EXISTS toph_internal;

-- Grant toph_admin full access to the internal schema
GRANT ALL ON SCHEMA toph_internal TO toph_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA toph_internal GRANT ALL ON TABLES TO toph_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA toph_internal GRANT ALL ON SEQUENCES TO toph_admin;

-- Create PostgreSQL roles for API access
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO service_role;

-- Default privileges for new tables in public schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

-- Grant the API roles to the toph_admin user so it can SET ROLE
GRANT anon, authenticated, service_role TO toph_admin;

-- Users table
CREATE TABLE IF NOT EXISTS toph_internal.users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'authenticated' CHECK (role IN ('admin', 'authenticated')),
    email_confirmed BOOLEAN NOT NULL DEFAULT false,
    is_disabled     BOOLEAN NOT NULL DEFAULT false,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_sign_in_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON toph_internal.users (email);

-- Sessions / refresh tokens
CREATE TABLE IF NOT EXISTS toph_internal.sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES toph_internal.users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    family_id          UUID NOT NULL,
    ip_address         INET,
    user_agent         TEXT,
    expires_at         TIMESTAMPTZ NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON toph_internal.sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_family_id ON toph_internal.sessions (family_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON toph_internal.sessions (expires_at);

-- Rate limiting
CREATE TABLE IF NOT EXISTS toph_internal.login_attempts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address   INET NOT NULL,
    email        TEXT NOT NULL,
    success      BOOLEAN NOT NULL DEFAULT false,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON toph_internal.login_attempts (ip_address, attempted_at);

-- Platform settings
CREATE TABLE IF NOT EXISTS toph_internal.settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auth helper functions (accessible from RLS policies)
CREATE OR REPLACE FUNCTION auth_uid()
RETURNS UUID AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth_role()
RETURNS TEXT AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '');
$$ LANGUAGE sql STABLE;

-- Schema change notification trigger
CREATE OR REPLACE FUNCTION toph_notify_schema_change()
RETURNS event_trigger AS $$
BEGIN
    PERFORM pg_notify('toph_schema_change', TG_TAG);
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_event_trigger WHERE evtname = 'toph_ddl_trigger'
  ) THEN
    CREATE EVENT TRIGGER toph_ddl_trigger
      ON ddl_command_end
      EXECUTE FUNCTION toph_notify_schema_change();
  END IF;
END
$$;
