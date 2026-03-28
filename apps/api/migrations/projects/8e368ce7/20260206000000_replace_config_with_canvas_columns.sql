-- Replace config JSONB with canvas_goal and canvas_tasks TEXT columns
-- Drop the goals/tasks first-class tables (from 20260131000001) that were never used

-- Drop goals/tasks first-class tables
DROP TABLE IF EXISTS task_history CASCADE;
DROP TABLE IF EXISTS goal_history CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS goals CASCADE;

-- Drop related triggers/functions
DROP FUNCTION IF EXISTS track_goal_changes() CASCADE;
DROP FUNCTION IF EXISTS track_task_changes() CASCADE;

-- Modify smart_core_versions: replace config JSONB with text columns
ALTER TABLE smart_core_versions DROP COLUMN IF EXISTS config;
ALTER TABLE smart_core_versions DROP COLUMN IF EXISTS diff_summary;
ALTER TABLE smart_core_versions ADD COLUMN canvas_goal TEXT NOT NULL DEFAULT '';
ALTER TABLE smart_core_versions ADD COLUMN canvas_tasks TEXT NOT NULL DEFAULT '';

-- Fix configuration_conversations (undo 20260131000001 changes)
ALTER TABLE configuration_conversations DROP COLUMN IF EXISTS goal_id;

-- Add gateway conversation ID tracking
ALTER TABLE configuration_conversations ADD COLUMN IF NOT EXISTS gateway_conversation_id TEXT;
