-- §12.1 XP awards and §12.2 levels.
--
-- Level is deliberately NOT stored. §12.2 requires the server to recompute
-- level from lifetime XP whenever the curve changes and to grant newly earned
-- rewards retroactively; deriving it on read makes that a code change rather
-- than a backfill.

CREATE TABLE player_xp (
    user_id TEXT PRIMARY KEY,
    lifetime_xp BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT player_xp_nonnegative CHECK (lifetime_xp >= 0)
);

-- One row per award. §12.1: "Server event IDs make every award idempotent."
-- award_id is that event ID, derived from what the award is for — hand:<match>:<user>,
-- onboarding:<user> — so the primary key is the idempotency guarantee rather
-- than an application check that could race between replicas.
--
-- Zero-amount rows are kept on purpose: a Practice hand played after the daily
-- cap is reached still records that the hand was priced, which is what stops it
-- being re-evaluated forever by the projection poll.
CREATE TABLE xp_awards (
    award_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    utc_day DATE NOT NULL,
    source TEXT NOT NULL,
    amount INTEGER NOT NULL,
    runtime_id TEXT REFERENCES matches(runtime_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT xp_awards_nonnegative CHECK (amount >= 0)
);

-- Serves the §12.1 Practice daily cap lookup.
CREATE INDEX xp_awards_daily_idx ON xp_awards (user_id, utc_day, source);
CREATE INDEX xp_awards_user_created_idx ON xp_awards (user_id, created_at DESC);

-- XP is append-only for the same reason the Jade ledger is: an award that can
-- be edited is not an audit record.
CREATE TRIGGER xp_awards_immutable
BEFORE UPDATE OR DELETE ON xp_awards
FOR EACH ROW EXECUTE FUNCTION prevent_jade_ledger_mutation();
