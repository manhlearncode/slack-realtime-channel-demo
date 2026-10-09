-- Server tự chạy file này lúc khởi động. CREATE IF NOT EXISTS giữ lại tin cũ.
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(64) NOT NULL,
    "user" VARCHAR(40) NOT NULL,
    text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4000),
    client_msg_id VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    ts TEXT GENERATED ALWAYS AS (
        (extract(epoch FROM (created_at AT TIME ZONE 'UTC'))::numeric(20, 6))::text
    ) STORED,
    CONSTRAINT messages_client_id_unique UNIQUE (channel_id, "user", client_msg_id)
);

CREATE INDEX IF NOT EXISTS messages_channel_history_idx
    ON messages (channel_id, id);
