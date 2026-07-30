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

// Mode is which of §8's public modes a session is playing. It is fixed when
// the session is created and decides the shape of the match: Quick Play is one
// staked hand, Full Rotation is a ranked East round in table points (§8.4).
type Mode string

const (
	ModeQuickPlay    Mode = "quick_play"
	ModeFullRotation Mode = "full_rotation"
)

type Resolver interface {
	Roster(ctx context.Context, namespace, sessionID string) ([]string, error)
	// Mode reports which mode a session is playing. It is part of the
	// interface rather than an optional capability because the cost of an
	// implementation silently not answering is a Full Rotation session that
	// plays one hand and stops — a failure no error would surface.
	Mode(ctx context.Context, namespace, sessionID string) (Mode, error)
}

type StaticResolver struct {
	Members []string
	// SessionMode defaults to Quick Play, which is what every existing caller
	// and test means by an unset mode.
	SessionMode Mode
}

func (r StaticResolver) Roster(context.Context, string, string) ([]string, error) {
	if len(r.Members) != 4 {
		return nil, ErrSessionRoster
	}
	return append([]string(nil), r.Members...), nil
}

func (r StaticResolver) Mode(context.Context, string, string) (Mode, error) {
	if r.SessionMode == "" {
		return ModeQuickPlay, nil
	}
	return r.SessionMode, nil
}
