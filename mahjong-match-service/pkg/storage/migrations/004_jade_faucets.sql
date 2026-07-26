-- §7.5 faucets: the daily play grants and the welfare top-up.
--
-- Both anti-farming guarantees are primary keys rather than application logic,
-- because the service runs more than one replica and polls the same completed
-- hand many times.

-- One row per player per completed hand. The primary key is what makes
-- recording idempotent: GetMatchState projects a finished hand on every poll,
-- so without it a single hand would count toward the daily grants indefinitely.
CREATE TABLE jade_hand_participation (
    user_id TEXT NOT NULL,
    runtime_id TEXT NOT NULL REFERENCES matches(runtime_id),
    utc_day DATE NOT NULL,
    -- AI Practice hands never pay Jade, but §7.5 makes one of them the
    -- prerequisite for the welfare top-up, so they are recorded too.
    practice BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, runtime_id)
);

CREATE INDEX jade_hand_participation_day_idx
    ON jade_hand_participation (user_id, utc_day, practice);

-- One row per player per UTC day per grant kind. The primary key is the
-- once-per-day rule: a concurrent double claim loses on insert rather than
-- being caught by a check that raced.
CREATE TABLE jade_daily_grants (
    user_id TEXT NOT NULL,
    utc_day DATE NOT NULL,
    grant_kind TEXT NOT NULL,
    journal_id TEXT NOT NULL REFERENCES jade_journals(journal_id),
    amount BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, utc_day, grant_kind),
    CONSTRAINT jade_daily_grants_kind CHECK (
        grant_kind IN ('welfare', 'first_hand', 'three_hands')
    ),
    CONSTRAINT jade_daily_grants_amount CHECK (amount > 0)
);

CREATE INDEX jade_daily_grants_day_idx
    ON jade_daily_grants (utc_day, grant_kind);
