-- FIRST TIME !!!!!
-- CREATE ROLE toph LOGIN PASSWORD 'changeit';

-- Toph-Base Database Initialization
-- Multi-tenant schema-per-project architecture

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create internal schema
CREATE SCHEMA IF NOT EXISTS toph_internal;

-- Grant toph the ability to create schemas (for project provisioning)
GRANT CREATE ON DATABASE toph TO toph;

-- Grant toph full access to internal schema
GRANT ALL ON SCHEMA toph_internal TO toph;
ALTER DEFAULT PRIVILEGES IN SCHEMA toph_internal GRANT ALL ON TABLES TO toph;
ALTER DEFAULT PRIVILEGES IN SCHEMA toph_internal GRANT ALL ON SEQUENCES TO toph;

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

-- Grant the API roles to toph so it can SET ROLE
GRANT anon, authenticated, service_role TO toph;

-- ============================================================
-- Platform tables (admin users, projects)
-- ============================================================

-- Platform admin users
CREATE TABLE toph_internal.platform_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'admin' CHECK (role = 'admin'),
    email_confirmed BOOLEAN NOT NULL DEFAULT false,
    is_disabled     BOOLEAN NOT NULL DEFAULT false,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_sign_in_at TIMESTAMPTZ
);

CREATE INDEX idx_platform_users_email ON toph_internal.platform_users (email);

-- Platform admin sessions
CREATE TABLE toph_internal.platform_sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES toph_internal.platform_users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    family_id          UUID NOT NULL,
    ip_address         INET,
    user_agent         TEXT,
    expires_at         TIMESTAMPTZ NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_sessions_user_id ON toph_internal.platform_sessions (user_id);
CREATE INDEX idx_platform_sessions_family_id ON toph_internal.platform_sessions (family_id);
CREATE INDEX idx_platform_sessions_expires_at ON toph_internal.platform_sessions (expires_at);

-- Projects
CREATE TABLE toph_internal.projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref             TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    schema_name     TEXT NOT NULL UNIQUE,
    jwt_secret      TEXT NOT NULL,
    anon_key        TEXT NOT NULL,
    service_role_key TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
    settings        JSONB NOT NULL DEFAULT '{}',
    created_by      UUID NOT NULL REFERENCES toph_internal.platform_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_ref ON toph_internal.projects (ref);
CREATE INDEX idx_projects_status ON toph_internal.projects (status);

-- Project membership
CREATE TABLE toph_internal.project_members (
    project_id UUID NOT NULL REFERENCES toph_internal.projects(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES toph_internal.platform_users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);


-- ============================================================
-- Auth helper functions (used in RLS policies within project schemas)
-- ============================================================

CREATE OR REPLACE FUNCTION auth_uid()
RETURNS UUID AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth_role()
RETURNS TEXT AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '');
$$ LANGUAGE sql STABLE;

-- ============================================================
-- Project schema provisioning function
-- ============================================================

CREATE OR REPLACE FUNCTION toph_internal.provision_project_schema(p_schema_name TEXT)
RETURNS void AS $$
BEGIN
    -- Create the schema
    EXECUTE format('CREATE SCHEMA %I', p_schema_name);

    -- Grant usage to API roles
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated, service_role', p_schema_name);
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

-- ============================================================
-- Schema change notification (emits schema name in payload)
-- ============================================================

CREATE OR REPLACE FUNCTION toph_notify_schema_change()
RETURNS event_trigger AS $$
DECLARE
    obj record;
    schema_name text;
BEGIN
    FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
    LOOP
        schema_name := obj.schema_name;
        IF schema_name IS NOT NULL THEN
            PERFORM pg_notify('toph_schema_change', schema_name);
            RETURN;
        END IF;
    END LOOP;
    -- Fallback: notify without specific schema
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
