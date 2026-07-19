package session

import (
	"context"
	"fmt"
	"strings"

	sessionsdk "github.com/AccelByte/accelbyte-go-sdk/services-api/pkg/service/session"
	"github.com/AccelByte/accelbyte-go-sdk/session-sdk/pkg/sessionclient/game_session"
	"github.com/AccelByte/accelbyte-go-sdk/session-sdk/pkg/sessionclientmodels"
)

type AGSResolver struct {
	GameSessions *sessionsdk.GameSessionService
}

func (r AGSResolver) Roster(ctx context.Context, namespace, sessionID string) ([]string, error) {
	if r.GameSessions == nil {
		return nil, fmt.Errorf("AGS Session client is not initialized")
	}
	response, err := r.GameSessions.GetGameSessionShort(
		game_session.NewGetGameSessionParamsWithContext(ctx).
			WithNamespace(namespace).
			WithSessionID(sessionID),
	)
	if err != nil {
		return nil, fmt.Errorf("get AGS game session: %w", err)
	}
	if response == nil {
		return nil, ErrSessionNotFound
	}
	return rosterFromResponse(response, namespace, sessionID)
}

func rosterFromResponse(
	response *sessionclientmodels.ApimodelsGameSessionResponse,
	namespace string,
	sessionID string,
) ([]string, error) {
	if response == nil {
		return nil, ErrSessionNotFound
	}
	if response.Namespace == nil || response.ID == nil ||
		*response.Namespace != namespace || *response.ID != sessionID {
		return nil, ErrSessionIdentity
	}
	if response.IsActive == nil || !*response.IsActive {
		return nil, ErrSessionInactive
	}
	members := make([]string, 0, len(response.Members))
	seen := make(map[string]struct{}, len(response.Members))
	for _, member := range response.Members {
		if member == nil || member.ID == nil || terminalStatus(member.StatusV2) {
			continue
		}
		userID := strings.TrimSpace(*member.ID)
		if userID == "" {
			continue
		}
		if _, exists := seen[userID]; exists {
			continue
		}
		seen[userID] = struct{}{}
		members = append(members, userID)
	}
	if len(members) != 4 {
		return nil, fmt.Errorf("%w: got %d", ErrSessionRoster, len(members))
	}
	return members, nil
}

func terminalStatus(status *string) bool {
	if status == nil {
		return false
	}
	switch strings.ToUpper(*status) {
	case "CANCELLED", "DROPPED", "KICKED", "LEFT", "REJECTED", "TERMINATED", "TIMEOUT":
		return true
	default:
		return false
	}
}
