-- Migration: Add PostgREST authenticator role
--
-- PostgREST security model:
-- - PostgREST connects as 'authenticator' (a low-privilege role)
-- - For each request, PostgREST uses SET ROLE to switch to anon/authenticated/service_role
-- - The authenticator role itself has NO direct permissions on tables
-- - All permissions come from the role it switches to (anon, authenticated, service_role)
--
-- SECURITY: Change the authenticator password in production!

-- Create authenticator role if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    -- LOGIN: PostgREST needs to connect as this role
    -- NOINHERIT: Prevents automatic inheritance of granted roles (forces explicit SET ROLE)
    -- No SUPERUSER, CREATEDB, CREATEROLE, or BYPASSRLS - this is a restricted role
    CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'changeme';
  END IF;
END
$$;

-- Grant authenticator the ability to switch to API roles
-- This allows: SET ROLE anon / SET ROLE authenticated / SET ROLE service_role
GRANT anon, authenticated, service_role TO authenticator;

-- Grant connect permission to the database
GRANT CONNECT ON DATABASE toph TO authenticator;

-- Grant usage on toph_internal schema (needed to call auth helper functions like auth_uid())
GRANT USAGE ON SCHEMA toph_internal TO authenticator;

-- Grant authenticator USAGE on all existing project schemas
-- USAGE on schema is safe - actual table permissions come from the role it switches to
DO $$
DECLARE
  schema_rec RECORD;
BEGIN
  FOR schema_rec IN
    SELECT schema_name
    FROM toph_internal.projects
    WHERE status = 'active'
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticator', schema_rec.schema_name);
  END LOOP;
END
$$;

-- Update the provision_project_schema function to grant usage to authenticator on new schemas
CREATE OR REPLACE FUNCTION toph_internal.provision_project_schema(p_schema_name TEXT)
RETURNS void AS $$
BEGIN
    -- Create the schema
    EXECUTE format('CREATE SCHEMA %I', p_schema_name);

    -- Grant usage to API roles AND authenticator
    -- authenticator needs USAGE to access the schema, then will SET ROLE to anon/authenticated/service_role
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated, service_role, authenticator', p_schema_name);
    EXECUTE format('GRANT ALL ON SCHEMA %I TO service_role', p_schema_name);

    -- Default privileges for new tables in this schema
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO anon', p_schema_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO authenticated', p_schema_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO service_role', p_schema_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO authenticated', p_schema_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON SEQUENCES TO service_role', p_schema_name);

    -- Create project-scoped users table
    EXECUTE format('CREATE TABLE %I.users (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email           TEXT NOT NULL UNIQUE,
        password_hash   TEXT NOT NULL,
        role            TEXT NOT NULL DEFAULT ''authenticated'',
        email_confirmed BOOLEAN NOT NULL DEFAULT false,
        is_disabled     BOOLEAN NOT NULL DEFAULT false,
        metadata        JSONB DEFAULT ''{}'',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_sign_in_at TIMESTAMPTZ
    )', p_schema_name);

    EXECUTE format('CREATE INDEX ON %I.users (email)', p_schema_name);

    -- Create project-scoped sessions table
    EXECUTE format('CREATE TABLE %I.sessions (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id            UUID NOT NULL REFERENCES %I.users(id) ON DELETE CASCADE,
        refresh_token_hash TEXT NOT NULL,
        family_id          UUID NOT NULL,
        ip_address         INET,
        user_agent         TEXT,
        expires_at         TIMESTAMPTZ NOT NULL,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        rotated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )', p_schema_name, p_schema_name);

    EXECUTE format('CREATE INDEX ON %I.sessions (user_id)', p_schema_name);
    EXECUTE format('CREATE INDEX ON %I.sessions (expires_at)', p_schema_name);

    -- Enable RLS on auth tables
    EXECUTE format('ALTER TABLE %I.users ENABLE ROW LEVEL SECURITY', p_schema_name);
    EXECUTE format('ALTER TABLE %I.users FORCE ROW LEVEL SECURITY', p_schema_name);
    EXECUTE format('ALTER TABLE %I.sessions ENABLE ROW LEVEL SECURITY', p_schema_name);
    EXECUTE format('ALTER TABLE %I.sessions FORCE ROW LEVEL SECURITY', p_schema_name);

    -- service_role bypass policies
    EXECUTE format('CREATE POLICY service_role_users ON %I.users TO service_role USING (true) WITH CHECK (true)', p_schema_name);
    EXECUTE format('CREATE POLICY service_role_sessions ON %I.sessions TO service_role USING (true) WITH CHECK (true)', p_schema_name);

    -- Revoke direct access to auth tables from anon/authenticated
    EXECUTE format('REVOKE ALL ON %I.users FROM anon, authenticated', p_schema_name);
    EXECUTE format('REVOKE ALL ON %I.sessions FROM anon, authenticated', p_schema_name);
END;
$$ LANGUAGE plpgsql;

-- Security notes:
-- 1. authenticator role has NO direct permissions on any tables
-- 2. It can only access tables by doing SET ROLE to anon/authenticated/service_role
-- 3. NOINHERIT flag prevents automatic permission inheritance
-- 4. All table-level permissions are controlled by the role it switches to
-- 5. This follows the standard PostgREST security model
