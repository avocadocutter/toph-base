-- Add user_id column to conversations table
-- This allows tracking which user initiated sandbox/test conversations

ALTER TABLE conversations
ADD COLUMN user_id UUID REFERENCES users(id);

-- Create index for faster lookups
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
