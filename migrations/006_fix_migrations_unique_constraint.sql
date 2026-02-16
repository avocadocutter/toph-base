-- Fix migrations table unique constraint for ON CONFLICT support
-- Partial indexes can't be used with ON CONFLICT, so we need a full unique constraint

-- Drop the partial unique index for project migrations
DROP INDEX IF EXISTS toph_internal.migrations_project_name_key;

-- Add a proper unique constraint on (name, project_id)
-- This allows ON CONFLICT to work properly
-- Note: In PostgreSQL, multiple NULLs are distinct in unique constraints,
-- so (name, NULL) can appear multiple times, which is what we want for platform migrations
ALTER TABLE toph_internal.migrations
  ADD CONSTRAINT migrations_name_project_id_key UNIQUE (name, project_id);
