-- Enhance migrations table for project-scoped migrations
-- Adds support for tracking migrations per project with status and error tracking

-- Create the migrations table if it doesn't exist
CREATE TABLE IF NOT EXISTS toph_internal.migrations (
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drop the old primary key constraint if it exists
ALTER TABLE toph_internal.migrations DROP CONSTRAINT IF EXISTS migrations_pkey;

-- Add new columns
ALTER TABLE toph_internal.migrations
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES toph_internal.projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'applied' CHECK (status IN ('pending', 'applied', 'failed')),
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS applied_by UUID REFERENCES toph_internal.platform_users(id);

-- For uniqueness: we need (name, project_id) to be unique
-- But we also need name to be unique when project_id IS NULL (platform migrations)
-- PostgreSQL's UNIQUE constraint with NULLs: multiple NULLs are allowed
-- So we need a partial unique index for platform migrations
CREATE UNIQUE INDEX IF NOT EXISTS migrations_platform_name_key
  ON toph_internal.migrations (name)
  WHERE project_id IS NULL;

-- And a unique constraint for project migrations
CREATE UNIQUE INDEX IF NOT EXISTS migrations_project_name_key
  ON toph_internal.migrations (name, project_id)
  WHERE project_id IS NOT NULL;

-- Index for querying project migrations
CREATE INDEX IF NOT EXISTS idx_migrations_project_id ON toph_internal.migrations (project_id);
CREATE INDEX IF NOT EXISTS idx_migrations_status ON toph_internal.migrations (status);

-- Backfill existing platform migrations
UPDATE toph_internal.migrations
SET status = 'applied'
WHERE status IS NULL;

COMMENT ON COLUMN toph_internal.migrations.project_id IS 'NULL for platform migrations, UUID for project-scoped migrations';
COMMENT ON COLUMN toph_internal.migrations.status IS 'pending = created but not applied, applied = successfully executed, failed = execution error';
COMMENT ON COLUMN toph_internal.migrations.applied_by IS 'Platform user who applied the migration';
