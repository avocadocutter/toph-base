-- Migration: Add postgrest_url column to projects table
-- This allows storing manually-managed PostgREST instance URLs per project

ALTER TABLE toph_internal.projects
  ADD COLUMN IF NOT EXISTS postgrest_url TEXT;

COMMENT ON COLUMN toph_internal.projects.postgrest_url IS 'URL of the manually-managed PostgREST instance for this project (e.g., http://localhost:9001)';
