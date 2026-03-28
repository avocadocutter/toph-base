-- Remove organization logic and replace with direct user ownership
-- This migration removes organizations, organization_members tables
-- and updates agents to be owned directly by users

-- ====================
-- Drop existing RLS policies
-- ====================
DROP POLICY IF EXISTS "Users can view agents in their organizations" ON agents;
DROP POLICY IF EXISTS "Users can create agents in their organizations" ON agents;
DROP POLICY IF EXISTS "Users can update agents in their organizations" ON agents;
DROP POLICY IF EXISTS "Users can delete agents in their organizations" ON agents;
DROP POLICY IF EXISTS "Users can view versions of their agents" ON agent_versions;
DROP POLICY IF EXISTS "Users can create versions for their agents" ON agent_versions;
DROP POLICY IF EXISTS "Users can update versions of their agents" ON agent_versions;
DROP POLICY IF EXISTS "Users can view conversations of their agents" ON conversations;
DROP POLICY IF EXISTS "Users can create conversations for their agents" ON conversations;
DROP POLICY IF EXISTS "Users can update conversations of their agents" ON conversations;
DROP POLICY IF EXISTS "Users can view messages of their conversations" ON messages;
DROP POLICY IF EXISTS "Users can create messages in their conversations" ON messages;
DROP POLICY IF EXISTS "Users can view traces of their agents" ON traces;
DROP POLICY IF EXISTS "Users can create traces for their agents" ON traces;
DROP POLICY IF EXISTS "Users can update traces of their agents" ON traces;
DROP POLICY IF EXISTS "Users can view trace events" ON trace_events;
DROP POLICY IF EXISTS "Users can create trace events" ON trace_events;
DROP POLICY IF EXISTS "Users can view safeguards of their agents" ON safeguards;
DROP POLICY IF EXISTS "Users can create safeguards for their agents" ON safeguards;
DROP POLICY IF EXISTS "Users can update safeguards of their agents" ON safeguards;
DROP POLICY IF EXISTS "Users can delete safeguards of their agents" ON safeguards;
DROP POLICY IF EXISTS "Users can view safeguard logs" ON safeguard_logs;
DROP POLICY IF EXISTS "Users can create safeguard logs" ON safeguard_logs;
DROP POLICY IF EXISTS "Users can view cost records" ON cost_records;
DROP POLICY IF EXISTS "Users can create cost records" ON cost_records;
DROP POLICY IF EXISTS "Users can view their organizations" ON organizations;
DROP POLICY IF EXISTS "Users can create organizations" ON organizations;
DROP POLICY IF EXISTS "Owners can update their organizations" ON organizations;
DROP POLICY IF EXISTS "Users can view members of their organizations" ON organization_members;
DROP POLICY IF EXISTS "Users can add themselves to organizations" ON organization_members;
-- ====================
-- Drop helper function
-- ====================
DROP FUNCTION IF EXISTS get_user_org_ids();
-- ====================
-- Modify agents table
-- ====================
-- Add user_id column
ALTER TABLE agents ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
-- Migrate data: set user_id based on organization ownership
-- This sets the user_id to the first owner found in organization_members
UPDATE agents
SET user_id = (
    SELECT user_id
    FROM organization_members
    WHERE organization_members.organization_id = agents.organization_id
    AND role = 'owner'
    LIMIT 1
);
-- For agents without an owner, use any member
UPDATE agents
SET user_id = (
    SELECT user_id
    FROM organization_members
    WHERE organization_members.organization_id = agents.organization_id
    LIMIT 1
)
WHERE user_id IS NULL;
-- Make user_id NOT NULL after data migration
ALTER TABLE agents ALTER COLUMN user_id SET NOT NULL;
-- Drop organization_id foreign key constraint and column
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_organization_id_fkey;
ALTER TABLE agents DROP COLUMN organization_id;
-- Drop the index on organization_id
DROP INDEX IF EXISTS idx_agents_org_id;
-- Create index on user_id
CREATE INDEX idx_agents_user_id ON agents(user_id);
-- ====================
-- Drop organization tables
-- ====================
DROP TABLE IF EXISTS organization_members CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
-- ====================
-- Create new RLS policies for direct user ownership
-- ====================

-- Agents policies
CREATE POLICY "Users can view their own agents"
    ON agents FOR SELECT
    USING (user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be');
CREATE POLICY "Users can create their own agents"
    ON agents FOR INSERT
    WITH CHECK (user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be');
CREATE POLICY "Users can update their own agents"
    ON agents FOR UPDATE
    USING (user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be');
CREATE POLICY "Users can delete their own agents"
    ON agents FOR DELETE
    USING (user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be');
-- Agent versions policies
CREATE POLICY "Users can view versions of their agents"
    ON agent_versions FOR SELECT
    USING (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can create versions for their agents"
    ON agent_versions FOR INSERT
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can update versions of their agents"
    ON agent_versions FOR UPDATE
    USING (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
-- Conversations policies
CREATE POLICY "Users can view conversations of their agents"
    ON conversations FOR SELECT
    USING (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can create conversations for their agents"
    ON conversations FOR INSERT
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can update conversations of their agents"
    ON conversations FOR UPDATE
    USING (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
-- Messages policies
CREATE POLICY "Users can view messages of their conversations"
    ON messages FOR SELECT
    USING (conversation_id IN (
        SELECT id FROM conversations WHERE agent_id IN (
            SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    ));
CREATE POLICY "Users can create messages in their conversations"
    ON messages FOR INSERT
    WITH CHECK (conversation_id IN (
        SELECT id FROM conversations WHERE agent_id IN (
            SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    ));
-- Traces policies
CREATE POLICY "Users can view traces of their agents"
    ON traces FOR SELECT
    USING (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can create traces for their agents"
    ON traces FOR INSERT
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can update traces of their agents"
    ON traces FOR UPDATE
    USING (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
-- Trace events policies
CREATE POLICY "Users can view trace events"
    ON trace_events FOR SELECT
    USING (trace_id IN (
        SELECT id FROM traces WHERE agent_id IN (
            SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    ));
CREATE POLICY "Users can create trace events"
    ON trace_events FOR INSERT
    WITH CHECK (trace_id IN (
        SELECT id FROM traces WHERE agent_id IN (
            SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    ));
-- Safeguards policies
CREATE POLICY "Users can view safeguards of their agents"
    ON safeguards FOR SELECT
    USING (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can create safeguards for their agents"
    ON safeguards FOR INSERT
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can update safeguards of their agents"
    ON safeguards FOR UPDATE
    USING (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can delete safeguards of their agents"
    ON safeguards FOR DELETE
    USING (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
-- Safeguard logs policies
CREATE POLICY "Users can view safeguard logs"
    ON safeguard_logs FOR SELECT
    USING (safeguard_id IN (
        SELECT id FROM safeguards WHERE agent_id IN (
            SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    ));
CREATE POLICY "Users can create safeguard logs"
    ON safeguard_logs FOR INSERT
    WITH CHECK (safeguard_id IN (
        SELECT id FROM safeguards WHERE agent_id IN (
            SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    ));
-- Cost records policies
CREATE POLICY "Users can view cost records"
    ON cost_records FOR SELECT
    USING (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can create cost records"
    ON cost_records FOR INSERT
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
