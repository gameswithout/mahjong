package rulesengine

import "testing"

func TestDealIsDeterministicAndPreservesMahjongCounts(t *testing.T) {
	first, err := Deal(42, [2]uint8{3, 4})
	if err != nil {
		t.Fatalf("Deal() error = %v", err)
	}
	second, err := Deal(42, [2]uint8{3, 4})
	if err != nil {
		t.Fatalf("Deal() second error = %v", err)
	}
	firstHash, err := first.Hash()
	if err != nil {
		t.Fatalf("Hash() error = %v", err)
	}
	secondHash, err := second.Hash()
	if err != nil {
		t.Fatalf("Hash() second error = %v", err)
	}
	if firstHash != secondHash {
		t.Fatalf("same seed produced different state hashes")
	}

	if first.Wall.Remaining() != 79 {
		t.Fatalf("wall remaining = %d, want 79", first.Wall.Remaining())
	}
	if first.Wall.DrawableRemaining() != 63 {
		t.Fatalf("drawable remaining = %d, want 63", first.Wall.DrawableRemaining())
	}
	if len(first.Players[0].Hand) != 17 {
		t.Fatalf("East hand = %d, want 17", len(first.Players[0].Hand))
	}
	for _, player := range first.Players[1:] {
		if len(player.Hand) != 16 {
			t.Fatalf("%s hand = %d, want 16", player.Seat, len(player.Hand))
		}
	}

	seen := map[string]struct{}{}
	for _, player := range first.Players {
		for _, tile := range player.Hand {
			if _, exists := seen[tile.ID]; exists {
				t.Fatalf("duplicate dealt tile %q", tile.ID)
			}
			seen[tile.ID] = struct{}{}
		}
	}
	if len(seen) != 65 {
		t.Fatalf("dealt tile count = %d, want 65", len(seen))
	}
}

func TestWallFrontAndBackRespectReserve(t *testing.T) {
	state, err := Deal(7, [2]uint8{2, 2})
	if err != nil {
		t.Fatalf("Deal() error = %v", err)
	}

	front, err := state.Wall.DrawFront()
	if err != nil {
		t.Fatalf("DrawFront() error = %v", err)
	}
	if front.ID == "" || state.Wall.DrawableRemaining() != 62 || state.Wall.ReserveRemaining() != 16 {
		t.Fatalf("front draw changed the wrong counters")
	}

	back, err := state.Wall.DrawBack()
	if err != nil {
		t.Fatalf("DrawBack() error = %v", err)
	}
	// Front draws and replacements consume the same drawable pool; the 16-tile
	// boundary is fixed (§5.2), so the reserve count never changes.
	if back.ID == "" || state.Wall.DrawableRemaining() != 61 || state.Wall.ReserveRemaining() != 16 {
		t.Fatalf("back draw changed the wrong counters")
	}
}

func TestInitialFlowerReplacementIsOrderedAndExhaustive(t *testing.T) {
	var state *DealState
	var err error
	for seed := uint64(1); seed < 1000; seed++ {
		state, err = Deal(seed, [2]uint8{2, 2})
		if err != nil {
			t.Fatalf("Deal() error = %v", err)
		}
		flowerCount := 0
		for _, player := range state.Players {
			for _, tile := range player.Hand {
				if tile.IsFlower() {
					flowerCount++
				}
			}
		}
		if flowerCount > 0 {
			break
		}
	}
	if state == nil {
		t.Fatal("failed to find a seeded deal containing a Flower")
	}

	initialFlowers := 0
	for _, player := range state.Players {
		for _, tile := range player.Hand {
			if tile.IsFlower() {
				initialFlowers++
			}
		}
	}
	if initialFlowers == 0 {
		t.Fatal("seed search did not find a Flower")
	}
	if err := state.ReplaceInitialFlowers(); err != nil {
		t.Fatalf("ReplaceInitialFlowers() error = %v", err)
	}

	exposed := 0
	for _, player := range state.Players {
		for _, tile := range player.Hand {
			if tile.IsFlower() {
				t.Fatalf("Flower %q remained concealed for %s", tile.ID, player.Seat)
			}
		}
		for _, tile := range player.Exposed {
			if !tile.IsFlower() {
				t.Fatalf("non-Flower %q was exposed", tile.ID)
			}
			exposed++
		}
	}
	if exposed < initialFlowers || state.Wall.ReserveRemaining() != ReserveTileCount ||
		state.Wall.DrawableRemaining() != 63-exposed {
		t.Fatalf("exposed flowers = %d, drawable remaining = %d; initial flowers = %d", exposed, state.Wall.DrawableRemaining(), initialFlowers)
	}
}

func TestReplacementStopsAtReserveBoundary(t *testing.T) {
	state, err := Deal(99, [2]uint8{3, 3})
	if err != nil {
		t.Fatalf("Deal() error = %v", err)
	}
	for state.Wall.DrawableRemaining() > 0 {
		if _, err := state.Wall.DrawFront(); err != nil {
			t.Fatalf("DrawFront() error = %v", err)
		}
	}
	if state.Wall.Remaining() != ReserveTileCount {
		t.Fatalf("remaining = %d, want reserve %d", state.Wall.Remaining(), ReserveTileCount)
	}
	if _, err := state.ReplaceFlower(East, Tile{ID: "flower-spring", Kind: Flower}); err != ErrReserveEmpty {
		t.Fatalf("ReplaceFlower() error = %v, want ErrReserveEmpty", err)
	}
}

func TestInPlayFlowerReplacementReturnsPlayableTile(t *testing.T) {
	state, err := Deal(123, [2]uint8{4, 5})
	if err != nil {
		t.Fatalf("Deal() error = %v", err)
	}
	beforeExposed := len(state.Players[1].Exposed)
	beforeDrawable := state.Wall.DrawableRemaining()
	playable, err := state.ReplaceFlower(South, Tile{ID: "flower-orchid", Kind: Flower})
	if err != nil {
		t.Fatalf("ReplaceFlower() error = %v", err)
	}
	if playable.IsFlower() {
		t.Fatalf("ReplaceFlower() returned concealed Flower %q", playable.ID)
	}
	if len(state.Players[1].Exposed) <= beforeExposed ||
		beforeDrawable-state.Wall.DrawableRemaining() != len(state.Players[1].Exposed)-beforeExposed {
		t.Fatalf("replacement did not account for exposed chain and drawable pool")
	}
	if _, err := state.ReplaceFlower("invalid", playable); err != ErrUnknownSeat {
		t.Fatalf("unknown-seat error = %v, want ErrUnknownSeat", err)
	}
}

func TestBreakAndInvalidInputs(t *testing.T) {
	if side, err := BreakSide(7); err != nil || side != West {
		t.Fatalf("BreakSide(7) = %s, %v; want W, nil", side, err)
	}
	if _, err := BreakSide(1); err != ErrInvalidDice {
		t.Fatalf("BreakSide(1) error = %v", err)
	}
	if _, err := Deal(0, [2]uint8{1, 1}); err != ErrInvalidSeed {
		t.Fatalf("Deal(0) error = %v", err)
	}
	if _, err := Deal(1, [2]uint8{0, 2}); err != ErrInvalidDice {
		t.Fatalf("Deal([0,2]) error = %v", err)
	}
	if _, err := Deal(1, [2]uint8{1, 7}); err != ErrInvalidDice {
		t.Fatalf("Deal([1,7]) error = %v", err)
	}
}
