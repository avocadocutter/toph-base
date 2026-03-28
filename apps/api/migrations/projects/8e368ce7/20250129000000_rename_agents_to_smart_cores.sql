-- Rename agents to smart_cores
-- This migration renames all "agent" terminology to "smart_core" throughout the schema

-- ====================
-- Drop existing RLS policies
-- ====================
DROP POLICY IF EXISTS "Users can view their own agents" ON agents;
DROP POLICY IF EXISTS "Users can create their own agents" ON agents;
DROP POLICY IF EXISTS "Users can update their own agents" ON agents;
DROP POLICY IF EXISTS "Users can delete their own agents" ON agents;
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
-- ====================
-- Rename Enum Types
-- ====================
ALTER TYPE agent_status RENAME TO smart_core_status;
ALTER TYPE agent_channel RENAME TO smart_core_channel;
-- ====================
-- Rename Tables
-- ====================

-- First, drop the foreign key constraint from agents to agent_versions
ALTER TABLE agents DROP CONSTRAINT IF EXISTS fk_agents_active_version;
-- Rename agent_versions first (referenced by agents)
ALTER TABLE agent_versions RENAME TO smart_core_versions;
-- Rename agents to smart_cores
ALTER TABLE agents RENAME TO smart_cores;
-- Rename columns in smart_core_versions
ALTER TABLE smart_core_versions RENAME COLUMN agent_id TO smart_core_id;
-- Rename columns in conversations
ALTER TABLE conversations RENAME COLUMN agent_id TO smart_core_id;
ALTER TABLE conversations RENAME COLUMN agent_version_id TO smart_core_version_id;
-- Rename columns in traces
ALTER TABLE traces RENAME COLUMN agent_id TO smart_core_id;
-- Rename columns in safeguards
ALTER TABLE safeguards RENAME COLUMN agent_id TO smart_core_id;
-- Rename columns in cost_records
ALTER TABLE cost_records RENAME COLUMN agent_id TO smart_core_id;
-- ====================
-- Recreate Foreign Key Constraints
-- ====================
ALTER TABLE smart_cores
ADD CONSTRAINT fk_smart_cores_active_version
FOREIGN KEY (active_version_id) REFERENCES smart_core_versions(id) ON DELETE SET NULL;
-- ====================
-- Rename Indexes
-- ====================
ALTER INDEX idx_agents_user_id RENAME TO idx_smart_cores_user_id;
ALTER INDEX idx_agents_status RENAME TO idx_smart_cores_status;
ALTER INDEX idx_agents_slug RENAME TO idx_smart_cores_slug;
ALTER INDEX idx_agent_versions_agent_id RENAME TO idx_smart_core_versions_smart_core_id;
ALTER INDEX idx_agent_versions_status RENAME TO idx_smart_core_versions_status;
ALTER INDEX idx_conversations_agent_id RENAME TO idx_conversations_smart_core_id;
ALTER INDEX idx_traces_agent_id RENAME TO idx_traces_smart_core_id;
ALTER INDEX idx_safeguards_agent_id RENAME TO idx_safeguards_smart_core_id;
ALTER INDEX idx_cost_records_agent_id RENAME TO idx_cost_records_smart_core_id;
-- ====================
-- Rename Triggers
-- ====================
DROP TRIGGER IF EXISTS update_agents_updated_at ON smart_cores;
CREATE TRIGGER update_smart_cores_updated_at
    BEFORE UPDATE ON smart_cores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
-- ====================
-- Create new RLS policies for smart_cores
-- ====================

-- Smart cores policies
CREATE POLICY "Users can view their own smart cores"
    ON smart_cores FOR SELECT
    USING (user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be');
CREATE POLICY "Users can create their own smart cores"
    ON smart_cores FOR INSERT
    WITH CHECK (user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be');
CREATE POLICY "Users can update their own smart cores"
    ON smart_cores FOR UPDATE
    USING (user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be');
CREATE POLICY "Users can delete their own smart cores"
    ON smart_cores FOR DELETE
    USING (user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be');
-- Smart core versions policies
CREATE POLICY "Users can view versions of their smart cores"
    ON smart_core_versions FOR SELECT
    USING (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can create versions for their smart cores"
    ON smart_core_versions FOR INSERT
    WITH CHECK (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can update versions of their smart cores"
    ON smart_core_versions FOR UPDATE
    USING (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
-- Conversations policies
CREATE POLICY "Users can view conversations of their smart cores"
    ON conversations FOR SELECT
    USING (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can create conversations for their smart cores"
    ON conversations FOR INSERT
    WITH CHECK (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can update conversations of their smart cores"
    ON conversations FOR UPDATE
    USING (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
-- Messages policies
CREATE POLICY "Users can view messages of their conversations"
    ON messages FOR SELECT
    USING (conversation_id IN (
        SELECT id FROM conversations WHERE smart_core_id IN (
            SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    ));
CREATE POLICY "Users can create messages in their conversations"
    ON messages FOR INSERT
    WITH CHECK (conversation_id IN (
        SELECT id FROM conversations WHERE smart_core_id IN (
            SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    ));
-- Traces policies
CREATE POLICY "Users can view traces of their smart cores"
    ON traces FOR SELECT
    USING (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can create traces for their smart cores"
    ON traces FOR INSERT
    WITH CHECK (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can update traces of their smart cores"
    ON traces FOR UPDATE
    USING (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
-- Trace events policies
CREATE POLICY "Users can view trace events"
    ON trace_events FOR SELECT
    USING (trace_id IN (
        SELECT id FROM traces WHERE smart_core_id IN (
            SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    ));
CREATE POLICY "Users can create trace events"
    ON trace_events FOR INSERT
    WITH CHECK (trace_id IN (
        SELECT id FROM traces WHERE smart_core_id IN (
            SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    ));
-- Safeguards policies
CREATE POLICY "Users can view safeguards of their smart cores"
    ON safeguards FOR SELECT
    USING (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can create safeguards for their smart cores"
    ON safeguards FOR INSERT
    WITH CHECK (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can update safeguards of their smart cores"
    ON safeguards FOR UPDATE
    USING (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can delete safeguards of their smart cores"
    ON safeguards FOR DELETE
    USING (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
-- Safeguard logs policies
CREATE POLICY "Users can view safeguard logs"
    ON safeguard_logs FOR SELECT
    USING (safeguard_id IN (
        SELECT id FROM safeguards WHERE smart_core_id IN (
            SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    ));
CREATE POLICY "Users can create safeguard logs"
    ON safeguard_logs FOR INSERT
    WITH CHECK (safeguard_id IN (
        SELECT id FROM safeguards WHERE smart_core_id IN (
            SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
        )
    ));
-- Cost records policies
CREATE POLICY "Users can view cost records"
    ON cost_records FOR SELECT
    USING (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
CREATE POLICY "Users can create cost records"
    ON cost_records FOR INSERT
    WITH CHECK (smart_core_id IN (
        SELECT id FROM smart_cores WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be'
    ));
