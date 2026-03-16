-- Conversation persistence (one row per contributor, JSONB messages array)

CREATE TABLE cs_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contributor_id UUID NOT NULL UNIQUE REFERENCES cs_contributors(id) ON DELETE CASCADE,
  messages JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_cs_conversations_updated
BEFORE UPDATE ON cs_conversations
FOR EACH ROW
EXECUTE FUNCTION cs_update_timestamp();

-- RLS: service-role only
ALTER TABLE cs_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service full cs_conversations"
  ON cs_conversations FOR ALL
  USING (auth_role() = 'service_role');
