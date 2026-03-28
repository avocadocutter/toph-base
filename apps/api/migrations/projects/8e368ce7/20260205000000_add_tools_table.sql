-- ============================================================================
-- Tools Table
-- Stores tool definitions that agents can use
-- ============================================================================
CREATE TABLE admin_tools (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  parameters JSONB NOT NULL,        -- JSON Schema for parameters
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_tools_active ON admin_tools(is_active);
CREATE INDEX idx_admin_tools_name ON admin_tools(name);

CREATE TRIGGER update_admin_tools_updated_at
  BEFORE UPDATE ON admin_tools
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Seed: migrate existing code-defined tool
INSERT INTO admin_tools (id, name, label, description, parameters) VALUES (
  'tool-update-smart-core-plan',
  'update_smart_core_plan',
  'Update Smart Core Plan',
  'Create or update the goal and task plan for a Smart Core agent.',
  '{
    "type": "object",
    "properties": {
      "goal": { "type": "string", "description": "The main goal" },
      "description": { "type": "string", "description": "Goal description" },
      "tasks": {
        "type": "array",
        "description": "Tasks to accomplish the goal",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string", "description": "Unique task identifier" },
            "title": { "type": "string", "description": "Task title" },
            "description": { "type": "string", "description": "Detailed task description" },
            "status": { "type": "string", "enum": ["pending", "in_progress", "done"] }
          },
          "required": ["id", "title", "description", "status"]
        }
      }
    },
    "required": ["goal", "description", "tasks"]
  }'::jsonb
);

COMMENT ON TABLE admin_tools IS 'Tool definitions available for agent types';
COMMENT ON COLUMN admin_tools.parameters IS 'JSON Schema defining the tool parameters';
COMMENT ON COLUMN admin_tools.name IS 'Unique snake_case tool identifier';
