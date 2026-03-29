-- ============================================================================
-- Add list_files global tool
-- Companion to read_file — allows agents to discover files in their workspace
-- ============================================================================

INSERT INTO admin_tools (id, name, label, description, parameters, is_global, agent_type_id) VALUES (
  'tool-list-files',
  'list_files',
  'List Files',
  'List files and directories in the agent workspace. Files are scoped to the agent type workspace directory. Use this to discover available files before reading them.',
  '{
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Relative directory path within the agent workspace. Defaults to the workspace root."
      },
      "pattern": {
        "type": "string",
        "description": "Glob pattern to filter results (e.g. \"*.ts\", \"**/*.json\"). If omitted, returns all entries."
      },
      "recursive": {
        "type": "boolean",
        "description": "Whether to recurse into subdirectories. Defaults to false."
      }
    }
  }'::jsonb,
  true,
  NULL
);
