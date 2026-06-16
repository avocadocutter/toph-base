-- Template SQL run against each new project database
-- This sets up the standard project environment in the public schema

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Auth schema — mirrors Supabase's auth schema so migrations written for Supabase
-- work locally without changes. Backed by the request.jwt.claims session variable
-- that executeWithRlsContext sets before every query.
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$
    SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$
    SELECT NULLIF(auth.jwt() ->> 'sub', '')::uuid
  $$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE
  AS $$
    SELECT NULLIF(auth.jwt() ->> 'role', '')
  $$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
  LANGUAGE sql STABLE
  AS $$
    SELECT NULLIF(auth.jwt() ->> 'email', '')
  $$;

-- Create roles if they don't exist (ignore errors if they already exist on the cluster)
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

-- Grant default privileges on public schema
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

-- auth.users — canonical user table, written to by the auth service (mirrors Supabase)
CREATE TABLE IF NOT EXISTS auth.users (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             text UNIQUE NOT NULL,
  password_hash     text NOT NULL,
  role              text NOT NULL DEFAULT 'authenticated',
  email_confirmed   boolean DEFAULT false,
  is_disabled       boolean DEFAULT false,
  metadata          jsonb DEFAULT '{}',
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  last_sign_in_at   timestamptz
);

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.users FORCE ROW LEVEL SECURITY;

GRANT SELECT ON auth.users TO anon;
GRANT ALL ON auth.users TO authenticated;
GRANT ALL ON auth.users TO service_role;

-- auth.sessions — managed by the auth service
CREATE TABLE IF NOT EXISTS auth.sessions (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token_hash  text NOT NULL,
  family_id           text NOT NULL,
  ip_address          text,
  user_agent          text,
  created_at          timestamptz DEFAULT now(),
  expires_at          timestamptz NOT NULL
);

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.sessions FORCE ROW LEVEL SECURITY;

GRANT ALL ON auth.sessions TO service_role;

-- DDL event trigger for schema change notification
CREATE OR REPLACE FUNCTION public.notify_schema_change() RETURNS event_trigger AS $$
BEGIN
  PERFORM pg_notify('toph_schema_change', current_database());
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'toph_ddl_trigger') THEN
    CREATE EVENT TRIGGER toph_ddl_trigger ON ddl_command_end
      EXECUTE FUNCTION public.notify_schema_change();
  END IF;
END
$$;
