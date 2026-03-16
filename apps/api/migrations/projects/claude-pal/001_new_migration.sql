-- Requires PostgreSQL 17+

CREATE TABLE user_requests (
    id         BIGINT                   GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    TEXT                     NOT NULL,
    command    TEXT                     NOT NULL,
    status     TEXT                     NOT NULL DEFAULT 'pending',
    metadata   JSONB                    NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE job_tasks (
    id           BIGINT                   GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id   BIGINT                   NOT NULL REFERENCES user_requests(id),
    tmux_session TEXT                     NOT NULL,
    worker_id    TEXT                     NOT NULL,
    error_msg    TEXT,
    started_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_requests_status  ON user_requests (status);
CREATE INDEX idx_user_requests_user_id ON user_requests (user_id);
CREATE INDEX idx_job_tasks_request_id  ON job_tasks (request_id);