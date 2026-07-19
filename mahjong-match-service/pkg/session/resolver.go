package session

import (
	"context"
	"errors"
)

var (
	ErrSessionNotFound = errors.New("game session not found")
	ErrSessionRoster   = errors.New("game session does not have exactly four active members")
	ErrSessionInactive = errors.New("game session is not active")
	ErrSessionIdentity = errors.New("game session identity does not match the request")
)

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
