-- ============================================================================
-- Tools Belong to Agent Types
-- Each tool now belongs to exactly one agent type via foreign key
-- ============================================================================

-- Step 1: Add the column as nullable first
ALTER TABLE admin_tools
ADD COLUMN agent_type_id VARCHAR(255) REFERENCES admin_agent_types(id) ON DELETE CASCADE;

-- Step 2: Insert a default agent type to satisfy the FK
INSERT INTO admin_agent_types (
    id,
    name,
    system_prompt,
    model,
    tools,
    pool_min_size,
    pool_max_size,
    pool_idle_timeout_ms,
    pool_request_timeout_ms,
    is_active
) VALUES (
    'default',
    'Default Agent Type',
    'You are a helpful assistant.',
    'openai/gpt-4o',
    '[]'::jsonb,
    1,
    3,
    600000,
    300000,
    true
)
ON CONFLICT (id) DO NOTHING;

-- Step 3: Assign all existing tools to the default agent type
UPDATE admin_tools
SET agent_type_id = 'default'
WHERE agent_type_id IS NULL;

-- Step 4: Enforce NOT NULL now that all rows are populated
ALTER TABLE admin_tools
ALTER COLUMN agent_type_id SET NOT NULL;

-- Step 5: Add the index
CREATE INDEX idx_admin_tools_agent_type_id ON admin_tools(agent_type_id);

-- Step 6: Drop the old tools JSONB column from agent types
ALTER TABLE admin_agent_types DROP COLUMN tools;

COMMENT ON COLUMN admin_tools.agent_type_id IS 'The agent type this tool belongs to';