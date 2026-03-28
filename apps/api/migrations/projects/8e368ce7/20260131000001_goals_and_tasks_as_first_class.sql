-- Goals and Tasks as First-Class Entities
-- This migration elevates goals and tasks to primary domain models
-- Conversations exist to create/refine them, not the other way around

-- ====================
-- Create Goals Table
-- ====================
CREATE TABLE goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    smart_core_version_id UUID NOT NULL REFERENCES smart_core_versions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,

    -- Goal content
    content TEXT NOT NULL DEFAULT '',

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),

    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One goal per version
    UNIQUE(smart_core_version_id)
);
-- ====================
-- Create Tasks Table
-- ====================
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,

    -- Task content
    content TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),

    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ====================
-- Create Goal/Task Change History (Audit Trail)
-- ====================
CREATE TABLE goal_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    changed_by TEXT NOT NULL, -- 'user', 'ai', 'system'
    old_content TEXT,
    new_content TEXT NOT NULL,
    conversation_message_id UUID REFERENCES configuration_messages(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE task_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    changed_by TEXT NOT NULL,
    old_content TEXT,
    new_content TEXT NOT NULL,
    conversation_message_id UUID REFERENCES configuration_messages(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ====================
-- Update Configuration Conversations to Link to Goal
-- ====================
ALTER TABLE configuration_conversations
    ADD COLUMN goal_id UUID REFERENCES goals(id) ON DELETE CASCADE;
-- Remove canvas_state (no longer needed - goal/tasks are now first-class)
ALTER TABLE configuration_conversations
    DROP COLUMN canvas_state;
-- ====================
-- Update Configuration Messages
-- ====================
-- Remove canvas_update column (replaced by goal/task history)
ALTER TABLE configuration_messages
    DROP COLUMN canvas_update;
-- ====================
-- Create Indexes
-- ====================
CREATE INDEX idx_goals_version ON goals(smart_core_version_id);
CREATE INDEX idx_goals_user ON goals(user_id);
CREATE INDEX idx_goals_status ON goals(status);
CREATE INDEX idx_tasks_goal ON tasks(goal_id);
CREATE INDEX idx_tasks_order ON tasks(goal_id, order_index);
CREATE INDEX idx_goal_history_goal ON goal_history(goal_id);
CREATE INDEX idx_goal_history_created ON goal_history(created_at);
CREATE INDEX idx_task_history_task ON task_history(task_id);
CREATE INDEX idx_task_history_created ON task_history(created_at);
-- ====================
-- Create Triggers for updated_at
-- ====================
CREATE TRIGGER update_goals_updated_at
    BEFORE UPDATE ON goals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
-- ====================
-- Create Trigger for Goal History (Auto-track changes)
-- ====================
CREATE OR REPLACE FUNCTION track_goal_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.content IS DISTINCT FROM NEW.content THEN
        INSERT INTO goal_history (goal_id, changed_by, old_content, new_content)
        VALUES (NEW.id, 'user', OLD.content, NEW.content);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER goal_change_tracker
    AFTER UPDATE ON goals
    FOR EACH ROW
    EXECUTE FUNCTION track_goal_changes();
-- ====================
-- Create Trigger for Task History (Auto-track changes)
-- ====================
CREATE OR REPLACE FUNCTION track_task_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.content IS DISTINCT FROM NEW.content THEN
        INSERT INTO task_history (task_id, changed_by, old_content, new_content)
        VALUES (NEW.id, 'user', OLD.content, NEW.content);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER task_change_tracker
    AFTER UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION track_task_changes();
-- ====================
-- Enable Row Level Security
-- ====================
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_history ENABLE ROW LEVEL SECURITY;
-- ====================
-- RLS Policies for Goals
-- ====================
CREATE POLICY "Users can view their own goals"
    ON goals FOR SELECT
    USING ('ed3cca30-ef07-47a0-93e5-394d6b2257be' = user_id);
CREATE POLICY "Users can insert their own goals"
    ON goals FOR INSERT
    WITH CHECK ('ed3cca30-ef07-47a0-93e5-394d6b2257be' = user_id);
CREATE POLICY "Users can update their own goals"
    ON goals FOR UPDATE
    USING ('ed3cca30-ef07-47a0-93e5-394d6b2257be' = user_id);
CREATE POLICY "Users can delete their own goals"
    ON goals FOR DELETE
    USING ('ed3cca30-ef07-47a0-93e5-394d6b2257be' = user_id);
-- ====================
-- RLS Policies for Tasks
-- ====================
CREATE POLICY "Users can view tasks for their goals"
    ON tasks FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM goals
            WHERE goals.id = tasks.goal_id
            AND goals.user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    );
CREATE POLICY "Users can insert tasks for their goals"
    ON tasks FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM goals
            WHERE goals.id = tasks.goal_id
            AND goals.user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    );
CREATE POLICY "Users can update tasks for their goals"
    ON tasks FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM goals
            WHERE goals.id = tasks.goal_id
            AND goals.user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    );
CREATE POLICY "Users can delete tasks for their goals"
    ON tasks FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM goals
            WHERE goals.id = tasks.goal_id
            AND goals.user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    );
-- ====================
-- RLS Policies for History Tables
-- ====================
CREATE POLICY "Users can view goal history for their goals"
    ON goal_history FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM goals
            WHERE goals.id = goal_history.goal_id
            AND goals.user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    );
CREATE POLICY "Users can view task history for their tasks"
    ON task_history FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM tasks
            JOIN goals ON goals.id = tasks.goal_id
            WHERE tasks.id = task_history.task_id
            AND goals.user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    );
-- ====================
-- Data Migration (if needed)
-- ====================
-- Migrate existing canvas_state to goals/tasks
-- This would need to be run if there's existing data
-- For now, leaving as TODO since this is a new implementation;
