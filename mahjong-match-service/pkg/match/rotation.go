package match

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/gameswithout/mahjong/bots"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
)

// Full Rotation (§8.4) sits above the single-hand match runtime rather than
// inside it.
//
// A rotation is a container: fixed table positions, running table points, and
// a dealership that moves. Each of its hands is an ordinary match — its own
// matches row, its own seat map, its own event stream — played by the code
// that already plays Quick Play. Nothing in TurnEngine, MatchActor, or the
// event log knows a rotation exists.
//
// What makes that possible is the wind mapping (rulesengine/winds.go): the
// dealer of a hand always plays East, so a hand dealt by the player at table
// position South is dealt, played, and logged exactly like any East-dealer
// hand. The runtime converts between winds and table positions at one
// boundary, when a completed hand is folded into the rotation.

// InterHandPause is how long a completed hand's result stays on screen before
// the next hand opens.
//
// It is a fixed interval rather than a readiness handshake because a handshake
// gives a disconnected player a way to stall the table, and §8.4 already
// constrains a match to 60 minutes. Measuring it from the durable settled_at
// timestamp rather than from each replica's clock-in means every replica opens
// the next hand at the same moment.
const InterHandPause = 25 * time.Second

// RotationRepository is the storage a rotation needs beyond an ordinary match.
type RotationRepository interface {
	EnsureRotation(context.Context, storage.MatchKey, []string, time.Time) (storage.RotationRecord, bool, error)
	GetRotation(context.Context, storage.MatchKey) (storage.RotationRecord, error)
	OpenHand(context.Context, storage.RotationRecord, int, rulesengine.Seat, int) (storage.RotationHand, error)
	Hand(context.Context, storage.RotationRecord, int) (storage.RotationHand, error)
	SettleHand(context.Context, string, int, rulesengine.RotationState, time.Time) (bool, error)
	Hands(context.Context, string) ([]storage.RotationHand, error)
}

// TableView is what a player sees: the hand in front of them, plus the
// rotation around it when there is one.
type TableView struct {
	rulesengine.SeatView
	// HandRuntimeID identifies the hand this view is of. In Quick Play it is
	// the match's runtime ID; in a rotation it is this hand's. Anything that
	// must happen once per hand — XP, statistics — keys on it, so that a
	// rotation pays for each of its hands rather than once for the match.
	HandRuntimeID string
	// Rotation is nil for Quick Play and AI Practice.
	Rotation *RotationView
	// BotPersonas names the playing style seated at each AI Practice bot
	// seat, so the client can show "Swift Sparrow · Rush" rather than three
	// identical "Bot" labels. Empty for any table without bot seats, and
	// never populated for a disconnect takeover — that seat plays the
	// neutral policy, and naming a style there would be a lie.
	BotPersonas map[rulesengine.Seat]bots.Persona
	// DiscardsMade and DiscardsEfficient are this seat's tile-efficiency
	// tally for the hand, counted as it was played. Both are zero when no
	// tally was observed, which the statistics layer treats as "this hand
	// contributes nothing" rather than as a zero score.
	DiscardsMade      int
	DiscardsEfficient int
}

// RotationView is the state of a rotation, expressed in player identities
// rather than seats.
//
// Seats would be ambiguous here in a way that matters: a player's wind changes
// every time the dealership moves, so "South has 40 points" means a different
// person each hand. Standings are per player for the whole rotation, so they
// are reported per player.
type RotationView struct {
	HandNumber    int    `json:"hand_number"`
	HandsPlayed   int    `json:"hands_played"`
	Continuations int    `json:"continuations"`
	DealerUserID  string `json:"dealer_user_id"`
	// SeatsDealt out of rulesengine.SeatCount. §8.4 ends the rotation when
	// every position has dealt, which continuations can postpone, so this is
	// the honest measure of progress — not HandsPlayed.
	SeatsDealt int                `json:"seats_dealt"`
	Standings  []RotationStanding `json:"standings"`
	// TimeLimitAt is when §8.4's 60 minutes expire. The hand in progress at
	// that moment is finished before the match ends.
	TimeLimitAt time.Time `json:"time_limit_at"`
	Complete    bool      `json:"complete"`
	// Reason distinguishes the rotation running its course from the time limit
	// cutting it short. §8.4 makes the frequency of the latter a required
	// telemetry metric, so the two are never merged.
	Reason rulesengine.RotationCompletionKind `json:"reason,omitempty"`
	// NextHandOpensAt is set while a completed hand's result is on screen and
	// the rotation continues.
	NextHandOpensAt *time.Time          `json:"next_hand_opens_at,omitempty"`
	Placements      []RotationPlacement `json:"placements,omitempty"`
}

// RotationStanding is one player's running record.
type RotationStanding struct {
	UserID string `json:"user_id"`
	// Position is the player's fixed table position for the whole rotation.
	Position rulesengine.Seat `json:"position"`
	// Wind is the seat they are playing this hand, which turns with the
	// dealership. It is what the current hand's view calls them.
	Wind        rulesengine.Seat `json:"wind"`
	TablePoints int64            `json:"table_points"`
	DealIns     int              `json:"deal_ins"`
	ZimoWins    int              `json:"zimo_wins"`
	RawTaiWon   int              `json:"raw_tai_won"`
	Dealing     bool             `json:"dealing"`
	HasDealt    bool             `json:"has_dealt"`
}

// RotationPlacement is one player's final standing, set once the match ends.
type RotationPlacement struct {
	UserID      string `json:"user_id"`
	Position    int    `json:"position"`
	TablePoints int64  `json:"table_points"`
	// RatingTie marks equal table points. §8.4 treats those as a genuine tie
	// for rating even though the podium shows an order, so anything computing
	// Elo must not read Position as a strict result.
	RatingTie bool `json:"rating_tie"`
}

// rotationTable is a resolved rotation: the container, the hand being played,
// and the actor for it.
type rotationTable struct {
	record storage.RotationRecord
	hand   storage.RotationHand
}

// openRotation creates or reads the rotation for key and makes sure a hand is
// open. It is called from Join, the only entry point allowed to create.
func (r *Runtime) openRotation(
	ctx context.Context,
	key storage.MatchKey,
	roster []string,
) (*rotationTable, error) {
	if r.rotations == nil {
		return nil, fmt.Errorf("full rotation storage is not configured")
	}
	record, _, err := r.rotations.EnsureRotation(ctx, key, roster, r.now())
	if err != nil {
		return nil, err
	}
	return r.currentHand(ctx, record)
}

// loadRotation reads an existing rotation. It returns storage.ErrRotationNotFound
// for an ordinary match, which is how callers tell the two apart.
func (r *Runtime) loadRotation(ctx context.Context, key storage.MatchKey) (*rotationTable, error) {
	if r.rotations == nil {
		return nil, storage.ErrRotationNotFound
	}
	record, err := r.rotations.GetRotation(ctx, key)
	if err != nil {
		return nil, err
	}
	return r.currentHand(ctx, record)
}

// currentHand returns the hand a rotation is currently on, opening the first
// one if the rotation has just been created.
func (r *Runtime) currentHand(
	ctx context.Context,
	record storage.RotationRecord,
) (*rotationTable, error) {
	index := record.HandIndex
	if index < 1 {
		// The rotation has no hand yet. East deals the first, with no
		// continuations behind it.
		hand, err := r.rotations.OpenHand(ctx, record, 1, rulesengine.East, 0)
		if err != nil {
			return nil, err
		}
		record.HandIndex = 1
		return &rotationTable{record: record, hand: hand}, nil
	}
	// A read, not an open. The current hand cannot be reconstructed from the
	// rotation state: once a hand has been folded the state's dealer is the
	// *next* hand's, while the hand index still names the one just finished.
	hand, err := r.rotations.Hand(ctx, record, index)
	if err != nil {
		return nil, err
	}
	return &rotationTable{record: record, hand: hand}, nil
}

// foldCompletedHand folds a finished hand into the rotation, exactly once
// across every replica, and opens the next hand when the result has been on
// screen long enough.
//
// It returns the table the caller should serve. That is usually the same one,
// but becomes the next hand once the inter-hand pause has elapsed.
func (r *Runtime) foldCompletedHand(
	ctx context.Context,
	table *rotationTable,
	current *loadedMatch,
) (*rotationTable, error) {
	engine := current.actor.Peek()
	if engine == nil || engine.Result() == nil {
		return table, nil
	}

	if !table.hand.Settled {
		// The engine reports the result in winds. The rotation tallies table
		// positions. This is the only place the two are converted.
		rebased, rebaseErr := rulesengine.RebaseHandResult(engine.Result(), table.hand.Dealer)
		if rebaseErr != nil {
			return table, rebaseErr
		}
		outcome, applyErr := table.record.State.ApplyHand(rebased, dealerTingAtDraw(engine), r.now())
		if applyErr != nil {
			if errors.Is(applyErr, rulesengine.ErrRotationComplete) {
				// Another replica finished the rotation between our read and
				// now. Re-read rather than write a state derived from a stale one.
				return r.reloadRotation(ctx, table)
			}
			return table, applyErr
		}
		applied, settleErr := r.rotations.SettleHand(
			ctx, table.record.RuntimeID, table.hand.Index, outcome.State, r.now(),
		)
		if settleErr != nil {
			return table, settleErr
		}
		if !applied {
			// A concurrent replica folded this hand first. Its state is
			// authoritative; ours was computed from the same inputs but must
			// not be trusted over a committed write.
			return r.reloadRotation(ctx, table)
		}
		refreshed, reloadErr := r.reloadRotation(ctx, table)
		if reloadErr != nil {
			return table, reloadErr
		}
		table = refreshed
	}

	if table.record.State.Complete || table.hand.SettledAt == nil {
		return table, nil
	}
	if r.now().Before(table.hand.SettledAt.Add(InterHandPause)) {
		return table, nil
	}
	next, err := r.rotations.OpenHand(
		ctx, table.record, table.hand.Index+1,
		table.record.State.Dealer, table.record.State.Continuations,
	)
	if err != nil {
		return table, err
	}
	table.record.HandIndex = next.Index
	return &rotationTable{record: table.record, hand: next}, nil
}

// reloadRotation re-reads the rotation and the hand the caller was on, after a
// write that another replica may have raced.
func (r *Runtime) reloadRotation(ctx context.Context, table *rotationTable) (*rotationTable, error) {
	record, err := r.rotations.GetRotation(ctx, table.record.Key)
	if err != nil {
		return table, err
	}
	hands, err := r.rotations.Hands(ctx, record.RuntimeID)
	if err != nil {
		return table, err
	}
	for _, hand := range hands {
		if hand.Index != table.hand.Index {
			continue
		}
		// Hands() reports the hand row; the match record it was played as is
		// already resolved and does not change.
		hand.Match = table.hand.Match
		return &rotationTable{record: record, hand: hand}, nil
	}
	return &rotationTable{record: record, hand: table.hand}, nil
}

// dealerTingAtDraw reports whether the dealer was Ting at an exhaustive draw,
// which is what §5.11 uses to decide whether the dealership is retained. It is
// meaningless for any other ending, and NextDealerState ignores it there.
//
// The dealer is East in every hand, rotation or not, because winds turn with
// the dealership.
func dealerTingAtDraw(engine *rulesengine.TurnEngine) bool {
	result := engine.Result()
	if result == nil || result.Kind != rulesengine.KindExhaustiveDraw {
		return false
	}
	for _, player := range engine.Deal.Players {
		if player.Seat != rulesengine.East {
			continue
		}
		waits, _ := rulesengine.WinningTiles(player.Hand, player.Melds)
		return len(waits) > 0
	}
	return false
}

// rotationView builds the player-facing rotation state.
func (r *Runtime) rotationView(table *rotationTable) (*RotationView, error) {
	state := table.record.State
	view := &RotationView{
		HandNumber:    table.hand.Index,
		HandsPlayed:   state.HandsPlayed,
		Continuations: state.Continuations,
		SeatsDealt:    state.SeatsDealt(),
		TimeLimitAt:   state.StartedAt.Add(rulesengine.MatchTimeLimit),
		Complete:      state.Complete,
		Reason:        state.CompletionReason,
	}

	positions := make(map[rulesengine.Seat]string, len(table.record.Seats))
	for userID, position := range table.record.Seats {
		positions[position] = userID
	}
	view.DealerUserID = positions[table.hand.Dealer]

	for position, userID := range positions {
		tally := state.Tallies[position]
		if tally == nil {
			return nil, fmt.Errorf("rotation has no tally for position %s", position)
		}
		wind, err := rulesengine.SeatWind(position, table.hand.Dealer)
		if err != nil {
			return nil, err
		}
		view.Standings = append(view.Standings, RotationStanding{
			UserID:      userID,
			Position:    position,
			Wind:        wind,
			TablePoints: tally.TablePoints,
			DealIns:     tally.DealIns,
			ZimoWins:    tally.ZimoWins,
			RawTaiWon:   tally.RawTaiWon,
			Dealing:     position == table.hand.Dealer,
			HasDealt:    tally.HasDealt,
		})
	}
	// Standings are ranked live so the inter-hand screen can show the table in
	// order. Ties keep §8.4's display tie-break; the map above is iterated in
	// Go's randomized order, so without this the list would reshuffle between
	// polls even when nothing changed.
	sort.Slice(view.Standings, func(i, j int) bool {
		left, right := view.Standings[i], view.Standings[j]
		if left.TablePoints != right.TablePoints {
			return left.TablePoints > right.TablePoints
		}
		if left.DealIns != right.DealIns {
			return left.DealIns < right.DealIns
		}
		if left.ZimoWins != right.ZimoWins {
			return left.ZimoWins > right.ZimoWins
		}
		if left.RawTaiWon != right.RawTaiWon {
			return left.RawTaiWon > right.RawTaiWon
		}
		return left.Position < right.Position
	})

	if state.Complete {
		placements, err := state.FinalPlacement(table.record.SeatOrder())
		if err != nil {
			return nil, err
		}
		for _, placement := range placements {
			view.Placements = append(view.Placements, RotationPlacement{
				UserID:      positions[placement.Seat],
				Position:    placement.Position,
				TablePoints: placement.TablePoints,
				RatingTie:   placement.RatingTie,
			})
		}
	} else if table.hand.SettledAt != nil {
		opensAt := table.hand.SettledAt.Add(InterHandPause)
		view.NextHandOpensAt = &opensAt
	}
	return view, nil
}
