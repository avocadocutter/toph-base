-- Grant permissions to authenticated users for all tables with RLS

GRANT ALL ON organizations TO authenticated;
GRANT ALL ON organization_members TO authenticated;
GRANT ALL ON agents TO authenticated;
GRANT ALL ON agent_versions TO authenticated;
GRANT ALL ON conversations TO authenticated;
GRANT ALL ON messages TO authenticated;
GRANT ALL ON traces TO authenticated;
GRANT ALL ON trace_events TO authenticated;
GRANT ALL ON safeguards TO authenticated;
GRANT ALL ON safeguard_logs TO authenticated;
GRANT ALL ON cost_records TO authenticated;
