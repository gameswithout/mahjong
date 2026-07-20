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
		// AI Practice: a session explicitly flagged ai_practice=true may
		// start with fewer than four real members — pad the rest with
		// deterministic, per-session bot IDs rather than making the
		// player wait for three more humans who were never coming.
		if aiPracticeAttribute(response.Attributes) && len(members) >= 1 && len(members) < 4 {
			return padWithBotSeats(members, sessionID), nil
		}
		return nil, fmt.Errorf("%w: got %d", ErrSessionRoster, len(members))
	}
	return members, nil
}

// aiPracticeAttribute reads the client-supplied "ai_practice" custom
// session attribute (set at session creation; see client/session.ts).
// AGS round-trips arbitrary JSON here, decoded as map[string]interface{},
// so both a JSON boolean and a JSON string are accepted.
func aiPracticeAttribute(attributes interface{}) bool {
	values, ok := attributes.(map[string]interface{})
	if !ok {
		return false
	}
	switch value := values["ai_practice"].(type) {
	case bool:
		return value
	case string:
		return strings.EqualFold(value, "true")
	default:
		return false
	}
}

// padWithBotSeats fills roster out to four members with deterministic bot
// IDs derived from sessionID, so repeated Roster() calls for the same
// session produce the same roster (EnsureMatch's idempotency depends on a
// stable roster hash across calls).
func padWithBotSeats(members []string, sessionID string) []string {
	padded := append([]string(nil), members...)
	for index := len(padded); index < 4; index++ {
		padded = append(padded, fmt.Sprintf("%s%s:%d", BotUserIDPrefix, sessionID, index+1))
	}
	return padded
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
