package rulesengine

import (
	"context"
	"errors"
	"fmt"
	mathrand "math/rand"
	"os"
	"runtime/debug"
	"strconv"
	"testing"
	"time"
)

// TestSimulatorRandomHands plays complete seeded hands through MatchActor
// with random legal actions, checking tile conservation after every command,
// replay determinism at the end, and settlement conservation for winning
// results. The failure artifact is the seed printed by t.Fatalf: re-run with
// MAHJONG_SIM_SEED=<seed> MAHJONG_SIM_HANDS=1 to replay one hand exactly.
//
// The default run (25 hands) is cheap enough for every `go test`. The 1M-hand
// RC gate is opt-in via MAHJONG_SIM_HANDS and is not run by default — see
// scripts/run-rc-simulator.sh.
func TestSimulatorRandomHands(t *testing.T) {
	baseSeed := uint64(20260718)
	hands := 25
	if raw := os.Getenv("MAHJONG_SIM_SEED"); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			t.Fatalf("MAHJONG_SIM_SEED=%q: %v", raw, err)
		}
		baseSeed = parsed
	}
	if raw := os.Getenv("MAHJONG_SIM_HANDS"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			t.Fatalf("MAHJONG_SIM_HANDS=%q: %v", raw, err)
		}
		hands = parsed
	}
	if hands > 200 {
		// Large RC-gate batches are allocation-heavy (hand evaluation search);
		// a higher GC target trades peak memory for materially less GC churn.
		// Not deferred/restored: t.Parallel() subtests run after this function
		// returns, so a deferred restore would fire before they start.
		debug.SetGCPercent(400)
	}
	for offset := 0; offset < hands; offset++ {
		seed := baseSeed + uint64(offset)
		t.Run(fmt.Sprintf("seed-%d", seed), func(t *testing.T) {
			if hands > 200 {
				t.Parallel()
			}
			runSimulatedHand(t, seed)
		})
	}
}

func runSimulatedHand(t *testing.T, seed uint64) {
	t.Helper()
	rng := mathrand.New(mathrand.NewSource(int64(seed)))
	dice := [2]uint8{uint8(1 + rng.Intn(6)), uint8(1 + rng.Intn(6))}
	deal, err := Deal(seed, dice)
	if err != nil {
		t.Fatalf("seed %d: Deal() error = %v", seed, err)
	}
	clockValue := time.Date(2026, 7, 18, 6, 0, 0, 0, time.UTC)
	clock := func() time.Time { return clockValue }
	engine, err := NewTurnEngine(deal, clock)
	if err != nil {
		t.Fatalf("seed %d: NewTurnEngine() error = %v", seed, err)
	}
	ctx := context.Background()
	store := NewMemoryEventStore()
	actor, err := NewMatchActor(ctx, "sim", engine, store, clock)
	if err != nil {
		t.Fatalf("seed %d: NewMatchActor() error = %v", seed, err)
	}

	requestCount := 0
	apply := func(command MatchCommand) error {
		requestCount++
		command.MatchID = "sim"
		command.RequestID = fmt.Sprintf("sim-%d", requestCount)
		_, err := actor.Apply(ctx, command)
		return err
	}
	if err := apply(MatchCommand{Type: CommandBeginInitialReplacement}); err != nil && !errors.Is(err, ErrHandComplete) {
		t.Fatalf("seed %d: begin error = %v", seed, err)
	}

	for step := 0; step < 1500; step++ {
		live := actor.engine
		assertTileConservation(t, seed, step, live)
		switch live.Phase {
		case PhaseHandComplete, PhaseExhaustiveDraw:
			verifySimulatedOutcome(t, seed, actor, store, rng)
			return
		case PhaseOfferPending:
			offer := live.Offer()
			err := apply(MatchCommand{Type: CommandRespondOffer, ExpectedVersion: live.Version, Seat: offer.Seat, Accept: rng.Intn(2) == 0})
			if err != nil && !errors.Is(err, ErrHandComplete) {
				t.Fatalf("seed %d step %d: respond offer error = %v", seed, step, err)
			}
		case PhaseAwaitingDraw:
			if err := apply(MatchCommand{Type: CommandDraw, ExpectedVersion: live.Version}); err != nil && !errors.Is(err, ErrHandComplete) {
				t.Fatalf("seed %d step %d: draw error = %v", seed, step, err)
			}
		case PhaseAwaitingDiscard:
			if err := simulateSelfTurn(t, seed, step, actor, apply, rng); err != nil {
				t.Fatalf("seed %d step %d: self turn error = %v", seed, step, err)
			}
		case PhaseClaimWindow:
			if err := simulateClaimWindow(t, seed, step, actor, apply, rng); err != nil {
				t.Fatalf("seed %d step %d: claim window error = %v", seed, step, err)
			}
		case PhaseRobWindow:
			if err := simulateRobWindow(actor, apply, rng); err != nil {
				t.Fatalf("seed %d step %d: rob window error = %v", seed, step, err)
			}
		default:
			t.Fatalf("seed %d step %d: unexpected phase %s", seed, step, live.Phase)
		}
	}
	t.Fatalf("seed %d: hand did not terminate within the step budget (phase %s)", seed, actor.engine.Phase)
}

func simulateSelfTurn(t *testing.T, seed uint64, step int, actor *MatchActor, apply func(MatchCommand) error, rng *mathrand.Rand) error {
	live := actor.engine
	seat := live.ActiveSeat
	player, err := live.player(seat)
	if err != nil {
		return err
	}
	if live.lastDraw != nil && live.lastDraw.Seat == seat && CanWin(player.Hand, player.Melds) && rng.Intn(10) < 9 {
		err := apply(MatchCommand{Type: CommandDeclareZimo, ExpectedVersion: live.Version, Seat: seat})
		if err != nil && !errors.Is(err, ErrHandComplete) {
			return fmt.Errorf("zimo: %w", err)
		}
		return nil
	}
	if ids := concealedKongIDs(player); ids != nil && rng.Intn(10) < 4 {
		err := apply(MatchCommand{Type: CommandDeclareConcealedKong, ExpectedVersion: live.Version, Seat: seat, TileIDs: ids})
		if err != nil && !errors.Is(err, ErrHandComplete) {
			return fmt.Errorf("concealed kong: %w", err)
		}
		return nil
	}
	if tileID := addedKongTileID(player); tileID != "" && rng.Intn(10) < 5 {
		if err := apply(MatchCommand{Type: CommandDeclareAddedKong, ExpectedVersion: live.Version, Seat: seat, TileID: tileID}); err != nil {
			return fmt.Errorf("added kong: %w", err)
		}
		return nil
	}
	tileID := chooseDiscard(player, rng)
	if tileID == "" {
		return fmt.Errorf("no discardable tile for %s", seat)
	}
	return apply(MatchCommand{Type: CommandDiscard, ExpectedVersion: live.Version, Seat: seat, TileID: tileID})
}

// chooseDiscard mostly discards the least-connected tile so simulated hands
// converge toward wins instead of always exhausting the wall; a small random
// share stays fully random to keep coverage of ragged states.
func chooseDiscard(player *PlayerState, rng *mathrand.Rand) string {
	discardable := make([]Tile, 0, len(player.Hand))
	for _, item := range player.Hand {
		if !item.IsFlower() {
			discardable = append(discardable, item)
		}
	}
	if len(discardable) == 0 {
		return ""
	}
	if rng.Intn(10) == 0 {
		return discardable[rng.Intn(len(discardable))].ID
	}
	bestID, bestScore := "", 1<<30
	for _, candidate := range discardable {
		score := 0
		for _, other := range player.Hand {
			if other.ID == candidate.ID {
				continue
			}
			if sameTileType(other, candidate) {
				score += 3
				continue
			}
			if other.IsNumbered() && candidate.IsNumbered() && other.Kind == candidate.Kind {
				gap := int(other.Rank) - int(candidate.Rank)
				if gap < 0 {
					gap = -gap
				}
				if gap == 1 {
					score += 2
				} else if gap == 2 {
					score++
				}
			}
		}
		if score < bestScore {
			bestScore, bestID = score, candidate.ID
		}
	}
	return bestID
}

func simulateClaimWindow(t *testing.T, seed uint64, step int, actor *MatchActor, apply func(MatchCommand) error, rng *mathrand.Rand) error {
	live := actor.engine
	window := live.Claim
	for _, seat := range window.Eligible {
		if _, responded := window.Responses[seat]; responded {
			continue
		}
		response := ClaimResponse{Seat: seat, Type: ClaimPass, StateVersion: window.StateVersion}
		player, err := live.player(seat)
		if err != nil {
			return err
		}
		canWinNow := !live.winLocks[seat] && live.winValidator(live.Deal, seat, window.Discard.Tile)
		switch {
		case canWinNow && rng.Intn(10) < 8:
			response.Type = ClaimWin
		case live.canKong(seat, window.Discard.Tile, nil) && rng.Intn(10) < 5:
			response.Type = ClaimKong
		case live.canPong(seat, window.Discard.Tile, nil) && rng.Intn(10) < 5:
			response.Type = ClaimPong
		default:
			if ids := chowIDs(player, window.Discard.Tile); ids != nil && seat == nextSeat(window.Discard.Seat) && rng.Intn(10) < 5 {
				response.Type = ClaimChow
				response.TileIDs = ids
			} else {
				response.Deliberate = rng.Intn(4) == 0
			}
		}
		if err := apply(MatchCommand{Type: CommandSubmitClaim, Claim: &response}); err != nil {
			return fmt.Errorf("submit %s by %s: %w", response.Type, seat, err)
		}
		live = actor.engine
		window = live.Claim
	}
	err := apply(MatchCommand{Type: CommandResolveClaims, ExpectedVersion: window.StateVersion})
	if err != nil && !errors.Is(err, ErrHandComplete) {
		return fmt.Errorf("resolve claims: %w", err)
	}
	return nil
}

func simulateRobWindow(actor *MatchActor, apply func(MatchCommand) error, rng *mathrand.Rand) error {
	live := actor.engine
	window := live.rob
	for _, seat := range window.Eligible {
		if _, responded := window.Responses[seat]; responded {
			continue
		}
		response := RobResponse{Seat: seat, StateVersion: window.StateVersion}
		if !live.winLocks[seat] && live.winValidator(live.Deal, seat, window.Tile) && rng.Intn(10) < 8 {
			response.Win = true
		}
		if err := apply(MatchCommand{Type: CommandSubmitRob, Rob: &response}); err != nil {
			return fmt.Errorf("submit rob by %s: %w", seat, err)
		}
		live = actor.engine
		window = live.rob
	}
	err := apply(MatchCommand{Type: CommandResolveRob, ExpectedVersion: window.StateVersion})
	if err != nil && !errors.Is(err, ErrHandComplete) {
		return fmt.Errorf("resolve rob: %w", err)
	}
	return nil
}

func concealedKongIDs(player *PlayerState) []string {
	byType := map[string][]string{}
	for _, item := range player.Hand {
		key := tileTypeKey(item)
		byType[key] = append(byType[key], item.ID)
	}
	for _, ids := range byType {
		if len(ids) == 4 {
			return ids
		}
	}
	return nil
}

func addedKongTileID(player *PlayerState) string {
	for _, meld := range player.Melds {
		if meld.Type != MeldPong || meld.Concealed {
			continue
		}
		for _, item := range player.Hand {
			if sameTileType(item, meld.Tiles[0]) {
				return item.ID
			}
		}
	}
	return ""
}

func chowIDs(player *PlayerState, discard Tile) []string {
	if !discard.IsNumbered() {
		return nil
	}
	find := func(rank int) string {
		if rank < 1 || rank > 9 {
			return ""
		}
		for _, item := range player.Hand {
			if item.Kind == discard.Kind && int(item.Rank) == rank {
				return item.ID
			}
		}
		return ""
	}
	rank := int(discard.Rank)
	for _, pair := range [][2]int{{rank - 2, rank - 1}, {rank - 1, rank + 1}, {rank + 1, rank + 2}} {
		first, second := find(pair[0]), find(pair[1])
		if first != "" && second != "" {
			return []string{first, second}
		}
	}
	return nil
}

// assertTileConservation verifies that every catalog tile exists exactly once
// across the wall, hands, melds, exposed bonus tiles, the discard pile, and a
// winning tile held by the hand result.
// catalogIDs is computed once; Catalog() rebuilds and re-formats all 144
// tile IDs on every call, which is too expensive to run on every simulated
// step across a million-hand batch.
var catalogIDs = func() map[string]struct{} {
	ids := make(map[string]struct{}, len(Catalog()))
	for _, item := range Catalog() {
		ids[item.ID] = struct{}{}
	}
	return ids
}()

func assertTileConservation(t *testing.T, seed uint64, step int, engine *TurnEngine) {
	t.Helper()
	counts := map[string]int{}
	wall := engine.Deal.Wall
	for _, item := range wall.tiles[wall.front : len(wall.tiles)-wall.back] {
		counts[item.ID]++
	}
	for _, player := range engine.Deal.Players {
		for _, item := range player.Hand {
			counts[item.ID]++
		}
		for _, meld := range player.Melds {
			for _, item := range meld.Tiles {
				counts[item.ID]++
			}
		}
		for _, item := range player.Exposed {
			if item.IsFlower() {
				counts[item.ID]++
			}
		}
	}
	for _, discard := range engine.discards {
		counts[discard.Tile.ID]++
	}
	if result := engine.result; result != nil && result.WinningTileID != "" &&
		(result.Kind == WinDiscard || result.Kind == WinRob) {
		counts[result.WinningTileID]++
	}
	if len(counts) != len(catalogIDs) {
		t.Fatalf("seed %d step %d: %d distinct tile IDs in play, want %d", seed, step, len(counts), len(catalogIDs))
	}
	for id := range catalogIDs {
		if counts[id] != 1 {
			t.Fatalf("seed %d step %d: tile %s counted %d times", seed, step, id, counts[id])
		}
	}
}

func verifySimulatedOutcome(t *testing.T, seed uint64, actor *MatchActor, store EventStore, rng *mathrand.Rand) {
	t.Helper()
	ctx := context.Background()
	restored, err := RestoreMatchActor(ctx, "sim", store, actor.clock)
	if err != nil {
		t.Fatalf("seed %d: replay failed: %v", seed, err)
	}
	originalHash, err := stateHash(actor.engine)
	if err != nil {
		t.Fatalf("seed %d: state hash error = %v", seed, err)
	}
	replayHash, err := stateHash(restored.engine)
	if err != nil {
		t.Fatalf("seed %d: replay hash error = %v", seed, err)
	}
	if originalHash != replayHash {
		t.Fatalf("seed %d: replay produced a different state hash", seed)
	}
	result := actor.engine.Result()
	if result != nil {
		t.Logf("seed %d: outcome %s after %d events", seed, result.Kind, actor.Sequence())
	}
	if actor.engine.Phase == PhaseExhaustiveDraw {
		if result == nil || result.Kind != KindExhaustiveDraw {
			t.Fatalf("seed %d: exhaustive draw missing result: %#v", seed, result)
		}
	}
	if result == nil {
		t.Fatalf("seed %d: terminal phase %s has no hand result", seed, actor.engine.Phase)
	}
	tiers := []LobbyTier{TierBambooCourtyard, TierSparrowPavilion, TierWindAndCloudLounge, TierDragonsDen}
	settlement, err := SettleHand(SettlementInput{
		Tier:          tiers[rng.Intn(len(tiers))],
		Dealer:        East,
		Continuations: rng.Intn(MaxDealerContinuations + 1),
		Result:        result,
	})
	if err != nil {
		t.Fatalf("seed %d: settlement error = %v (result %#v)", seed, err, result)
	}
	if settlement.TotalCredits != settlement.TotalDebits {
		t.Fatalf("seed %d: settlement credits %d != debits %d", seed, settlement.TotalCredits, settlement.TotalDebits)
	}
	if _, err := NextDealerState(East, 0, result, rng.Intn(2) == 0); err != nil {
		t.Fatalf("seed %d: continuation error = %v", seed, err)
	}
}
