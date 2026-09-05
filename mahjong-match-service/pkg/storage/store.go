package storage

import (
	"context"
	"fmt"
	"strings"
)

func (p *PostgreSQLStorage) HasStoreEntitlement(ctx context.Context, userID, sku string) (bool, error) {
	if p == nil || p.pool == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(sku) == "" {
		return false, fmt.Errorf("store repository is not initialized")
	}
	var owned bool
	err := p.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM store_orders
			WHERE user_id = $1 AND sku = $2 AND status = 'fulfilled'
		)`, userID, sku).Scan(&owned)
	if err != nil {
		return false, fmt.Errorf("read store entitlement: %w", err)
	}
	return owned, nil
}

func (p *PostgreSQLStorage) FulfillStoreOrder(ctx context.Context, orderID, userID, sku string, sandbox bool) error {
	if p == nil || p.pool == nil {
		return fmt.Errorf("store repository is not initialized")
	}
	_, err := p.pool.Exec(ctx, `
		INSERT INTO store_orders (provider, provider_order_id, user_id, sku, status, sandbox)
		VALUES ('xsolla', $1, $2, $3, 'fulfilled', $4)
		ON CONFLICT (provider, provider_order_id) DO UPDATE
		SET status = 'fulfilled', updated_at = NOW()
		WHERE store_orders.user_id = EXCLUDED.user_id AND store_orders.sku = EXCLUDED.sku`,
		orderID, userID, sku, sandbox)
	if err != nil {
		return fmt.Errorf("fulfill store order: %w", err)
	}
	return nil
}

func (p *PostgreSQLStorage) RevokeStoreOrder(ctx context.Context, orderID string) error {
	if p == nil || p.pool == nil {
		return fmt.Errorf("store repository is not initialized")
	}
	_, err := p.pool.Exec(ctx, `UPDATE store_orders SET status = 'revoked', updated_at = NOW() WHERE provider = 'xsolla' AND provider_order_id = $1`, orderID)
	if err != nil {
		return fmt.Errorf("revoke store order: %w", err)
	}
	return nil
}
