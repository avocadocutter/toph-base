-- Drop existing policies and recreate with correct role
DROP POLICY IF EXISTS "Users can view their organizations" ON organizations;
DROP POLICY IF EXISTS "Users can create organizations" ON organizations;
DROP POLICY IF EXISTS "Owners can update their organizations" ON organizations;
DROP POLICY IF EXISTS "Users can view members of their organizations" ON organization_members;
DROP POLICY IF EXISTS "Users can add themselves to organizations" ON organization_members;
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
-- Recreate all policies with TO authenticated
-- Organizations policies
CREATE POLICY "Users can view their organizations"
    ON organizations FOR SELECT
    TO authenticated
    USING (id IN (SELECT get_user_org_ids()));
CREATE POLICY "Users can create organizations"
    ON organizations FOR INSERT
    TO authenticated
    WITH CHECK (true);
CREATE POLICY "Owners can update their organizations"
    ON organizations FOR UPDATE
    TO authenticated
    USING (id IN (
        SELECT organization_id
        FROM organization_members
        WHERE user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be' AND role = 'owner'
    ));
-- Organization members policies
CREATE POLICY "Users can view members of their organizations"
    ON organization_members FOR SELECT
    TO authenticated
    USING (organization_id IN (SELECT get_user_org_ids()));
CREATE POLICY "Users can add themselves to organizations"
    ON organization_members FOR INSERT
    TO authenticated
    WITH CHECK (user_id = 'ed3cca30-ef07-47a0-93e5-394d6b2257be');
-- Agents policies
CREATE POLICY "Users can view agents in their organizations"
    ON agents FOR SELECT
    TO authenticated
    USING (organization_id IN (SELECT get_user_org_ids()));
CREATE POLICY "Users can create agents in their organizations"
    ON agents FOR INSERT
    TO authenticated
    WITH CHECK (organization_id IN (SELECT get_user_org_ids()));
CREATE POLICY "Users can update agents in their organizations"
    ON agents FOR UPDATE
    TO authenticated
    USING (organization_id IN (SELECT get_user_org_ids()));
CREATE POLICY "Users can delete agents in their organizations"
    ON agents FOR DELETE
    TO authenticated
    USING (organization_id IN (SELECT get_user_org_ids()));
-- Agent versions policies
CREATE POLICY "Users can view versions of their agents"
    ON agent_versions FOR SELECT
    TO authenticated
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can create versions for their agents"
    ON agent_versions FOR INSERT
    TO authenticated
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can update versions of their agents"
    ON agent_versions FOR UPDATE
    TO authenticated
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
-- Conversations policies
CREATE POLICY "Users can view conversations of their agents"
    ON conversations FOR SELECT
    TO authenticated
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can create conversations for their agents"
    ON conversations FOR INSERT
    TO authenticated
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can update conversations of their agents"
    ON conversations FOR UPDATE
    TO authenticated
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
-- Messages policies
CREATE POLICY "Users can view messages of their conversations"
    ON messages FOR SELECT
    TO authenticated
    USING (conversation_id IN (
        SELECT id FROM conversations WHERE agent_id IN (
            SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
        )
    ));
CREATE POLICY "Users can create messages in their conversations"
    ON messages FOR INSERT
    TO authenticated
    WITH CHECK (conversation_id IN (
        SELECT id FROM conversations WHERE agent_id IN (
            SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
        )
    ));
-- Traces policies
CREATE POLICY "Users can view traces of their agents"
    ON traces FOR SELECT
    TO authenticated
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can create traces for their agents"
    ON traces FOR INSERT
    TO authenticated
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can update traces of their agents"
    ON traces FOR UPDATE
    TO authenticated
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
-- Trace events policies
CREATE POLICY "Users can view trace events"
    ON trace_events FOR SELECT
    TO authenticated
    USING (trace_id IN (
        SELECT id FROM traces WHERE agent_id IN (
            SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
        )
    ));
CREATE POLICY "Users can create trace events"
    ON trace_events FOR INSERT
    TO authenticated
    WITH CHECK (trace_id IN (
        SELECT id FROM traces WHERE agent_id IN (
            SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
        )
    ));
-- Safeguards policies
CREATE POLICY "Users can view safeguards of their agents"
    ON safeguards FOR SELECT
    TO authenticated
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can create safeguards for their agents"
    ON safeguards FOR INSERT
    TO authenticated
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can update safeguards of their agents"
    ON safeguards FOR UPDATE
    TO authenticated
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can delete safeguards of their agents"
    ON safeguards FOR DELETE
    TO authenticated
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
-- Safeguard logs policies
CREATE POLICY "Users can view safeguard logs"
    ON safeguard_logs FOR SELECT
    TO authenticated
    USING (safeguard_id IN (
        SELECT id FROM safeguards WHERE agent_id IN (
            SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
        )
    ));
CREATE POLICY "Users can create safeguard logs"
    ON safeguard_logs FOR INSERT
    TO authenticated
    WITH CHECK (safeguard_id IN (
        SELECT id FROM safeguards WHERE agent_id IN (
            SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
        )
    ));
-- Cost records policies
CREATE POLICY "Users can view cost records"
    ON cost_records FOR SELECT
    TO authenticated
    USING (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
CREATE POLICY "Users can create cost records"
    ON cost_records FOR INSERT
    TO authenticated
    WITH CHECK (agent_id IN (
        SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
    ));
