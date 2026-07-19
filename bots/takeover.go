package bots

import (
	"errors"
	"fmt"

	"github.com/gameswithout/mahjong/rulesengine"
)

// takeoverDifficulty is the "disclosed Medium takeover" policy §8.7/§11.1
// mandate: a taken-over seat plays as Medium, not as an always-Pass
// placeholder — the deadline/auto-discard mechanism in rulesengine would
// keep the match moving either way, but only this makes the takeover
// actually play the hand.
var takeoverDifficulty = NewMediumPolicy()

// ErrSeatNotTakenOver is returned when DriveTakeoverSeat is asked to act
// for a seat that is not currently under takeover.
var ErrSeatNotTakenOver = errors.New("bots: seat is not currently taken over")

// DriveTakeoverSeat computes and submits one action on behalf of a
// currently-taken-over seat (§8.7/§11.1), using the caller-supplied seed
// for reproducibility (§11.4). It handles the two decision points that
// would otherwise stall a match if left to the timeout/auto-discard
// fallback alone: the active seat's own turn (self-Kong/Zimo-then-discard,
// or a bare draw if still awaiting one) and a pending claim-window
// response. A rob window or a §5.9 offer pending for this seat is left to
// the existing deadline-driven auto-Pass/auto-decline behavior — both are
// already correct, legal outcomes for a Medium-equivalent player who
// simply doesn't rob/accept, just not exhaustively "smart" — a documented,
// bounded scope rather than a silent gap.
//
// Returns false, nil when there is currently nothing for this seat to do
// (e.g. it is taken over but not the active seat and has no pending claim
// response).
func DriveTakeoverSeat(
	engine *rulesengine.TurnEngine,
	seat, dealer, prevailingWind rulesengine.Seat,
	continuation int,
	seed uint64,
) (bool, error) {
	command, err := DecideTakeoverCommand(engine, seat, dealer, prevailingWind, continuation, seed)
	if err != nil || command == nil {
		return false, err
	}
	return true, applyTakeoverCommand(engine, command)
}

// DecideTakeoverCommand computes, but does not apply, the single action a
// currently-taken-over seat should take next (§8.7/§11.1), using the
// caller-supplied seed for reproducibility (§11.4). It is read-only against
// engine — callers driving an event-sourced match (where the engine is not
// directly mutable) can run this against MatchActor.Peek() and submit the
// resulting command through the actor's normal Apply path so the move is
// logged and replayed exactly like a human's; DriveTakeoverSeat is a thin
// wrapper for callers that hold a directly-mutable engine.
//
// It handles the two decision points that would otherwise stall a match if
// left to the timeout/auto-discard fallback alone: the active seat's own
// turn (self-Kong/Zimo-then-discard, or a bare draw if still awaiting one)
// and a pending claim-window response. A rob window or a §5.9 offer
// pending for this seat is left to the existing deadline-driven
// auto-Pass/auto-decline behavior — both are already correct, legal
// outcomes for a Medium-equivalent player who simply doesn't rob/accept,
// just not exhaustively "smart" — a documented, bounded scope rather than
// a silent gap.
//
// Returns nil, nil when there is currently nothing for this seat to do
// (e.g. it is taken over but not the active seat and has no pending claim
// response).
func DecideTakeoverCommand(
	engine *rulesengine.TurnEngine,
	seat, dealer, prevailingWind rulesengine.Seat,
	continuation int,
	seed uint64,
) (*rulesengine.MatchCommand, error) {
	if engine == nil {
		return nil, fmt.Errorf("bots: %w", ErrIncompleteState)
	}
	if !engine.IsTakenOver(seat) {
		return nil, ErrSeatNotTakenOver
	}

	switch engine.Phase {
	case rulesengine.PhaseAwaitingDraw:
		if engine.ActiveSeat != seat {
			return nil, nil
		}
		return &rulesengine.MatchCommand{
			Type:            rulesengine.CommandDraw,
			Seat:            seat,
			ExpectedVersion: engine.Version,
		}, nil

	case rulesengine.PhaseAwaitingDiscard:
		if engine.ActiveSeat != seat {
			return nil, nil
		}
		return decideTurnCommand(engine, seat, dealer, prevailingWind, continuation, seed)

	case rulesengine.PhaseClaimWindow:
		claim := engine.Claim
		if claim == nil || !seatEligibleFor(claim.Eligible, seat) {
			return nil, nil
		}
		if _, already := claim.Responses[seat]; already {
			return nil, nil
		}
		return decideClaimCommand(engine, seat, dealer, prevailingWind, continuation, seed, claim)

	default:
		return nil, nil
	}
}

// decideTurnCommand handles the active seat's own turn: declare a legal
// Win first (§11.3: always), then a self-Kong if Medium's policy takes one,
// otherwise discard.
func decideTurnCommand(
	engine *rulesengine.TurnEngine,
	seat, dealer, prevailingWind rulesengine.Seat,
	continuation int,
	seed uint64,
) (*rulesengine.MatchCommand, error) {
	obs, err := BuildObservation(engine, seat, dealer, prevailingWind, continuation)
	if err != nil {
		return nil, err
	}
	if rulesengine.CanWin(obs.Hand, obs.Melds) {
		return &rulesengine.MatchCommand{
			Type:            rulesengine.CommandDeclareZimo,
			Seat:            seat,
			ExpectedVersion: engine.Version,
		}, nil
	}
	if options := buildSelfKongOptions(obs.Hand, obs.Melds); len(options) > 0 {
		decision := DecideSelfKong(takeoverDifficulty, obs, options, seed)
		switch decision.Action.Kind {
		case ActionConcealedKong:
			return &rulesengine.MatchCommand{
				Type:            rulesengine.CommandDeclareConcealedKong,
				Seat:            seat,
				ExpectedVersion: engine.Version,
				TileIDs:         decision.Action.TileIDs,
			}, nil
		case ActionAddedKong:
			return &rulesengine.MatchCommand{
				Type:            rulesengine.CommandDeclareAddedKong,
				Seat:            seat,
				ExpectedVersion: engine.Version,
				TileID:          decision.Action.TileID,
			}, nil
		}
	}
	decision := DecideDiscard(takeoverDifficulty, obs, seed)
	if decision.Action.TileID == "" {
		return nil, fmt.Errorf("bots: takeover policy produced no discard for %s", seat)
	}
	return &rulesengine.MatchCommand{
		Type:            rulesengine.CommandDiscard,
		Seat:            seat,
		ExpectedVersion: engine.Version,
		TileID:          decision.Action.TileID,
	}, nil
}

// decideClaimCommand handles a pending claim-window response for seat.
func decideClaimCommand(
	engine *rulesengine.TurnEngine,
	seat, dealer, prevailingWind rulesengine.Seat,
	continuation int,
	seed uint64,
	claim *rulesengine.ClaimWindow,
) (*rulesengine.MatchCommand, error) {
	obs, err := BuildObservation(engine, seat, dealer, prevailingWind, continuation)
	if err != nil {
		return nil, err
	}
	canWin := !engine.IsWinLocked(seat) && rulesengine.DefaultWinValidator(engine.Deal, seat, claim.Discard.Tile)
	options := buildClaimOptions(obs.Hand, claim.Discard.Tile, canWin)
	// Chow is only offerable to the seat immediately after the discarder in
	// turn order (§5.6); buildClaimOptions has no notion of turn order, so
	// clear it out for every other seat.
	if seat != nextSeatAfter(claim.Discard.Seat) {
		options.ChowSets = nil
	}
	decision := DecideClaim(takeoverDifficulty, obs, options, seed)

	response := rulesengine.ClaimResponse{
		Seat:         seat,
		StateVersion: claim.StateVersion,
		ActionID:     claim.ActionID,
	}
	switch decision.Action.Kind {
	case ActionDeclareWin:
		response.Type = rulesengine.ClaimWin
	case ActionPong:
		response.Type = rulesengine.ClaimPong
	case ActionKong:
		response.Type = rulesengine.ClaimKong
	case ActionChow:
		response.Type = rulesengine.ClaimChow
		response.TileIDs = decision.Action.TileIDs
	default:
		response.Type = rulesengine.ClaimPass
		// A disclosed takeover bot's Pass is not the §5.8 "deliberate pass
		// on a legal Win" the human's own choice would be — it never
		// creates the discard-Win lock, matching a timeout Pass.
		response.Deliberate = false
	}
	return &rulesengine.MatchCommand{
		Type:            rulesengine.CommandSubmitClaim,
		Seat:            seat,
		ExpectedVersion: claim.StateVersion,
		Claim:           &response,
	}, nil
}

// applyTakeoverCommand applies a command previously computed by
// DecideTakeoverCommand directly against engine, using the same public
// engine methods a human player's own action would use. Event-sourced
// callers do not use this — they submit the command through their
// MatchActor's Apply instead, so the move is logged and replayable.
func applyTakeoverCommand(engine *rulesengine.TurnEngine, command *rulesengine.MatchCommand) error {
	switch command.Type {
	case rulesengine.CommandDraw:
		_, err := engine.Draw(command.ExpectedVersion)
		if err != nil && !errors.Is(err, rulesengine.ErrHandComplete) {
			return err
		}
		return nil
	case rulesengine.CommandDiscard:
		_, err := engine.Discard(command.ExpectedVersion, command.Seat, command.TileID)
		return err
	case rulesengine.CommandDeclareZimo:
		_, err := engine.DeclareZimo(command.ExpectedVersion, command.Seat)
		return err
	case rulesengine.CommandDeclareConcealedKong:
		_, err := engine.DeclareConcealedKong(command.ExpectedVersion, command.Seat, command.TileIDs)
		return err
	case rulesengine.CommandDeclareAddedKong:
		_, err := engine.DeclareAddedKong(command.ExpectedVersion, command.Seat, command.TileID)
		return err
	case rulesengine.CommandSubmitClaim:
		return engine.SubmitClaim(*command.Claim)
	default:
		return fmt.Errorf("bots: unsupported takeover command type %s", command.Type)
	}
}

func seatEligibleFor(eligible []rulesengine.Seat, seat rulesengine.Seat) bool {
	for _, candidate := range eligible {
		if candidate == seat {
			return true
		}
	}
	return false
}

var seatOrder = []rulesengine.Seat{rulesengine.East, rulesengine.South, rulesengine.West, rulesengine.North}

func nextSeatAfter(seat rulesengine.Seat) rulesengine.Seat {
	for index, candidate := range seatOrder {
		if candidate == seat {
			return seatOrder[(index+1)%len(seatOrder)]
		}
	}
	return seat
}
