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
			return padWithBotSeats(members, sessionID, botPersonaPicks(response.Attributes)), nil
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

// botPersonaPicks reads the client-supplied "bot_personas" custom session
// attribute (set at session creation alongside "ai_practice"; see
// client/session.ts): a comma-separated list of persona IDs the player
// explicitly chose for their AI Practice opponents. Absent or empty means
// "select for me" — today's fixed mixed lineup — which is also exactly what
// any pre-persona client produces by never setting the attribute at all.
//
// Tokens are only sanitized here, not validated against the persona roster.
// An unrecognized ID is not this package's problem to reject:
// bots.BotPersonas already treats an unrecognized trailing segment on a bot
// user ID as "auto" for that seat, so rejecting it here would just mean the
// same leniency has to be re-implemented in two places.
func botPersonaPicks(attributes interface{}) []string {
	values, ok := attributes.(map[string]interface{})
	if !ok {
		return nil
	}
	raw, ok := values["bot_personas"].(string)
	if !ok {
		return nil
	}
	var picks []string
	for _, token := range strings.Split(raw, ",") {
		token = strings.TrimSpace(token)
		// A colon would corrupt the bot:<sessionID>:<index>:<personaID>
		// shape padWithBotSeats builds below, so a token carrying one is
		// dropped outright — this is a safety check, not a validity check.
		if token == "" || strings.Contains(token, ":") {
			continue
		}
		picks = append(picks, token)
	}
	return picks
}

// padWithBotSeats fills roster out to four members with deterministic bot
// IDs derived from sessionID, so repeated Roster() calls for the same
// session produce the same roster (EnsureMatch's idempotency depends on a
// stable roster hash across calls).
//
// picks names the personas the player explicitly requested, in no
// particular order relative to which physical seat each ends up in — the
// player never sees or chooses seat identity, only which personalities are
// somewhere at the table. Each pick is baked directly into the bot ID it
// produces (bot:<sessionID>:<index>:<personaID>) rather than tracked
// separately, so whichever physical seat gets assigned that ID later
// carries the right persona with no ordinal bookkeeping required. A slot
// beyond len(picks) — or a session with no picks at all — gets a bare ID,
// which bots.BotPersonas reads as "auto" and fills from the default mixed
// lineup.
func padWithBotSeats(members []string, sessionID string, picks []string) []string {
	padded := append([]string(nil), members...)
	pickIndex := 0
	for index := len(padded); index < 4; index++ {
		id := fmt.Sprintf("%s%s:%d", BotUserIDPrefix, sessionID, index+1)
		if pickIndex < len(picks) {
			id += ":" + picks[pickIndex]
			pickIndex++
		}
		padded = append(padded, id)
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

// Mode reads the client-supplied "full_rotation" custom session attribute,
// set at session creation alongside "ai_practice" (see client/session.ts).
//
// AI Practice wins when both are set. §11.4 makes Practice grant nothing, and
// §8.4 makes Full Rotation ranked; a session claiming to be both is
// contradictory, and resolving it toward the mode that awards nothing is the
// safe direction to be wrong in.
func (r AGSResolver) Mode(ctx context.Context, namespace, sessionID string) (Mode, error) {
	if r.GameSessions == nil {
		return "", fmt.Errorf("AGS Session client is not initialized")
	}
	response, err := r.GameSessions.GetGameSessionShort(
		game_session.NewGetGameSessionParamsWithContext(ctx).
			WithNamespace(namespace).
			WithSessionID(sessionID),
	)
	if err != nil {
		return "", fmt.Errorf("get AGS game session: %w", err)
	}
	if response == nil {
		return "", ErrSessionNotFound
	}
	return modeFromAttributes(response.Attributes), nil
}

func modeFromAttributes(attributes interface{}) Mode {
	if aiPracticeAttribute(attributes) {
		return ModeQuickPlay
	}
	if booleanAttribute(attributes, "full_rotation") {
		return ModeFullRotation
	}
	return ModeQuickPlay
}

// booleanAttribute reads a custom session attribute that AGS round-trips as
// arbitrary JSON, decoded as map[string]interface{}. Both a JSON boolean and a
// JSON string are accepted, matching how the client may serialize it.
func booleanAttribute(attributes interface{}, name string) bool {
	values, ok := attributes.(map[string]interface{})
	if !ok {
		return false
	}
	switch value := values[name].(type) {
	case bool:
		return value
	case string:
		return strings.EqualFold(value, "true")
	default:
		return false
	}
}
