CREATE TABLE jade_accounts (
    account_id TEXT PRIMARY KEY,
    owner_user_id TEXT UNIQUE,
    balance BIGINT NOT NULL DEFAULT 0,
    allow_negative BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT jade_accounts_owner_shape CHECK (
        (owner_user_id IS NULL AND allow_negative) OR
        (owner_user_id IS NOT NULL AND NOT allow_negative)
    ),
    CONSTRAINT jade_accounts_nonnegative_player CHECK (allow_negative OR balance >= 0)
);

CREATE TABLE jade_journals (
    journal_id TEXT PRIMARY KEY,
    reason_code TEXT NOT NULL,
    match_id TEXT,
    rules_version TEXT NOT NULL,
    actor TEXT NOT NULL,
    total_debits BIGINT NOT NULL,
    total_credits BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT jade_journals_balanced CHECK (
        total_debits >= 0 AND
        total_credits >= 0 AND
        total_debits = total_credits
    )
);

CREATE TABLE jade_postings (
    journal_id TEXT NOT NULL REFERENCES jade_journals(journal_id),
    account_id TEXT NOT NULL REFERENCES jade_accounts(account_id),
    amount BIGINT NOT NULL,
    reason_code TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    match_id TEXT,
    rules_version TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (journal_id, account_id),
    CONSTRAINT jade_postings_nonzero CHECK (amount <> 0)
);

CREATE INDEX jade_postings_account_created_idx
    ON jade_postings (account_id, created_at DESC);
CREATE INDEX jade_postings_match_idx
    ON jade_postings (match_id)
    WHERE match_id IS NOT NULL;

CREATE TABLE jade_reservations (
    reservation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount BIGINT NOT NULL,
    status TEXT NOT NULL,
    runtime_id TEXT REFERENCES matches(runtime_id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT jade_reservations_amount CHECK (amount > 0),
    CONSTRAINT jade_reservations_status CHECK (
        status IN ('active', 'bound', 'released', 'consumed')
    ),
    CONSTRAINT jade_reservations_runtime_shape CHECK (
        (status = 'active' AND runtime_id IS NULL) OR
        (status IN ('bound', 'consumed') AND runtime_id IS NOT NULL) OR
        (status = 'released')
    )
);

CREATE UNIQUE INDEX jade_reservations_one_open_per_user
    ON jade_reservations (user_id)
    WHERE status IN ('active', 'bound');
CREATE UNIQUE INDEX jade_reservations_one_user_per_match
    ON jade_reservations (runtime_id, user_id)
    WHERE runtime_id IS NOT NULL;

CREATE TABLE jade_settlements (
    runtime_id TEXT NOT NULL REFERENCES matches(runtime_id),
    user_id TEXT NOT NULL,
    seat TEXT NOT NULL,
    delta BIGINT NOT NULL,
    balance_before BIGINT NOT NULL,
    balance_after BIGINT NOT NULL,
    journal_id TEXT NOT NULL REFERENCES jade_journals(journal_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (runtime_id, user_id),
    CONSTRAINT jade_settlements_seat CHECK (seat IN ('E', 'S', 'W', 'N')),
    CONSTRAINT jade_settlements_balance CHECK (
        balance_before >= 0 AND
        balance_after >= 0 AND
        balance_after = balance_before + delta
    )
);

CREATE TABLE jade_wallet_sync (
    user_id TEXT PRIMARY KEY,
    target_balance BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    synced_at TIMESTAMPTZ,
    CONSTRAINT jade_wallet_sync_target CHECK (target_balance >= 0),
    CONSTRAINT jade_wallet_sync_status CHECK (
        status IN ('pending', 'syncing', 'synced', 'error')
    )
);

CREATE INDEX jade_wallet_sync_pending_idx
    ON jade_wallet_sync (updated_at)
    WHERE status <> 'synced';
