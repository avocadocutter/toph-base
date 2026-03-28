-- ============================================================================
-- Tools Belong to Agent Types
-- Each tool now belongs to exactly one agent type via foreign key
-- ============================================================================

-- Add agent_type_id column to admin_tools (NOT NULL, FK to admin_agent_types)
ALTER TABLE admin_tools
ADD COLUMN agent_type_id VARCHAR(255) NOT NULL REFERENCES admin_agent_types(id) ON DELETE CASCADE;

-- Index for efficient lookups by agent type
CREATE INDEX idx_admin_tools_agent_type_id ON admin_tools(agent_type_id);

-- Remove tools JSONB array from admin_agent_types (no longer needed)
ALTER TABLE admin_agent_types DROP COLUMN tools;

COMMENT ON COLUMN admin_tools.agent_type_id IS 'The agent type this tool belongs to';
