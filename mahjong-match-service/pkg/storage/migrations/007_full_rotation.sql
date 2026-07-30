-- §8.4 Full Rotation: a container above the single-hand match runtime.
--
-- A rotation is several hands played by the same four players. Rather than
-- teach the match actor to hold more than one hand, each hand stays exactly
-- what it already is — its own row in matches, its own seat map, its own event
-- stream — and a rotation row sits above them holding the running table
-- points, the dealership, and the end condition.
--
-- The hand rows carry *winds*, not table positions. The dealer of a hand always
-- plays East (see rulesengine/winds.go), so the seat map of hand N is the
-- rotation's fixed table positions turned by whoever is dealing. That is what
-- lets TurnEngine play every hand as an ordinary East-dealer hand.

CREATE TABLE rotation_matches (
    -- The container's own runtime_id. Its matches row holds the fixed table
    -- positions in match_seats and never accumulates events of its own.
    runtime_id TEXT PRIMARY KEY REFERENCES matches(runtime_id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    -- The rulesengine.RotationState value: dealer, continuations, per-seat
    -- tallies, and the completion reason once it ends.
    state JSONB NOT NULL,
    -- Index of the most recently opened hand. Hands are numbered from 1.
    hand_index INT NOT NULL DEFAULT 0 CHECK (hand_index >= 0),
    complete BOOLEAN NOT NULL DEFAULT FALSE,
    -- Set once, when the rotation ends, so placement and XP are awarded from a
    -- single durable moment rather than recomputed per request.
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (complete = (completed_at IS NOT NULL))
);

CREATE TABLE rotation_hands (
    rotation_id TEXT NOT NULL REFERENCES rotation_matches(runtime_id) ON DELETE CASCADE,
    hand_index INT NOT NULL CHECK (hand_index >= 1),
    -- The hand's own runtime_id: an ordinary match, playable by the existing
    -- runtime with no knowledge that a rotation is above it.
    hand_runtime_id TEXT NOT NULL UNIQUE REFERENCES matches(runtime_id) ON DELETE CASCADE,
    dealer TEXT NOT NULL CHECK (dealer IN ('E', 'S', 'W', 'N')),
    continuations INT NOT NULL DEFAULT 0 CHECK (continuations >= 0),
    -- settled marks that this hand's result has been folded into the rotation
    -- state. The fold is a conditional UPDATE on this column inside the same
    -- transaction that writes the new state, so two replicas observing the same
    -- completed hand cannot both apply it. Double-counting table points would
    -- otherwise be silent: the settlement still balances, so nothing downstream
    -- would notice the standings were wrong.
    settled BOOLEAN NOT NULL DEFAULT FALSE,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (rotation_id, hand_index),
    CHECK (settled = (settled_at IS NOT NULL))
);

CREATE INDEX rotation_hands_open
    ON rotation_hands(rotation_id, hand_index DESC)
    WHERE NOT settled;
