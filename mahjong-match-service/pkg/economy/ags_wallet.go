package economy

import (
	"context"
	"fmt"
	"strings"

	"github.com/AccelByte/accelbyte-go-sdk/platform-sdk/pkg/platformclient"
	"github.com/AccelByte/accelbyte-go-sdk/platform-sdk/pkg/platformclient/wallet"
	"github.com/AccelByte/accelbyte-go-sdk/platform-sdk/pkg/platformclientmodels"
	"github.com/AccelByte/accelbyte-go-sdk/services-api/pkg/repository"
	"github.com/AccelByte/accelbyte-go-sdk/services-api/pkg/utils/auth"
)

type AGSWalletMirror struct {
	namespace    string
	currencyCode string
	wallets      *platformclient.JusticePlatformService
	config       repository.ConfigRepository
	tokens       repository.TokenRepository
}

func NewAGSWalletMirror(
	namespace string,
	currencyCode string,
	wallets *platformclient.JusticePlatformService,
	config repository.ConfigRepository,
	tokens repository.TokenRepository,
) *AGSWalletMirror {
	return &AGSWalletMirror{
		namespace:    strings.TrimSpace(namespace),
		currencyCode: strings.TrimSpace(currencyCode),
		wallets:      wallets,
		config:       config,
		tokens:       tokens,
	}
}

func (m *AGSWalletMirror) Balance(ctx context.Context, userID string) (int64, error) {
	if m == nil || m.wallets == nil || m.namespace == "" || m.currencyCode == "" {
		return 0, fmt.Errorf("AGS Jade wallet mirror is not initialized")
	}
	response, err := m.wallets.Wallet.QueryUserCurrencyWalletsShort(
		&wallet.QueryUserCurrencyWalletsParams{
			Namespace: m.namespace,
			UserID:    userID,
			Context:   ctx,
		},
		auth.AuthInfoWriter(
			auth.Session{Token: m.tokens, Config: m.config, Refresh: nil},
			[][]string{{"bearer"}},
			"",
		),
	)
	if err != nil {
		return 0, fmt.Errorf("query AGS Jade wallet: %w", err)
	}
	if response == nil {
		return 0, fmt.Errorf("query AGS Jade wallet returned no response")
	}
	for _, candidate := range response.GetPayload() {
		if candidate == nil || candidate.CurrencyCode == nil ||
			!strings.EqualFold(*candidate.CurrencyCode, m.currencyCode) {
			continue
		}
		if candidate.Balance == nil {
			return 0, fmt.Errorf("AGS Jade wallet returned no balance")
		}
		return *candidate.Balance, nil
	}
	// AGS creates a virtual-currency wallet lazily on first credit.
	return 0, nil
}

func (m *AGSWalletMirror) Credit(ctx context.Context, userID string, amount int64) error {
	if amount <= 0 {
		return nil
	}
	_, err := m.wallets.Wallet.CreditUserWalletShort(
		&wallet.CreditUserWalletParams{
			Namespace:    m.namespace,
			UserID:       userID,
			CurrencyCode: m.currencyCode,
			Context:      ctx,
			Body: &platformclientmodels.CreditRequest{
				Amount: &amount,
				Origin: platformclientmodels.CreditRequestOriginSYSTEM,
				Source: platformclientmodels.CreditRequestSourceOTHER,
				Reason: "Mahjong Jade ledger reconciliation",
				Metadata: map[string]any{
					"authority": "mahjong-match-service",
					"currency":  CurrencyCode,
				},
			},
		},
		auth.AuthInfoWriter(
			auth.Session{Token: m.tokens, Config: m.config, Refresh: nil},
			[][]string{{"bearer"}},
			"",
		),
	)
	if err != nil {
		return fmt.Errorf("credit AGS Jade wallet: %w", err)
	}
	return nil
}

func (m *AGSWalletMirror) Debit(ctx context.Context, userID string, amount int64) error {
	if amount <= 0 {
		return nil
	}
	_, err := m.wallets.Wallet.DebitUserWalletByCurrencyCodeShort(
		&wallet.DebitUserWalletByCurrencyCodeParams{
			Namespace:    m.namespace,
			UserID:       userID,
			CurrencyCode: m.currencyCode,
			Context:      ctx,
			Body: &platformclientmodels.DebitByCurrencyCodeRequest{
				Amount:         &amount,
				AllowOverdraft: false,
				BalanceOrigin:  platformclientmodels.DebitByCurrencyCodeRequestBalanceOriginSYSTEM,
				BalanceSource:  platformclientmodels.DebitByCurrencyCodeRequestBalanceSourceOTHER,
				Reason:         "Mahjong Jade ledger reconciliation",
				Metadata: map[string]any{
					"authority": "mahjong-match-service",
					"currency":  CurrencyCode,
				},
			},
		},
		auth.AuthInfoWriter(
			auth.Session{Token: m.tokens, Config: m.config, Refresh: nil},
			[][]string{{"bearer"}},
			"",
		),
	)
	if err != nil {
		return fmt.Errorf("debit AGS Jade wallet: %w", err)
	}
	return nil
}
