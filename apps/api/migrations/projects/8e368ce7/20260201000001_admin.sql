-- Initial Supabase Schema Migration
-- This creates the core tables for agent configuration and instance tracking
-- Metrics and traces are handled via file storage (see file-storage-service.ts)

-- ============================================================================
-- Agent Types Table
-- Stores configuration for different agent types
-- ============================================================================
CREATE TABLE admin_agent_types (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  model TEXT NOT NULL, -- Format: "provider/modelId"
  tools JSONB NOT NULL,

  -- Pool configuration
  pool_min_size INTEGER NOT NULL DEFAULT 1,
  pool_max_size INTEGER NOT NULL DEFAULT 3,
  pool_idle_timeout_ms INTEGER NOT NULL DEFAULT 600000,
  pool_request_timeout_ms INTEGER NOT NULL DEFAULT 300000,

  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_agent_types_active ON admin_agent_types(is_active);
CREATE INDEX idx_admin_agent_types_created_at ON admin_agent_types(created_at);

-- ============================================================================
-- Agent Instances Table
-- Tracks running agent instances from core services
-- ============================================================================
CREATE TABLE admin_agent_instances (
  id VARCHAR(255) PRIMARY KEY,
  agent_type_id VARCHAR(255) NOT NULL REFERENCES admin_agent_types(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- 'initializing', 'ready', 'busy', 'error', 'shutting_down'
  host TEXT NOT NULL,
  pid INTEGER NOT NULL,
  current_request_id TEXT,
  last_heartbeat TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_agent_instances_agent_type_id ON admin_agent_instances(agent_type_id);
CREATE INDEX idx_admin_agent_instances_status ON admin_agent_instances(status);
CREATE INDEX idx_admin_agent_instances_last_heartbeat ON admin_agent_instances(last_heartbeat);

-- ============================================================================
-- Auto-update Trigger for updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_admin_agent_types_updated_at
  BEFORE UPDATE ON admin_agent_types
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON TABLE admin_agent_types IS 'Configuration definitions for agent types';
COMMENT ON TABLE admin_agent_instances IS 'Runtime tracking of agent instances with heartbeat monitoring';
COMMENT ON COLUMN admin_agent_types.tools IS 'JSON array of tool names available to this agent type';
COMMENT ON COLUMN admin_agent_types.model IS 'AI model identifier in format "provider/modelId"';
COMMENT ON COLUMN admin_agent_instances.status IS 'Current status: initializing, ready, busy, error, shutting_down';
COMMENT ON COLUMN admin_agent_instances.last_heartbeat IS 'Timestamp of last heartbeat for health monitoring';
