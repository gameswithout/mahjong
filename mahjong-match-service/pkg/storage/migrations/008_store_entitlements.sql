CREATE TABLE store_orders (
    provider TEXT NOT NULL,
    provider_order_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('fulfilled', 'revoked')),
    sandbox BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, provider_order_id)
);

CREATE INDEX store_orders_user_sku_active_idx
    ON store_orders (user_id, sku)
    WHERE status = 'fulfilled';
