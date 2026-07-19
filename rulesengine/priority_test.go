package rulesengine

import (
	"errors"
	"testing"
	"time"
)

// TestClaimPriorityMatrix exercises the §5.8 precedence rule — Win beats
// Pong/Kong beats Chow — across the claim-type combinations that can
// legally coexist on one discard (a Pong and a Kong can never both be
// eligible on the same discard: with four copies per tile, only one seat
// can ever hold the other three or four copies).
func TestClaimPriorityMatrix(t *testing.T) {
	tests := []struct {
		name         string
		submit       func(t *testing.T, engine *TurnEngine, window *ClaimWindow)
		wantType     ClaimType
		wantClaimant Seat
	}{
		{
			name: "win beats pong and chow",
			submit: func(t *testing.T, engine *TurnEngine, window *ClaimWindow) {
				mustClaim(t, engine, ClaimResponse{Seat: South, Type: ClaimChow, TileIDs: []string{"characters-1-1", "characters-3-1"}, StateVersion: window.StateVersion})
				mustClaim(t, engine, ClaimResponse{Seat: West, Type: ClaimPong, TileIDs: []string{"characters-2-2", "characters-2-3"}, StateVersion: window.StateVersion})
				mustClaim(t, engine, ClaimResponse{Seat: North, Type: ClaimWin, StateVersion: window.StateVersion})
			},
			wantType: ClaimWin,
		},
		{
			name: "kong beats chow when no win present",
			submit: func(t *testing.T, engine *TurnEngine, window *ClaimWindow) {
				mustClaim(t, engine, ClaimResponse{Seat: South, Type: ClaimChow, TileIDs: []string{"characters-1-1", "characters-3-1"}, StateVersion: window.StateVersion})
				mustClaim(t, engine, ClaimResponse{Seat: West, Type: ClaimKong, TileIDs: []string{"characters-2-2", "characters-2-3", "characters-2-4"}, StateVersion: window.StateVersion})
				mustClaim(t, engine, ClaimResponse{Seat: North, Type: ClaimPass, StateVersion: window.StateVersion})
			},
			wantType:     ClaimKong,
			wantClaimant: West,
		},
		{
			name: "chow wins when it is the only claim",
			submit: func(t *testing.T, engine *TurnEngine, window *ClaimWindow) {
				mustClaim(t, engine, ClaimResponse{Seat: South, Type: ClaimChow, TileIDs: []string{"characters-1-1", "characters-3-1"}, StateVersion: window.StateVersion})
				mustClaim(t, engine, ClaimResponse{Seat: West, Type: ClaimPass, StateVersion: window.StateVersion})
				mustClaim(t, engine, ClaimResponse{Seat: North, Type: ClaimPass, StateVersion: window.StateVersion})
			},
			wantType:     ClaimChow,
			wantClaimant: South,
		},
		{
			name: "all pass advances turn with no claim",
			submit: func(t *testing.T, engine *TurnEngine, window *ClaimWindow) {
				for _, seat := range []Seat{South, West, North} {
					mustClaim(t, engine, ClaimResponse{Seat: seat, Type: ClaimPass, StateVersion: window.StateVersion})
				}
			},
			wantType: "",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			state := turnFixture(t)
			state.Players[0].Hand = []Tile{tile("characters-2-1", Characters, 2, 1)}
			state.Players[1].Hand = []Tile{
				tile("characters-1-1", Characters, 1, 1),
				tile("characters-3-1", Characters, 3, 1),
			}
			state.Players[2].Hand = []Tile{
				tile("characters-2-2", Characters, 2, 2),
				tile("characters-2-3", Characters, 2, 3),
				tile("characters-2-4", Characters, 2, 4),
			}
			// North waits on the discarded rank via a Chow (characters-1-2,
			// characters-3-2 + the characters-2 discard), not a pair, since
			// East/West already hold every other characters-2 copy.
			state.Players[3].Hand = []Tile{
				tile("characters-1-2", Characters, 1, 2),
				tile("characters-3-2", Characters, 3, 2),
				tile("dots-9-1", Dots, 9, 1),
				tile("dots-9-2", Dots, 9, 2),
			}
			state.Players[3].Melds = []Meld{pongMeld(Bamboo, 1), pongMeld(Bamboo, 2), pongMeld(Bamboo, 3), pongMeld(Dots, 1)}
			validator := func(_ *DealState, seat Seat, _ Tile) bool { return seat == North }
			engine := newTurnForClaims(t, state, validator)
			window := discardForClaims(t, engine, "characters-2-1")
			test.submit(t, engine, window)

			resolution, err := engine.ResolveClaims(window.StateVersion)
			if err != nil && !errors.Is(err, ErrHandComplete) {
				t.Fatalf("ResolveClaims() error = %v", err)
			}
			if resolution.Type != test.wantType {
				t.Fatalf("resolution type = %q, want %q", resolution.Type, test.wantType)
			}
			if test.wantClaimant != "" && resolution.Claimant != test.wantClaimant {
				t.Fatalf("claimant = %s, want %s", resolution.Claimant, test.wantClaimant)
			}
		})
	}
}

func mustClaim(t *testing.T, engine *TurnEngine, response ClaimResponse) {
	t.Helper()
	if err := engine.SubmitClaim(response); err != nil {
		t.Fatalf("SubmitClaim(%s, %s) error = %v", response.Seat, response.Type, err)
	}
}

// TestTimeoutNeverLocksWin proves the §5.8 distinction: a seat that never
// responds before the claim deadline is treated as Pass by ResolveClaims,
// but — unlike a deliberate Pass on a legal Win — it must never create the
// discard-Win lock, so the seat remains free to win normally afterward.
func TestTimeoutNeverLocksWin(t *testing.T) {
	state := turnFixture(t)
	validator := func(_ *DealState, seat Seat, _ Tile) bool { return seat == South }
	clock := time.Date(2026, 7, 18, 1, 2, 3, 0, time.UTC)
	engine := newTurnForClaimsWithClock(t, state, validator, &clock)
	window := discardForClaims(t, engine, "characters-1-1")

	// South never submits any response; West and North pass explicitly.
	mustClaim(t, engine, ClaimResponse{Seat: West, Type: ClaimPass, StateVersion: window.StateVersion})
	mustClaim(t, engine, ClaimResponse{Seat: North, Type: ClaimPass, StateVersion: window.StateVersion})

	clock = clock.Add(11 * time.Second)
	resolution, err := engine.ResolveClaims(window.StateVersion)
	if err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}
	if resolution.Type != "" || engine.ActiveSeat != South {
		t.Fatalf("resolution = %#v, active = %s", resolution, engine.ActiveSeat)
	}
	if engine.IsWinLocked(South) {
		t.Fatal("a timeout (no response) must never create the §5.8 discard-Win lock")
	}
}

// TestExhaustiveDrawFromPlainWallExhaustion drains the wall to the fixed
// 16-tile boundary and confirms a direct front Draw() — not a Kong
// replacement — ends the hand as an exhaustive draw with no Jade transfer
// context (§5.2, §5.11).
func TestExhaustiveDrawFromPlainWallExhaustion(t *testing.T) {
	state := turnFixture(t)
	for state.Wall.DrawableRemaining() > 0 {
		if _, err := state.Wall.DrawFront(); err != nil {
			t.Fatalf("draining wall error = %v", err)
		}
	}
	engine := newTurnForClaims(t, state, nil)
	engine.Phase = PhaseAwaitingDraw
	result, err := engine.Draw(engine.Version)
	if !errors.Is(err, ErrHandComplete) {
		t.Fatalf("Draw() at exhaustion error = %v", err)
	}
	if !result.Completed || engine.Phase != PhaseExhaustiveDraw {
		t.Fatalf("result = %#v, phase = %s", result, engine.Phase)
	}
	if handResult := engine.Result(); handResult == nil || handResult.Kind != KindExhaustiveDraw {
		t.Fatalf("hand result = %#v", handResult)
	}
}

// TestLastTileZimoFromBackOfDeque mirrors the front-draw last-tile case but
// for a Kong's replacement draw from the back of the deque: the final
// drawable tile can be the winning tile from either end (§5.9).
func TestLastTileZimoFromBackOfDeque(t *testing.T) {
	state := turnFixture(t)
	state.Players[0].Hand = []Tile{tile("characters-2-1", Characters, 2, 1)}
	// West's 16-tile hand: three concealed Pongs + the characters-2 triple it
	// will Kong, plus a single dots-5 half-pair. The Kong replacement must be
	// dots-5-2 to complete the hand (four Pongs + the dots-5 pair).
	west := make([]Tile, 0, 16)
	west = append(west, concealedPongTiles(Characters, 1)...)
	west = append(west, concealedPongTiles(Characters, 3)...)
	west = append(west, concealedPongTiles(Bamboo, 1)...)
	west = append(west, concealedPongTiles(Dots, 3)...)
	west = append(west,
		tile("dots-5-1", Dots, 5, 1),
		tile("characters-2-2", Characters, 2, 2),
		tile("characters-2-3", Characters, 2, 3),
		tile("characters-2-4", Characters, 2, 4),
	)
	state.Players[2].Hand = west

	for state.Wall.DrawableRemaining() > 1 {
		if _, err := state.Wall.DrawFront(); err != nil {
			t.Fatalf("draining wall error = %v", err)
		}
	}
	if state.Wall.DrawableRemaining() != 1 {
		t.Fatalf("drawable remaining = %d, want 1", state.Wall.DrawableRemaining())
	}
	// Force the single remaining drawable (replacement) tile to be dots-5-2,
	// the exact tile that completes West's hand.
	nextBackIndex := len(state.Wall.tiles) - state.Wall.back - 1
	state.Wall.tiles[nextBackIndex] = tile("dots-5-2", Dots, 5, 2)
	engine := newTurnForClaims(t, state, nil)
	engine.Phase = PhaseAwaitingDiscard
	window, err := engine.Discard(engine.Version, East, "characters-2-1")
	if err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	mustClaim(t, engine, ClaimResponse{Seat: West, Type: ClaimKong, TileIDs: []string{"characters-2-2", "characters-2-3", "characters-2-4"}, StateVersion: window.StateVersion})
	for _, seat := range []Seat{South, North} {
		mustClaim(t, engine, ClaimResponse{Seat: seat, Type: ClaimPass, StateVersion: window.StateVersion})
	}
	if _, err := engine.ResolveClaims(window.StateVersion); err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}
	if engine.Phase != PhaseAwaitingDiscard || engine.ActiveSeat != West {
		t.Fatalf("phase = %s, active = %s", engine.Phase, engine.ActiveSeat)
	}
	if state.Wall.DrawableRemaining() != 0 {
		t.Fatalf("drawable remaining = %d, want 0 after the replacement draw", state.Wall.DrawableRemaining())
	}
	if engine.lastDraw == nil || !engine.lastDraw.LastTile || !engine.lastDraw.Replacement {
		t.Fatalf("lastDraw = %#v, want LastTile+Replacement", engine.lastDraw)
	}
	result, err := engine.DeclareZimo(engine.Version, West)
	if err != nil {
		t.Fatalf("DeclareZimo() error = %v", err)
	}
	winner := result.Winners[0]
	if !winner.Context.LastTile || !winner.Context.Replacement {
		t.Fatalf("winner context = %#v", winner.Context)
	}
	if !hasPattern(winner.Score.Patterns, "Last Tile Zimo") || !hasPattern(winner.Score.Patterns, "Win After Replacement") {
		t.Fatalf("patterns = %#v", winner.Score.Patterns)
	}
}
