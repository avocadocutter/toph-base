-- Agent instances: named, persistently-managed deployments of an agent type.
-- Only instances with status='running' are loaded by core and serve client requests.

CREATE TABLE admin_agent_instances (
  id TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  agent_type_id TEXT NOT NULL REFERENCES admin_agent_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stopped',
  CONSTRAINT admin_agent_instances_status_check CHECK (status IN ('running', 'stopped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_agent_instances_agent_type ON admin_agent_instances(agent_type_id);
CREATE INDEX idx_admin_agent_instances_status ON admin_agent_instances(status);
