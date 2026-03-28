DROP TABLE IF EXISTS job_tasks;
DROP TABLE IF EXISTS user_requests;

CREATE TABLE coding_sessions (
    id                BIGINT                   GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id           TEXT                     NOT NULL,
    status            TEXT                     NOT NULL DEFAULT 'pending',
    tmux_session_name TEXT,
    claude_session_id TEXT,
    created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_coding_sessions_status  ON coding_sessions (status);
CREATE INDEX idx_coding_sessions_user_id ON coding_sessions (user_id);