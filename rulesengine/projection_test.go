package rulesengine

import "testing"

// TestProjectSeatRedactsConcealedMeldTilesFromOpponents covers a
// security-sensitive property for the E8 match table: a concealed Kong's
// tile identities must stay hidden from every seat but its owner, even
// though the Kong itself (type + concealed flag + tile count) is public.
func TestProjectSeatRedactsConcealedMeldTilesFromOpponents(t *testing.T) {
	state := dealWithFront(t)
	hand := junkHand17()[:13]
	hand = append(hand,
		tile("characters-5-1", Characters, 5, 1),
		tile("characters-5-2", Characters, 5, 2),
		tile("characters-5-3", Characters, 5, 3),
		tile("characters-5-4", Characters, 5, 4),
	)
	state.Players[0].Hand = hand
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	if _, err := engine.DeclareConcealedKong(engine.Version, East, []string{"characters-5-1"}); err != nil {
		t.Fatalf("DeclareConcealedKong() error = %v", err)
	}

	ownView, err := engine.ProjectSeat("match-1", East)
	if err != nil {
		t.Fatalf("ProjectSeat(East) error = %v", err)
	}
	if len(ownView.OwnMelds) != 1 || ownView.OwnMelds[0].Type != MeldKong || !ownView.OwnMelds[0].Concealed {
		t.Fatalf("OwnMelds = %#v, want one concealed kong", ownView.OwnMelds)
	}
	if len(ownView.OwnMelds[0].Tiles) != 4 {
		t.Fatalf("owner's own concealed kong tiles = %#v, want 4 tiles visible to its owner", ownView.OwnMelds[0].Tiles)
	}

	opponentView, err := engine.ProjectSeat("match-1", South)
	if err != nil {
		t.Fatalf("ProjectSeat(South) error = %v", err)
	}
	var eastAsSeenBySouth PlayerView
	found := false
	for _, player := range opponentView.Players {
		if player.Seat == East {
			eastAsSeenBySouth = player
			found = true
		}
	}
	if !found {
		t.Fatal("South's view is missing East's player entry")
	}
	if len(eastAsSeenBySouth.Melds) != 1 {
		t.Fatalf("East's melds as seen by South = %#v, want exactly one", eastAsSeenBySouth.Melds)
	}
	meld := eastAsSeenBySouth.Melds[0]
	if meld.Type != MeldKong || !meld.Concealed {
		t.Fatalf("meld = %#v, want a concealed kong (type/flag still public)", meld)
	}
	if len(meld.Tiles) != 0 {
		t.Fatalf("meld.Tiles = %#v, want no tile identities leaked to South", meld.Tiles)
	}
}

// TestProjectSeatExposesNonConcealedMeldTilesToEveryone covers the other
// side: an exposed (claimed) meld's tiles are public to every seat, not
// just its owner.
func TestProjectSeatExposesNonConcealedMeldTilesToEveryone(t *testing.T) {
	state := turnFixture(t)
	state.Players[1].Hand = []Tile{
		tile("characters-1-2", Characters, 1, 2),
		tile("characters-1-3", Characters, 1, 3),
	}
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	window, err := engine.Discard(engine.Version, East, "characters-1-1")
	if err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	if err := engine.SubmitClaim(ClaimResponse{Seat: South, Type: ClaimPong, StateVersion: window.StateVersion}); err != nil {
		t.Fatalf("SubmitClaim(Pong) error = %v", err)
	}
	for _, seat := range []Seat{West, North} {
		if err := engine.SubmitClaim(ClaimResponse{Seat: seat, Type: ClaimPass, StateVersion: window.StateVersion}); err != nil {
			t.Fatalf("pass for %s error = %v", seat, err)
		}
	}
	if _, err := engine.ResolveClaims(window.StateVersion); err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}

	view, err := engine.ProjectSeat("match-1", West)
	if err != nil {
		t.Fatalf("ProjectSeat(West) error = %v", err)
	}
	var southAsSeenByWest PlayerView
	found := false
	for _, player := range view.Players {
		if player.Seat == South {
			southAsSeenByWest = player
			found = true
		}
	}
	if !found {
		t.Fatal("West's view is missing South's player entry")
	}
	if len(southAsSeenByWest.Melds) != 1 || southAsSeenByWest.Melds[0].Type != MeldPong {
		t.Fatalf("South's melds as seen by West = %#v, want one exposed pong", southAsSeenByWest.Melds)
	}
	if southAsSeenByWest.Melds[0].Concealed {
		t.Fatal("a claimed Pong must not be marked concealed")
	}
	if len(southAsSeenByWest.Melds[0].Tiles) != 3 {
		t.Fatalf("South's pong tiles as seen by West = %#v, want all 3 tiles visible", southAsSeenByWest.Melds[0].Tiles)
	}
}

// TestProjectSeatExposesTakenOverIdenticallyToEverySeat covers the E8.F6
// "Auto-playing" badge: PlayerView.TakenOver is public — the same value
// for a given seat regardless of who is viewing — and starts false.
func TestProjectSeatExposesTakenOverIdenticallyToEverySeat(t *testing.T) {
	state := turnFixture(t)
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	for _, seat := range []Seat{East, South, West, North} {
		view, err := engine.ProjectSeat("match-1", seat)
		if err != nil {
			t.Fatalf("ProjectSeat(%s) error = %v", seat, err)
		}
		for _, player := range view.Players {
			if player.TakenOver {
				t.Fatalf("viewer %s: seat %s reported TakenOver before any timeout occurred", seat, player.Seat)
			}
		}
	}

	engine.recordTimeout(North)
	engine.recordTimeout(North)
	engine.recordTimeout(North)
	if !engine.IsTakenOver(North) {
		t.Fatal("expected North to be taken over after three recorded timeouts")
	}

	for _, seat := range []Seat{East, South, West, North} {
		view, err := engine.ProjectSeat("match-1", seat)
		if err != nil {
			t.Fatalf("ProjectSeat(%s) error = %v", seat, err)
		}
		var north PlayerView
		found := false
		for _, player := range view.Players {
			if player.Seat == North {
				north = player
				found = true
			}
		}
		if !found || !north.TakenOver {
			t.Fatalf("viewer %s: North's TakenOver = %#v, want true for every viewer", seat, north)
		}
	}
}

// TestProjectSeatExposesHandResultOnlyAtTerminalPhase covers §9.7 items
// 1-4 (winning hand/tile, decomposition, patterns, raw Tai): HandResult is
// nil mid-hand, and once the hand ends it is identical for every seat —
// including a seat that did not win, since a completed hand's winner(s)
// are legitimately revealed at showdown. Settlement/NextDealer are left
// for the runtime layer (dealer/continuation/tier are session state
// ProjectSeat has no visibility into).
func TestProjectSeatExposesHandResultOnlyAtTerminalPhase(t *testing.T) {
	state := dealWithFront(t, "dots-5-2")
	state.Players[0].Hand = junkHand17()
	state.Players[1].Hand = append(append(append(
		concealedPongTiles(Characters, 1),
		concealedPongTiles(Characters, 2)...),
		concealedPongTiles(Characters, 3)...),
		append(concealedPongTiles(Bamboo, 1),
			append(concealedPongTiles(Bamboo, 2), tile("dots-5-1", Dots, 5, 1))...)...)
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}

	midHandView, err := engine.ProjectSeat("match-1", West)
	if err != nil {
		t.Fatalf("ProjectSeat(West) mid-hand error = %v", err)
	}
	if midHandView.HandResult != nil {
		t.Fatalf("HandResult should be nil mid-hand, got %#v", midHandView.HandResult)
	}

	window, err := engine.Discard(engine.Version, East, "dots-9-1")
	if err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	passAllClaims(t, engine, window)
	if _, err := engine.Draw(engine.Version); err != nil {
		t.Fatalf("Draw() error = %v", err)
	}
	if _, err := engine.DeclareZimo(engine.Version, South); err != nil {
		t.Fatalf("DeclareZimo() error = %v", err)
	}
	if engine.Phase != PhaseHandComplete {
		t.Fatalf("phase = %s, want hand_complete", engine.Phase)
	}

	for _, seat := range []Seat{East, South, West, North} {
		view, err := engine.ProjectSeat("match-1", seat)
		if err != nil {
			t.Fatalf("ProjectSeat(%s) error = %v", seat, err)
		}
		if view.HandResult == nil || view.HandResult.Kind != WinZimo || len(view.HandResult.Winners) != 1 || view.HandResult.Winners[0].Seat != South {
			t.Fatalf("seat %s: HandResult = %#v, want South's Zimo visible identically to every seat", seat, view.HandResult)
		}
		if view.Settlement != nil || view.NextDealer != nil {
			t.Fatalf("seat %s: ProjectSeat must leave Settlement/NextDealer for the runtime layer, got %#v / %#v", seat, view.Settlement, view.NextDealer)
		}
	}
}

// TestProjectSeatExposesTurnDeadline covers the countdown the E8 match
// table needs for a live draw/discard decision, mirroring how Claim's own
// deadline is already formatted.
func TestProjectSeatExposesTurnDeadline(t *testing.T) {
	state := turnFixture(t)
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	if engine.TurnDeadline == nil {
		t.Fatal("expected TurnDeadline to be set entering the discard window")
	}
	view, err := engine.ProjectSeat("match-1", East)
	if err != nil {
		t.Fatalf("ProjectSeat(East) error = %v", err)
	}
	if view.TurnDeadline == "" {
		t.Fatal("expected a non-empty TurnDeadline in the projection")
	}
}

// TestProjectSeatComputesClaimOptionsServerSide covers E8.F3's "no
// legality computed client-side": a seat eligible to claim gets a real,
// engine-computed ClaimOptionsView (matching what SubmitClaim would itself
// accept), and an ineligible/non-participant seat gets none.
func TestProjectSeatComputesClaimOptionsServerSide(t *testing.T) {
	state := turnFixture(t)
	state.Players[1].Hand = []Tile{
		tile("characters-1-2", Characters, 1, 2),
		tile("characters-1-3", Characters, 1, 3),
	}
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	window, err := engine.Discard(engine.Version, East, "characters-1-1")
	if err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	if !containsSeat(window.Eligible, South) {
		t.Fatalf("expected South to be eligible for East's discard, eligible = %v", window.Eligible)
	}

	southView, err := engine.ProjectSeat("match-1", South)
	if err != nil {
		t.Fatalf("ProjectSeat(South) error = %v", err)
	}
	if southView.Claim == nil {
		t.Fatal("expected South's view to include the live claim window")
	}
	if !southView.Claim.Options.CanPong {
		t.Fatalf("South holds two characters-1 tiles; CanPong should be true, got %#v", southView.Claim.Options)
	}
	if southView.Claim.Options.CanKong {
		t.Fatal("South only holds two matching tiles, not three; CanKong must be false")
	}

	// North is eligible too (any seat but the discarder is, for
	// pong/kong/win) but holds nothing matching — every option false.
	northView, err := engine.ProjectSeat("match-1", North)
	if err != nil {
		t.Fatalf("ProjectSeat(North) error = %v", err)
	}
	if northView.Claim == nil {
		t.Fatal("expected North's view to include the live claim window")
	}
	if northView.Claim.Options.CanPong || northView.Claim.Options.CanKong || northView.Claim.Options.CanWin || len(northView.Claim.Options.ChowSets) != 0 {
		t.Fatalf("North holds nothing matching East's discard; options should be all-false, got %#v", northView.Claim.Options)
	}
}

// TestProjectSeatExposesFullPublicDiscardPile covers the new Discards
// field: every seat's discard, in order, is visible to every other seat —
// discards have never been private in this ruleset.
func TestProjectSeatExposesFullPublicDiscardPile(t *testing.T) {
	state := turnFixture(t)
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	window, err := engine.Discard(engine.Version, East, "characters-1-1")
	if err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	for _, seat := range window.Eligible {
		if err := engine.SubmitClaim(ClaimResponse{Seat: seat, Type: ClaimPass, StateVersion: window.StateVersion}); err != nil {
			t.Fatalf("pass for %s error = %v", seat, err)
		}
	}
	if _, err := engine.ResolveClaims(window.StateVersion); err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}

	view, err := engine.ProjectSeat("match-1", North)
	if err != nil {
		t.Fatalf("ProjectSeat(North) error = %v", err)
	}
	if len(view.Discards) != 1 || view.Discards[0].Seat != East || view.Discards[0].Tile.ID != "characters-1-1" {
		t.Fatalf("Discards = %#v, want East's characters-1-1 visible to North", view.Discards)
	}
}
