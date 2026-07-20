package session

import (
	"context"
	"errors"
	"strings"
)

var (
	ErrSessionNotFound = errors.New("game session not found")
	ErrSessionRoster   = errors.New("game session does not have exactly four active members")
	ErrSessionInactive = errors.New("game session is not active")
	ErrSessionIdentity = errors.New("game session identity does not match the request")
)

// BotUserIDPrefix identifies a synthetic AI Practice bot seat rather than a
// real AGS user. Roster pads an under-filled ai_practice-flagged session's
// roster with IDs of this shape (see AGSResolver.Roster); the match
// runtime detects them the same way to permanently bot-control those
// seats. No real AGS user ID can collide with this prefix — AGS user IDs
// are opaque UUID-shaped strings, never containing a literal colon.
const BotUserIDPrefix = "bot:"

// IsBotUserID reports whether userID identifies a synthetic AI Practice
// bot seat rather than a real AGS user.
func IsBotUserID(userID string) bool {
	return strings.HasPrefix(userID, BotUserIDPrefix)
}

type Resolver interface {
	Roster(ctx context.Context, namespace, sessionID string) ([]string, error)
}

type StaticResolver struct {
	Members []string
}

func (r StaticResolver) Roster(context.Context, string, string) ([]string, error) {
	if len(r.Members) != 4 {
		return nil, ErrSessionRoster
	}
	return append([]string(nil), r.Members...), nil
}
