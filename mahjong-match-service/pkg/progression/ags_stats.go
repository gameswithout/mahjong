package progression

import (
	"context"
	"fmt"
	"strings"

	"github.com/AccelByte/accelbyte-go-sdk/services-api/pkg/repository"
	"github.com/AccelByte/accelbyte-go-sdk/services-api/pkg/utils/auth"
	"github.com/AccelByte/accelbyte-go-sdk/social-sdk/pkg/socialclient"
	"github.com/AccelByte/accelbyte-go-sdk/social-sdk/pkg/socialclient/user_statistic"
	"github.com/AccelByte/accelbyte-go-sdk/social-sdk/pkg/socialclientmodels"
)

// AGSStatsMirror projects §12.3 achievement statistics into AGS, so AGS's own
// incremental achievements can evaluate them.
//
// Deliberately built the same way as economy.AGSWalletMirror: confidential
// client, server token from the shared repositories, one API surface, and no
// opinion about when it is called. The mirror is a projection — our PostgreSQL
// tables remain the audit record.
type AGSStatsMirror struct {
	namespace string
	social    *socialclient.JusticeSocialService
	config    repository.ConfigRepository
	tokens    repository.TokenRepository
}

func NewAGSStatsMirror(
	namespace string,
	social *socialclient.JusticeSocialService,
	config repository.ConfigRepository,
	tokens repository.TokenRepository,
) *AGSStatsMirror {
	return &AGSStatsMirror{
		namespace: strings.TrimSpace(namespace),
		social:    social,
		config:    config,
		tokens:    tokens,
	}
}

// RecordHandStats writes one hand's achievement statistics in a single bulk
// call.
//
// The updates must already be de-duplicated by stat code — the v2 bulk API
// processes entries concurrently and warns that repeating a code in one
// request races. HandStats guarantees that; this method assumes it.
func (m *AGSStatsMirror) RecordHandStats(
	ctx context.Context,
	userID string,
	updates []StatUpdate,
) error {
	if m == nil || m.social == nil || m.namespace == "" {
		return fmt.Errorf("AGS statistics mirror is not initialized")
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return fmt.Errorf("AGS statistics mirror requires a user ID")
	}
	if len(updates) == 0 {
		return nil
	}

	// The v2 bulk endpoint is namespace-level and carries userId per entry
	// (/social/v2/admin/namespaces/{namespace}/statitems/value/bulk), so the
	// player is named on every row rather than in the path.
	body := make([]*socialclientmodels.BulkUserStatItemUpdate, 0, len(updates))
	for _, update := range updates {
		// Taking the address of the loop copies, not of `update`, so each
		// entry keeps its own values.
		statCode := update.StatCode
		strategy := update.Strategy
		value := update.Value
		owner := userID
		body = append(body, &socialclientmodels.BulkUserStatItemUpdate{
			StatCode:       &statCode,
			UpdateStrategy: &strategy,
			Value:          &value,
			UserID:         &owner,
		})
	}

	_, err := m.social.UserStatistic.BulkUpdateUserStatItemV2Short(
		&user_statistic.BulkUpdateUserStatItemV2Params{
			Namespace: m.namespace,
			Body:      body,
			Context:   ctx,
		},
		auth.AuthInfoWriter(
			auth.Session{Token: m.tokens, Config: m.config, Refresh: nil},
			[][]string{{"bearer"}},
			"",
		),
	)
	if err != nil {
		return fmt.Errorf("update AGS achievement statistics: %w", err)
	}
	return nil
}
