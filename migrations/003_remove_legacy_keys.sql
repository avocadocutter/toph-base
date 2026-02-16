-- Migration: Remove all legacy key columns and use only new api_keys table

-- Generate new format keys for any projects that don't have them yet
DO $$
DECLARE
    project_record RECORD;
    publishable_key TEXT;
    secret_key TEXT;
BEGIN
    FOR project_record IN
        SELECT p.id, p.ref
        FROM toph_internal.projects p
        WHERE p.status != 'deleted'
        AND NOT EXISTS (
            SELECT 1 FROM toph_internal.api_keys ak
            WHERE ak.project_id = p.id AND ak.key_prefix = 'publishable' AND ak.revoked_at IS NULL
        )
    LOOP
        publishable_key := 'sb_publishable_' || encode(gen_random_bytes(32), 'hex');
        INSERT INTO toph_internal.api_keys (project_id, key_value, key_prefix, role, name)
        VALUES (project_record.id, publishable_key, 'publishable', 'anon', 'Default publishable key');
    END LOOP;

    FOR project_record IN
        SELECT p.id, p.ref
        FROM toph_internal.projects p
        WHERE p.status != 'deleted'
        AND NOT EXISTS (
            SELECT 1 FROM toph_internal.api_keys ak
            WHERE ak.project_id = p.id AND ak.key_prefix = 'secret' AND ak.revoked_at IS NULL
        )
    LOOP
        secret_key := 'sb_secret_' || encode(gen_random_bytes(32), 'hex');
        INSERT INTO toph_internal.api_keys (project_id, key_value, key_prefix, role, name)
        VALUES (project_record.id, secret_key, 'secret', 'service_role', 'Default secret key');
    END LOOP;
END $$;

-- Drop legacy key columns
ALTER TABLE toph_internal.projects
  DROP COLUMN IF EXISTS anon_key,
  DROP COLUMN IF EXISTS service_role_key;
