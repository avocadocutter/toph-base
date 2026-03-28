-- Migration: Move agent instances from database to in-memory storage
-- Date: 2026-02-02
-- Reason: Agent instances are ephemeral runtime state and should not be persisted
--
-- Architecture Change:
-- - BEFORE: admin_agent_instances table in Supabase (persistent)
-- - AFTER: InstanceTracker class with TTL-based auto-cleanup (in-memory)
--
-- Benefits:
-- - No stale data accumulation
-- - Auto-cleanup via 15-second TTL
-- - Correct abstraction (runtime state → volatile storage)
-- - Clean restarts without database pollution
--
-- Note: admin_agent_types table remains unchanged (persistent configuration)

-- Drop the admin_agent_instances table
-- CASCADE will drop related indexes and constraints
DROP TABLE IF EXISTS admin_agent_instances CASCADE;

-- Update the comment on admin_agent_types to clarify the new architecture
COMMENT ON TABLE admin_agent_types IS 'Configuration definitions for agent types. Agent instances are now tracked in-memory by the admin-backend service.';
