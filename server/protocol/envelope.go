package protocol

import (
	"encoding/json"
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
)

const Version = 1

type Envelope struct {
	Version   int             `json:"v"`
	Type      string          `json:"type"`
	RequestID string          `json:"request_id,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

type ServerReadyPayload struct {
	UserID     string `json:"user_id"`
	ServerTime string `json:"server_time"`
}

type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type MatchJoinRequest struct {
	MatchID string `json:"match_id"`
}

type MatchJoinedPayload struct {
	MatchID string               `json:"match_id"`
	Seat    rulesengine.Seat     `json:"seat"`
	View    rulesengine.SeatView `json:"view"`
}

type MatchCommandRequest struct {
	MatchID         string                     `json:"match_id"`
	Type            rulesengine.CommandType    `json:"type"`
	ExpectedVersion uint64                     `json:"expected_version,omitempty"`
	TileID          string                     `json:"tile_id,omitempty"`
	Claim           *rulesengine.ClaimResponse `json:"claim,omitempty"`
}

// MatchCommandAcceptedPayload contains no event snapshot or unredacted turn
// state. The separately projected match.state envelope is the only state
// payload a browser receives.
type MatchCommandAcceptedPayload struct {
	MatchID      string                `json:"match_id"`
	Seat         rulesengine.Seat      `json:"seat"`
	StateVersion uint64                `json:"state_version"`
	Phase        rulesengine.TurnPhase `json:"phase"`
}

type MatchStatePayload struct {
	MatchID string               `json:"match_id"`
	Seat    rulesengine.Seat     `json:"seat"`
	View    rulesengine.SeatView `json:"view"`
}

func NewEnvelope(messageType, requestID string, payload any) (Envelope, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return Envelope{}, err
	}

	return Envelope{
		Version:   Version,
		Type:      messageType,
		RequestID: requestID,
		Payload:   encoded,
	}, nil
}

func Ready(userID, requestID string, now time.Time) (Envelope, error) {
	return NewEnvelope("server.ready", requestID, ServerReadyPayload{
		UserID:     userID,
		ServerTime: now.UTC().Format(time.RFC3339Nano),
	})
}

func Error(requestID, code, message string) (Envelope, error) {
	return NewEnvelope("error", requestID, ErrorPayload{Code: code, Message: message})
}
