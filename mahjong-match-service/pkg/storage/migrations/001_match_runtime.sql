CREATE TABLE matches (
    runtime_id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    session_id TEXT NOT NULL,
    match_id TEXT NOT NULL,
    roster_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (namespace, session_id, match_id)
);

CREATE TABLE match_seats (
    runtime_id TEXT NOT NULL REFERENCES matches(runtime_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    seat TEXT NOT NULL CHECK (seat IN ('E', 'S', 'W', 'N')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (runtime_id, user_id),
    UNIQUE (runtime_id, seat)
);

CREATE TABLE match_events (
    runtime_id TEXT NOT NULL REFERENCES matches(runtime_id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL CHECK (sequence > 0),
    request_id TEXT,
    event_type TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    state_version BIGINT NOT NULL,
    state_hash TEXT NOT NULL,
    command JSONB,
    result JSONB,
    snapshot JSONB,
    error_code TEXT,
    PRIMARY KEY (runtime_id, sequence)
);

CREATE UNIQUE INDEX match_events_request_id
    ON match_events(runtime_id, request_id)
    WHERE request_id IS NOT NULL AND request_id <> '';
