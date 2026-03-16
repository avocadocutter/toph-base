-- Replace cs_conversations (single JSONB column) with cs_messages (one row per message)

DROP TABLE IF EXISTS cs_conversations;

CREATE TABLE cs_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contributor_id UUID NOT NULL REFERENCES cs_contributors(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  pending_confirmation JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cs_messages_contributor ON cs_messages(contributor_id, created_at);

ALTER TABLE cs_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service full cs_messages"
  ON cs_messages FOR ALL
  USING (auth_role() = 'service_role');
