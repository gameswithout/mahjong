package bots

import (
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
)

// ActionKind names the kind of table action a Decision carries.
type ActionKind string

const (
	ActionDiscard       ActionKind = "discard"
	ActionDeclareWin    ActionKind = "declare_win"
	ActionPong          ActionKind = "pong"
	ActionKong          ActionKind = "kong"
	ActionChow          ActionKind = "chow"
	ActionPass          ActionKind = "pass"
	ActionConcealedKong ActionKind = "concealed_kong"
	ActionAddedKong     ActionKind = "added_kong"
	ActionAcceptOffer   ActionKind = "accept_offer"
)

// Action is the concrete choice a policy made. TileID/TileIDs are populated
// only for the kinds that need them (discard, chow, concealed/added Kong).
type Action struct {
	Kind    ActionKind
	TileID  string
	TileIDs []string
}

// Decision is a fully replayable AI action (§11.4): rules version, AI
// version, difficulty, the observation it was computed from, and the
// bot-randomness seed are everything needed to reproduce Action
// deterministically, and everything a replay/audit trail records.
type Decision struct {
	RulesVersion string
	AIVersion    string
	Difficulty   Difficulty
	Seed         uint64
	Observation  Observation
	Action       Action
	ReactionTime time.Duration
}

func newDecision(difficulty Difficulty, seed uint64, obs Observation, action Action, reaction time.Duration) Decision {
	return Decision{
		RulesVersion: RulesVersion,
		AIVersion:    AIVersion,
		Difficulty:   difficulty,
		Seed:         seed,
		Observation:  obs,
		Action:       action,
		ReactionTime: reaction,
	}
}

// ClaimOptions is the set of legal claim choices available to one seat for a
// specific public discard, derived only from that seat's own Observation —
// nothing here requires information outside the §11.2 boundary.
type ClaimOptions struct {
	Discard  rulesengine.Tile
	CanWin   bool
	CanPong  bool
	CanKong  bool
	ChowSets [][2]string
}

// SelfKongOption is one legal self-turn Kong a bot could declare: either
// completing a concealed Kong from four matching hand tiles, or adding a
// self-drawn fourth tile to an already-exposed Pong.
type SelfKongOption struct {
	Added   bool
	TileID  string
	TileIDs []string
}
