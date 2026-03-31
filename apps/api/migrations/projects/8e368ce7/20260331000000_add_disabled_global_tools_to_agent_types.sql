-- Add disabled_global_tools array to admin_agent_types.
-- Stores IDs of global tools that are disabled for a specific agent type.
-- Default is empty array (all global tools enabled).
ALTER TABLE admin_agent_types ADD COLUMN disabled_global_tools TEXT[] NOT NULL DEFAULT '{}';
