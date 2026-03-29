-- ============================================================================
-- Global Tools Support + Read File Tool
-- Adds is_global flag to admin_tools, makes agent_type_id nullable for
-- global tools, and seeds the read_file tool available to all agent types.
-- ============================================================================

-- Make agent_type_id nullable (global tools have NULL agent_type_id)
ALTER TABLE admin_tools ALTER COLUMN agent_type_id DROP NOT NULL;

-- Add is_global column
ALTER TABLE admin_tools ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT false;

-- Index for efficient global tool lookups
CREATE INDEX idx_admin_tools_is_global ON admin_tools(is_global) WHERE is_global = true;

-- Constraint: global tools must have NULL agent_type_id, non-global must have one
ALTER TABLE admin_tools ADD CONSTRAINT chk_global_agent_type
  CHECK (
    (is_global = true AND agent_type_id IS NULL) OR
    (is_global = false AND agent_type_id IS NOT NULL)
  );

-- Seed: read_file global tool
INSERT INTO admin_tools (id, name, label, description, parameters, is_global, agent_type_id) VALUES (
  'tool-read-file',
  'read_file',
  'Read File',
  'Read the contents of a file from the filesystem. Returns the file content as text. Supports optional line offset and limit for reading specific portions of large files.',
  '{
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute or relative path to the file to read"
      },
      "offset": {
        "type": "number",
        "description": "Line number to start reading from (1-indexed). If omitted, reads from the beginning."
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of lines to read. If omitted, reads the entire file."
      }
    },
    "required": ["path"]
  }'::jsonb,
  true,
  NULL
);

COMMENT ON COLUMN admin_tools.is_global IS 'When true, this tool is available to all agent types regardless of agent_type_id';
