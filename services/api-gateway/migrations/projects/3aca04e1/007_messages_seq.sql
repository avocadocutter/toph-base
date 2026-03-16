-- Add sequence column to guarantee message ordering within a conversation
ALTER TABLE cs_messages ADD COLUMN seq BIGSERIAL;
CREATE INDEX idx_cs_messages_contributor_seq ON cs_messages(contributor_id, seq);
DROP INDEX IF EXISTS idx_cs_messages_contributor;
