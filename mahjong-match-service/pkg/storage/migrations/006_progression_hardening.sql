-- Harden the initial P2.1 projection without rewriting migration 005, which
-- may already have been applied to a developer database.

ALTER TABLE xp_awards
    ADD COLUMN components JSONB NOT NULL DEFAULT '[]'::JSONB,
    ADD COLUMN capped_by_daily BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN rules_version TEXT NOT NULL DEFAULT 'taiwanese-16-v1.1';

CREATE TABLE onboarding_progress (
    user_id TEXT PRIMARY KEY,
    outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'skipped')),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reward grants are monotonic. The current curve is re-evaluated on every
-- progression read and newly eligible rows are inserted, while an old grant
-- remains even if a later curve moves or removes its milestone.
CREATE TABLE progression_reward_grants (
    user_id TEXT NOT NULL,
    reward_code TEXT NOT NULL,
    level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 50),
    reward_kind TEXT NOT NULL,
    reward_name TEXT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, reward_code)
);

CREATE INDEX progression_reward_grants_user_level_idx
    ON progression_reward_grants (user_id, level, reward_code);

CREATE TRIGGER progression_reward_grants_immutable
BEFORE UPDATE OR DELETE ON progression_reward_grants
FOR EACH ROW EXECUTE FUNCTION prevent_jade_ledger_mutation();

-- A later tutorial replay may turn "skipped" into "completed", but a
-- completed tutorial must never regress to skipped.
CREATE FUNCTION prevent_onboarding_regression() RETURNS trigger AS $$
BEGIN
    IF OLD.outcome = 'completed' AND NEW.outcome <> 'completed' THEN
        RAISE EXCEPTION 'completed onboarding cannot regress';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onboarding_progress_no_regression
BEFORE UPDATE ON onboarding_progress
FOR EACH ROW EXECUTE FUNCTION prevent_onboarding_regression();
