-- Migration: Add support for new Supabase-style API keys (sb_publishable_*, sb_secret_*)
-- This allows for multiple revocable API keys per project with instant revocation

-- API Keys table - stores new format keys
CREATE TABLE toph_internal.api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES toph_internal.projects(id) ON DELETE CASCADE,
    key_value       TEXT NOT NULL UNIQUE,  -- The actual key: sb_publishable_xxx or sb_secret_xxx
    key_prefix      TEXT NOT NULL CHECK (key_prefix IN ('publishable', 'secret')),
    role            TEXT NOT NULL,  -- 'anon' for publishable, 'service_role' for secret, or custom roles
    name            TEXT,  -- User-defined description (e.g., "Production app", "Staging server")
    revoked_at      TIMESTAMPTZ,  -- NULL = active, NOT NULL = revoked
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at    TIMESTAMPTZ,  -- Track when key was last used
    created_by      UUID REFERENCES toph_internal.platform_users(id)
);

-- Indexes for efficient lookups
CREATE INDEX idx_api_keys_project_id ON toph_internal.api_keys (project_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_key_value ON toph_internal.api_keys (key_value) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_key_prefix ON toph_internal.api_keys (key_prefix, project_id);

-- Add comment explaining the transition
COMMENT ON TABLE toph_internal.api_keys IS 'New Supabase-compatible API keys (sb_publishable_*, sb_secret_*). Legacy anon_key and service_role_key columns in projects table are kept for backward compatibility during migration.';

-- Function to revoke an API key (soft delete)
CREATE OR REPLACE FUNCTION toph_internal.revoke_api_key(key_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE toph_internal.api_keys
    SET revoked_at = now()
    WHERE id = key_id AND revoked_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to track key usage
CREATE OR REPLACE FUNCTION toph_internal.record_api_key_usage(key_val TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE toph_internal.api_keys
    SET last_used_at = now()
    WHERE key_value = key_val AND revoked_at IS NULL;
END;
$$ LANGUAGE plpgsql;
