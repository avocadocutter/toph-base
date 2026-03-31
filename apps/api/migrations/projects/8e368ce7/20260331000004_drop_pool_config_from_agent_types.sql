-- Pool configuration is no longer user-configurable.
-- Instances are created from the UI with just a name; the core uses fixed pool defaults.

ALTER TABLE admin_agent_types
  DROP COLUMN IF EXISTS pool_min_size,
  DROP COLUMN IF EXISTS pool_max_size,
  DROP COLUMN IF EXISTS pool_idle_timeout_ms,
  DROP COLUMN IF EXISTS pool_request_timeout_ms;
