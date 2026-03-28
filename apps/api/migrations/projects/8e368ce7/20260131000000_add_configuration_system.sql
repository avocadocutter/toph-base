-- Add Configuration System
-- This migration creates tables for AI-powered configuration conversations
-- that help users define Smart Core goals and tasks through interactive chat

-- ====================
-- Create Configuration Conversations Table
-- ====================
CREATE TABLE configuration_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    smart_core_version_id UUID NOT NULL REFERENCES smart_core_versions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),

    -- Canvas state tracking (goal + tasks)
    canvas_state JSONB NOT NULL DEFAULT '{"goal": "", "tasks": ""}'::jsonb,

    -- Metrics
    message_count INTEGER NOT NULL DEFAULT 0,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_cents INTEGER NOT NULL DEFAULT 0,

    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ====================
-- Create Configuration Messages Table
-- ====================
CREATE TABLE configuration_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    configuration_conversation_id UUID NOT NULL REFERENCES configuration_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
    content TEXT NOT NULL,

    -- Canvas update (only for assistant messages)
    canvas_update JSONB,

    -- Token/cost tracking
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,

    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ====================
-- Create Indexes for Performance
-- ====================
CREATE INDEX idx_config_conversations_version ON configuration_conversations(smart_core_version_id);
CREATE INDEX idx_config_conversations_user ON configuration_conversations(user_id);
CREATE INDEX idx_config_conversations_status ON configuration_conversations(status);
CREATE INDEX idx_config_messages_conversation ON configuration_messages(configuration_conversation_id);
CREATE INDEX idx_config_messages_created ON configuration_messages(created_at);
-- ====================
-- Create Trigger for updated_at
-- ====================
CREATE TRIGGER update_configuration_conversations_updated_at
    BEFORE UPDATE ON configuration_conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
-- ====================
-- Enable Row Level Security
-- ====================
ALTER TABLE configuration_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_messages ENABLE ROW LEVEL SECURITY;
-- ====================
-- Create RLS Policies for configuration_conversations
-- ====================
CREATE POLICY "Users can view their own configuration conversations"
    ON configuration_conversations FOR SELECT
    USING ('ed3cca30-ef07-47a0-93e5-394d6b2257be' = user_id);
CREATE POLICY "Users can insert their own configuration conversations"
    ON configuration_conversations FOR INSERT
    WITH CHECK ('ed3cca30-ef07-47a0-93e5-394d6b2257be' = user_id);
CREATE POLICY "Users can update their own configuration conversations"
    ON configuration_conversations FOR UPDATE
    USING ('ed3cca30-ef07-47a0-93e5-394d6b2257be' = user_id);
-- ====================
-- Create RLS Policies for configuration_messages
-- ====================
CREATE POLICY "Users can view messages in their configuration conversations"
    ON configuration_messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM configuration_conversations
            WHERE id = configuration_messages.configuration_conversation_id
            AND user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    );
CREATE POLICY "Users can insert messages in their configuration conversations"
    ON configuration_messages FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM configuration_conversations
            WHERE id = configuration_messages.configuration_conversation_id
            AND user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    );
