package match

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
)

// These tests target driveLocked's §5.9 offer and rob-window branches — the
// two decision points nothing else in the runtime can resolve (the player
// command surface rejects offer/rob responses, and untimed AI Practice
// matches have no deadline for the timeout fallback to fire on), so a
// missed branch here is a permanently stalled match, not a slow one.

func suited(kind rulesengine.TileKind, rank, copy uint8) rulesengine.Tile {
	return rulesengine.Tile{
		ID:   fmt.Sprintf("%s-%d-%d", kind, rank, copy),
		Kind: kind,
		Rank: rank,
		Copy: copy,
	}
}

func tripletOf(kind rulesengine.TileKind, rank uint8) []rulesengine.Tile {
	return []rulesengine.Tile{suited(kind, rank, 1), suited(kind, rank, 2), suited(kind, rank, 3)}
}

// heavenlyHand17 is a dealt 17-tile winning hand (5 triplets + a pair),
// which makes continueInitialReplacement raise the §5.9 Heavenly offer.
func heavenlyHand17() []rulesengine.Tile {
	hand := append([]rulesengine.Tile(nil), tripletOf(rulesengine.Characters, 1)...)
	hand = append(hand, tripletOf(rulesengine.Characters, 2)...)
	hand = append(hand, tripletOf(rulesengine.Characters, 3)...)
	hand = append(hand, tripletOf(rulesengine.Characters, 4)...)
	hand = append(hand, tripletOf(rulesengine.Bamboo, 1)...)
	return append(hand, suited(rulesengine.Dots, 1, 1), suited(rulesengine.Dots, 1, 2))
}

// pairlessJunk13 cannot win in any decomposition (no pair exists).
func pairlessJunk13() []rulesengine.Tile {
	return []rulesengine.Tile{
		suited(rulesengine.Characters, 1, 1), suited(rulesengine.Characters, 2, 1),
		suited(rulesengine.Characters, 7, 1), suited(rulesengine.Characters, 8, 1),
		suited(rulesengine.Bamboo, 1, 1), suited(rulesengine.Bamboo, 2, 1),
		suited(rulesengine.Bamboo, 7, 1), suited(rulesengine.Bamboo, 8, 1),
		suited(rulesengine.Dots, 1, 1), suited(rulesengine.Dots, 2, 1),
		suited(rulesengine.Dots, 5, 1), suited(rulesengine.Dots, 7, 1),
		suited(rulesengine.Dots, 8, 1),
	}
}

// craftedPracticeMatch deals a real wall, overwrites East's hand/melds with
// the crafted fixture (the same in-package technique rulesengine's own
// tests use), applies the AI Practice untimed preset, marks botSeats, and
// stands the actor up through BeginInitialReplacement exactly as
// loadLocked would.
func craftedPracticeMatch(
	t *testing.T,
	eastHand []rulesengine.Tile,
	eastMelds []rulesengine.Meld,
	botSeats []rulesengine.Seat,
	now func() time.Time,
) (*Runtime, *loadedMatch) {
	t.Helper()
	deal, err := rulesengine.Deal(42, [2]uint8{3, 5})
	if err != nil {
		t.Fatalf("Deal() error = %v", err)
	}
	for index := range deal.Players {
		if deal.Players[index].Seat == rulesengine.East {
			deal.Players[index].Hand = append([]rulesengine.Tile(nil), eastHand...)
			deal.Players[index].Melds = append([]rulesengine.Meld(nil), eastMelds...)
		}
	}
	engine, err := rulesengine.NewTurnEngine(deal, now)
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	deadlines, err := rulesengine.NewDeadlineConfig(rulesengine.ContextAIPractice, false, 0)
	if err != nil {
		t.Fatalf("NewDeadlineConfig() error = %v", err)
	}
	engine.SetDeadlineConfig(deadlines)
	for _, seat := range botSeats {
		engine.MarkBotSeat(seat)
	}
	ctx := context.Background()
	actor, err := rulesengine.NewMatchActor(ctx, "match-drive-fixture", engine, rulesengine.NewMemoryEventStore(), now)
	if err != nil {
		t.Fatalf("NewMatchActor() error = %v", err)
	}
	if _, err := actor.Apply(ctx, rulesengine.MatchCommand{
		RequestID: "server:initial-replacement",
		Type:      rulesengine.CommandBeginInitialReplacement,
	}); err != nil {
		t.Fatalf("BeginInitialReplacement error = %v", err)
	}
	runtime := NewRuntime(nil, nil, rulesengine.NewMemoryEventStore(), now)
	current := &loadedMatch{
		record:         storage.MatchRecord{RuntimeID: "match-drive-fixture"},
		actor:          actor,
		pendingRestore: map[rulesengine.Seat]bool{},
	}
	return runtime, current
}

func TestDriveLocked_BotSeatAcceptsHeavenlyOffer(t *testing.T) {
	clock := time.Date(2026, 7, 19, 8, 0, 0, 0, time.UTC)
	runtime, current := craftedPracticeMatch(
		t, heavenlyHand17(), nil,
		[]rulesengine.Seat{rulesengine.East, rulesengine.South, rulesengine.West, rulesengine.North},
		func() time.Time { return clock },
	)
	engine := current.actor.Peek()
	if engine.Phase != rulesengine.PhaseOfferPending {
		t.Fatalf("phase = %s, want the §5.9 Heavenly offer pending", engine.Phase)
	}
	if engine.TurnDeadline != nil {
		t.Fatal("a pending dealt-hand offer must not carry a turn deadline; this test would otherwise not exercise the deadline-free path")
	}

	if err := runtime.driveLocked(context.Background(), current); err != nil {
		t.Fatalf("driveLocked() error = %v", err)
	}

	engine = current.actor.Peek()
	result := engine.Result()
	if result == nil || result.Kind != rulesengine.WinHeavenly {
		t.Fatalf("result = %#v, want an accepted Heavenly win", result)
	}
	if len(result.Winners) != 1 || result.Winners[0].Seat != rulesengine.East {
		t.Fatalf("winners = %#v, want East alone", result.Winners)
	}
}

func TestDriveLocked_DeclinesUnresolvableHumanOfferInsteadOfDeadlocking(t *testing.T) {
	clock := time.Date(2026, 7, 19, 8, 0, 0, 0, time.UTC)
	// East is human (not a bot seat): with no turn deadline and no player
	// offer-response surface, only driveLocked's decline can unstick this.
	runtime, current := craftedPracticeMatch(
		t, heavenlyHand17(), nil,
		[]rulesengine.Seat{rulesengine.South, rulesengine.West, rulesengine.North},
		func() time.Time { return clock },
	)
	if current.actor.Peek().Phase != rulesengine.PhaseOfferPending {
		t.Fatalf("phase = %s, want the §5.9 Heavenly offer pending", current.actor.Peek().Phase)
	}

	if err := runtime.driveLocked(context.Background(), current); err != nil {
		t.Fatalf("driveLocked() error = %v", err)
	}

	engine := current.actor.Peek()
	if engine.Offer() != nil {
		t.Fatal("offer should have been declined (lapsed), not left pending")
	}
	if engine.Result() != nil {
		t.Fatalf("declining Heavenly must not produce a win, got %#v", engine.Result())
	}
	if engine.Phase != rulesengine.PhaseAwaitingDiscard || engine.ActiveSeat != rulesengine.East {
		t.Fatalf("phase = %s seat = %s, want play continuing at East's first discard", engine.Phase, engine.ActiveSeat)
	}
}

func TestDriveLocked_ResolvesRobWindowByDecliningUnansweredSeats(t *testing.T) {
	clock := time.Date(2026, 7, 19, 8, 0, 0, 0, time.UTC)
	eastMelds := []rulesengine.Meld{{
		Type:    rulesengine.MeldPong,
		Tiles:   tripletOf(rulesengine.Characters, 5),
		Claimed: true,
	}}
	eastHand := append(pairlessJunk13(), suited(rulesengine.Characters, 5, 4))
	// No bot seats at all: the branch must resolve the window even when
	// every eligible seat is human, because none of them has any command
	// surface to answer a rob with (pre-existing E2 gap) — waiting would
	// stall a timed match for the full window and an untimed one forever.
	runtime, current := craftedPracticeMatch(t, eastHand, eastMelds, nil, func() time.Time { return clock })
	engine := current.actor.Peek()
	if engine.Phase != rulesengine.PhaseAwaitingDiscard || engine.ActiveSeat != rulesengine.East {
		t.Fatalf("phase = %s seat = %s, want East awaiting discard", engine.Phase, engine.ActiveSeat)
	}

	ctx := context.Background()
	if _, err := current.actor.Apply(ctx, rulesengine.MatchCommand{
		RequestID:       "test:added-kong",
		Type:            rulesengine.CommandDeclareAddedKong,
		Seat:            rulesengine.East,
		ExpectedVersion: engine.Version,
		TileID:          "characters-5-4",
	}); err != nil {
		t.Fatalf("DeclareAddedKong error = %v", err)
	}
	if current.actor.Peek().Phase != rulesengine.PhaseRobWindow {
		t.Fatalf("phase = %s, want an open rob window", current.actor.Peek().Phase)
	}

	if err := runtime.driveLocked(ctx, current); err != nil {
		t.Fatalf("driveLocked() error = %v", err)
	}

	engine = current.actor.Peek()
	if engine.Rob() != nil {
		t.Fatal("rob window should have been resolved, not left pending")
	}
	if engine.Result() != nil {
		t.Fatalf("all-decline rob must not produce a win, got %#v", engine.Result())
	}
	if engine.Phase != rulesengine.PhaseAwaitingDiscard || engine.ActiveSeat != rulesengine.East {
		t.Fatalf("phase = %s seat = %s, want East continuing after the completed Kong's replacement draw", engine.Phase, engine.ActiveSeat)
	}
	for _, player := range engine.Deal.Players {
		if player.Seat != rulesengine.East {
			continue
		}
		if len(player.Melds) != 1 || player.Melds[0].Type != rulesengine.MeldKong {
			t.Fatalf("East melds = %#v, want the Pong upgraded to a Kong", player.Melds)
		}
	}
}
