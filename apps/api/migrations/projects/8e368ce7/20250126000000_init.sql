-- Initial schema migration for Iroh
-- Consolidates: init, agents, conversations, traces, safeguards, RLS
-- Uses gen_random_uuid() - native PostgreSQL function (no extension required)

-- ====================
-- Helper Functions
-- ====================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';
-- ====================
-- Enums
-- ====================
CREATE TYPE agent_status AS ENUM ('draft', 'active', 'paused', 'archived');
CREATE TYPE agent_channel AS ENUM ('text', 'voice', 'whatsapp');
CREATE TYPE version_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE conversation_status AS ENUM ('active', 'completed', 'failed');
CREATE TYPE message_role AS ENUM ('system', 'user', 'assistant');
CREATE TYPE trace_status AS ENUM ('running', 'completed', 'failed');
CREATE TYPE trace_event_type AS ENUM ('llm', 'tool', 'safeguard', 'tts', 'stt', 'custom');
CREATE TYPE safeguard_type AS ENUM ('content_filter', 'rate_limit', 'cost_cap', 'token_limit');
CREATE TYPE safeguard_action AS ENUM ('blocked', 'flagged', 'allowed');
CREATE TYPE cost_type AS ENUM ('llm', 'tts', 'stt', 'moderation');
-- ====================
-- Tables: Organizations
-- ====================
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);
CREATE INDEX idx_org_members_org_id ON organization_members(organization_id);
CREATE INDEX idx_org_members_user_id ON organization_members(user_id);
CREATE TRIGGER update_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
-- ====================
-- Tables: Agents
-- ====================
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    active_version_id UUID,
    status agent_status NOT NULL DEFAULT 'draft',
    channels agent_channel[] NOT NULL DEFAULT ARRAY['text']::agent_channel[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE agent_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    diff_summary TEXT,
    status version_status NOT NULL DEFAULT 'draft',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agent_id, version_number)
);
ALTER TABLE agents
ADD CONSTRAINT fk_agents_active_version
FOREIGN KEY (active_version_id) REFERENCES agent_versions(id) ON DELETE SET NULL;
CREATE INDEX idx_agents_org_id ON agents(organization_id);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_slug ON agents(slug);
CREATE INDEX idx_agent_versions_agent_id ON agent_versions(agent_id);
CREATE INDEX idx_agent_versions_status ON agent_versions(status);
CREATE TRIGGER update_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
-- ====================
-- Tables: Conversations
-- ====================
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    agent_version_id UUID REFERENCES agent_versions(id),
    channel agent_channel NOT NULL DEFAULT 'text',
    status conversation_status NOT NULL DEFAULT 'active',
    message_count INTEGER NOT NULL DEFAULT 0,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_cents INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role message_role NOT NULL,
    content TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_conversations_agent_id ON conversations(agent_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_created_at ON conversations(created_at);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_role ON messages(role);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
-- ====================
-- Tables: Traces
-- ====================
CREATE TABLE traces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    trace_id VARCHAR(255) NOT NULL,
    duration_ms INTEGER,
    status trace_status NOT NULL DEFAULT 'running',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE trace_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id UUID NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    event_type trace_event_type NOT NULL,
    name VARCHAR(255) NOT NULL,
    input JSONB,
    output JSONB,
    duration_ms INTEGER,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);
CREATE INDEX idx_traces_agent_id ON traces(agent_id);
CREATE INDEX idx_traces_conversation_id ON traces(conversation_id);
CREATE INDEX idx_traces_trace_id ON traces(trace_id);
CREATE INDEX idx_traces_status ON traces(status);
CREATE INDEX idx_traces_created_at ON traces(created_at);
CREATE INDEX idx_trace_events_trace_id ON trace_events(trace_id);
CREATE INDEX idx_trace_events_event_type ON trace_events(event_type);
CREATE INDEX idx_trace_events_started_at ON trace_events(started_at);
-- ====================
-- Tables: Safeguards & Costs
-- ====================
CREATE TABLE safeguards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    type safeguard_type NOT NULL,
    name VARCHAR(255) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE safeguard_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    safeguard_id UUID NOT NULL REFERENCES safeguards(id) ON DELETE CASCADE,
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    action_taken safeguard_action NOT NULL,
    trigger_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    overridden BOOLEAN NOT NULL DEFAULT false,
    overridden_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE cost_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    cost_type cost_type NOT NULL,
    provider VARCHAR(100) NOT NULL,
    model VARCHAR(255) NOT NULL,
    input_units INTEGER NOT NULL DEFAULT 0,
    output_units INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_safeguards_agent_id ON safeguards(agent_id);
CREATE INDEX idx_safeguards_type ON safeguards(type);
CREATE INDEX idx_safeguards_enabled ON safeguards(enabled);
CREATE INDEX idx_safeguard_logs_safeguard_id ON safeguard_logs(safeguard_id);
CREATE INDEX idx_safeguard_logs_action ON safeguard_logs(action_taken);
CREATE INDEX idx_safeguard_logs_created_at ON safeguard_logs(created_at);
CREATE INDEX idx_cost_records_agent_id ON cost_records(agent_id);
CREATE INDEX idx_cost_records_conversation_id ON cost_records(conversation_id);
CREATE INDEX idx_cost_records_cost_type ON cost_records(cost_type);
CREATE INDEX idx_cost_records_created_at ON cost_records(created_at);
CREATE TRIGGER update_safeguards_updated_at
    BEFORE UPDATE ON safeguards
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
-- ====================
-- Row Level Security
-- ====================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE trace_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE safeguards ENABLE ROW LEVEL SECURITY;
ALTER TABLE safeguard_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_records ENABLE ROW LEVEL SECURITY;
-- Helper function to get user's organization IDs
CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS SETOF UUID AS $$
BEGIN
    RETURN QUERY
    SELECT organization_id
    FROM organization_members
    WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Organizations policies
CREATE POLICY "Users can view their organizations"
    ON organizations FOR SELECT
    USING (id IN (SELECT get_user_org_ids()));
CREATE POLICY "Users can create organizations"
    ON organizations FOR INSERT
    WITH CHECK (true);
CREATE POLICY "Owners can update their organizations"
    ON organizations FOR UPDATE
    USING (id IN (
        SELECT organization_id
        FROM organization_members
        WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be' AND role = 'owner'
    ));
-- Organization members policies
CREATE POLICY "Users can view members of their organizations"
    ON organization_members FOR SELECT
    USING (organization_id IN (SELECT get_user_org_ids()));
CREATE POLICY "Users can add themselves to organizations"
    ON organization_members FOR INSERT
    WITH CHECK (user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be');
-- Agents policies
CREATE POLICY "Users can view agents in their organizations"
    ON agents FOR SELECT
    USING (organization_id IN (SELECT get_user_org_ids()));
CREATE POLICY "Users can create agents in their organizations"
    ON agents FOR INSERT
    WITH CHECK (organization_id IN (SELECT get_user_org_ids()));
CREATE POLICY "Users can update agents in their organizations"
    ON agents FOR UPDATE
    USING (organization_id IN (SELECT get_user_org_ids()));
CREATE POLICY "Users can delete agents in their organizations"
    ON agents FOR DELETE
    USING (organization_id IN (SELECT get_user_org_ids()));
-- Agent versions policies
CREATE POLICY "Users can view versions of their agents"
    ON agent_versions FOR SELECT
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can create versions for their agents"
    ON agent_versions FOR INSERT
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can update versions of their agents"
    ON agent_versions FOR UPDATE
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
-- Conversations policies
CREATE POLICY "Users can view conversations of their agents"
    ON conversations FOR SELECT
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can create conversations for their agents"
    ON conversations FOR INSERT
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can update conversations of their agents"
    ON conversations FOR UPDATE
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
-- Messages policies
CREATE POLICY "Users can view messages of their conversations"
    ON messages FOR SELECT
    USING (conversation_id IN (
        SELECT id FROM conversations WHERE agent_id IN (
            SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
        )
    ));
CREATE POLICY "Users can create messages in their conversations"
    ON messages FOR INSERT
    WITH CHECK (conversation_id IN (
        SELECT id FROM conversations WHERE agent_id IN (
            SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
        )
    ));
-- Traces policies
CREATE POLICY "Users can view traces of their agents"
    ON traces FOR SELECT
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can create traces for their agents"
    ON traces FOR INSERT
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can update traces of their agents"
    ON traces FOR UPDATE
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
-- Trace events policies
CREATE POLICY "Users can view trace events"
    ON trace_events FOR SELECT
    USING (trace_id IN (
        SELECT id FROM traces WHERE agent_id IN (
            SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
        )
    ));
CREATE POLICY "Users can create trace events"
    ON trace_events FOR INSERT
    WITH CHECK (trace_id IN (
        SELECT id FROM traces WHERE agent_id IN (
            SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
        )
    ));
-- Safeguards policies
CREATE POLICY "Users can view safeguards of their agents"
    ON safeguards FOR SELECT
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can create safeguards for their agents"
    ON safeguards FOR INSERT
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can update safeguards of their agents"
    ON safeguards FOR UPDATE
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can delete safeguards of their agents"
    ON safeguards FOR DELETE
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
-- Safeguard logs policies
CREATE POLICY "Users can view safeguard logs"
    ON safeguard_logs FOR SELECT
    USING (safeguard_id IN (
        SELECT id FROM safeguards WHERE agent_id IN (
            SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
        )
    ));
CREATE POLICY "Users can create safeguard logs"
    ON safeguard_logs FOR INSERT
    WITH CHECK (safeguard_id IN (
        SELECT id FROM safeguards WHERE agent_id IN (
            SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
        )
    ));
-- Cost records policies
CREATE POLICY "Users can view cost records"
    ON cost_records FOR SELECT
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can create cost records"
    ON cost_records FOR INSERT
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
