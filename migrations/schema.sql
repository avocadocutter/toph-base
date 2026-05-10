-- toph-base platform schema
-- Single consolidated file. Apply once on a fresh database:
--   psql -U postgres -d toph -f migrations/schema.sql

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- toph role (superuser so it can manage per-project databases)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'toph') THEN
    CREATE ROLE toph SUPERUSER LOGIN PASSWORD 'changeit';
  ELSE
    ALTER ROLE toph SUPERUSER LOGIN;
  END IF;
END
$$;

-- API access roles (used inside project databases for RLS)
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

-- Grant API roles to toph so it can SET ROLE inside project connections
GRANT anon, authenticated, service_role TO toph;

-- Internal schema
CREATE SCHEMA IF NOT EXISTS toph_internal;

GRANT CREATE ON DATABASE toph TO toph;
GRANT ALL ON SCHEMA toph_internal TO toph;
ALTER DEFAULT PRIVILEGES IN SCHEMA toph_internal GRANT ALL ON TABLES TO toph;
ALTER DEFAULT PRIVILEGES IN SCHEMA toph_internal GRANT ALL ON SEQUENCES TO toph;

-- ============================================================
-- Platform tables
-- ============================================================

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

CREATE TABLE toph_internal.projects (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref        TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    db_name    TEXT NOT NULL UNIQUE,
    jwt_secret TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
    settings   JSONB NOT NULL DEFAULT '{}',
    created_by UUID NOT NULL REFERENCES toph_internal.platform_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_ref ON toph_internal.projects (ref);
CREATE INDEX idx_projects_status ON toph_internal.projects (status);

CREATE TABLE toph_internal.project_members (
    project_id UUID NOT NULL REFERENCES toph_internal.projects(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES toph_internal.platform_users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

-- API keys (sb_publishable_* / sb_secret_*)
CREATE TABLE toph_internal.api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL REFERENCES toph_internal.projects(id) ON DELETE CASCADE,
    key_value    TEXT NOT NULL UNIQUE,
    key_prefix   TEXT NOT NULL CHECK (key_prefix IN ('publishable', 'secret')),
    role         TEXT NOT NULL,
    name         TEXT,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    created_by   UUID REFERENCES toph_internal.platform_users(id)
);

CREATE INDEX idx_api_keys_project_id ON toph_internal.api_keys (project_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_key_value  ON toph_internal.api_keys (key_value)  WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_key_prefix ON toph_internal.api_keys (key_prefix, project_id);

-- Migration tracking (platform + per-project)
CREATE TABLE toph_internal.migrations (
    name         TEXT NOT NULL,
    applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    project_id   UUID REFERENCES toph_internal.projects(id) ON DELETE CASCADE,
    status       TEXT DEFAULT 'applied' CHECK (status IN ('pending', 'applied', 'failed')),
    error_message TEXT,
    applied_by   UUID REFERENCES toph_internal.platform_users(id),
    CONSTRAINT migrations_name_project_id_key UNIQUE (name, project_id)
);

CREATE UNIQUE INDEX migrations_platform_name_key ON toph_internal.migrations (name) WHERE project_id IS NULL;
CREATE INDEX idx_migrations_project_id ON toph_internal.migrations (project_id);
CREATE INDEX idx_migrations_status     ON toph_internal.migrations (status);

COMMENT ON COLUMN toph_internal.migrations.project_id IS 'NULL = platform migration; UUID = project-scoped migration';

-- ============================================================
-- Helper functions
-- ============================================================

CREATE OR REPLACE FUNCTION auth_uid()
RETURNS UUID AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth_role()
RETURNS TEXT AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION toph_internal.revoke_api_key(key_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE toph_internal.api_keys SET revoked_at = now()
    WHERE id = key_id AND revoked_at IS NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION toph_internal.record_api_key_usage(key_val TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE toph_internal.api_keys SET last_used_at = now()
    WHERE key_value = key_val AND revoked_at IS NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION toph_notify_schema_change()
RETURNS event_trigger AS $$
DECLARE
    obj         record;
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
    PERFORM pg_notify('toph_schema_change', TG_TAG);
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'toph_ddl_trigger') THEN
    CREATE EVENT TRIGGER toph_ddl_trigger
      ON ddl_command_end
      EXECUTE FUNCTION toph_notify_schema_change();
  END IF;
END
$$;
