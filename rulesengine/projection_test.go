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

// TestProjectSeatComputesTingWaitListWithVisibleRemainingCount covers the
// §9.4 assist: a seat holding a single-wait hand gets exactly the tile type
// it needs, and VisibleRemaining correctly subtracts every publicly visible
// copy (own hand, discards, exposed melds) but never an opponent's
// concealed hand — VisibleRemaining floors at zero rather than going
// negative once every copy is accounted for.
func TestProjectSeatComputesTingWaitListWithVisibleRemainingCount(t *testing.T) {
	state := dealWithFront(t)
	// Same single-wait shape as TestWinningTilesReturnsUniquePhysicalRepresentatives:
	// every suit run 1-9 plus 1-6 of bamboo, needing one more dots-1 to pair.
	state.Players[0].Hand = []Tile{
		tile("characters-1-1", Characters, 1, 1), tile("characters-2-1", Characters, 2, 1), tile("characters-3-1", Characters, 3, 1),
		tile("characters-4-1", Characters, 4, 1), tile("characters-5-1", Characters, 5, 1), tile("characters-6-1", Characters, 6, 1),
		tile("characters-7-1", Characters, 7, 1), tile("characters-8-1", Characters, 8, 1), tile("characters-9-1", Characters, 9, 1),
		tile("bamboo-1-1", Bamboo, 1, 1), tile("bamboo-2-1", Bamboo, 2, 1), tile("bamboo-3-1", Bamboo, 3, 1),
		tile("bamboo-4-1", Bamboo, 4, 1), tile("bamboo-5-1", Bamboo, 5, 1), tile("bamboo-6-1", Bamboo, 6, 1),
		tile("dots-1-1", Dots, 1, 1),
	}
	state.Players[1].Hand = []Tile{tile("wind-east-1", Wind, 0, 1)}
	state.Players[2].Hand = []Tile{tile("wind-south-1", Wind, 0, 1)}
	state.Players[3].Hand = []Tile{tile("wind-west-1", Wind, 0, 1)}
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}

	view, err := engine.ProjectSeat("match-1", East)
	if err != nil {
		t.Fatalf("ProjectSeat(East) error = %v", err)
	}
	if len(view.Waits) != 1 || view.Waits[0].Tile.Kind != Dots || view.Waits[0].Tile.Rank != 1 {
		t.Fatalf("Waits = %#v, want a single dots-1 wait", view.Waits)
	}
	if view.Waits[0].VisibleRemaining != 3 {
		t.Fatalf("VisibleRemaining = %d, want 3 (4 minus the copy already in East's own hand)", view.Waits[0].VisibleRemaining)
	}

	// A public discard of a second dots-1 copy should subtract one more.
	engine.discards = append(engine.discards, Discard{Seat: South, Tile: tile("dots-1-2", Dots, 1, 2), Sequence: 1})
	view, err = engine.ProjectSeat("match-1", East)
	if err != nil {
		t.Fatalf("ProjectSeat(East) error = %v", err)
	}
	if view.Waits[0].VisibleRemaining != 2 {
		t.Fatalf("VisibleRemaining after discard = %d, want 2", view.Waits[0].VisibleRemaining)
	}

	// West's exposed Pong holding the last two physical copies should
	// exhaust the count to zero, not negative — still listed (§9.4:
	// "structurally legal but exhausted wait"), just with an "All visible"
	// zero rather than being removed.
	westIndex := 2
	state.Players[westIndex].Melds = []Meld{{
		Type: MeldPong,
		Tiles: []Tile{
			tile("dots-1-3", Dots, 1, 3),
			tile("dots-1-4", Dots, 1, 4),
		},
	}}
	view, err = engine.ProjectSeat("match-1", East)
	if err != nil {
		t.Fatalf("ProjectSeat(East) error = %v", err)
	}
	if len(view.Waits) != 1 {
		t.Fatalf("Waits = %#v, want the exhausted wait still listed", view.Waits)
	}
	if view.Waits[0].VisibleRemaining != 0 {
		t.Fatalf("VisibleRemaining after West's exposed Pong = %d, want floored at 0", view.Waits[0].VisibleRemaining)
	}

	// A concealed meld's tiles must never reduce the count: they are not
	// visible to anyone but their owner (§9.4: "never reads opponent
	// hands").
	state.Players[westIndex].Melds[0].Concealed = true
	view, err = engine.ProjectSeat("match-1", East)
	if err != nil {
		t.Fatalf("ProjectSeat(East) error = %v", err)
	}
	if view.Waits[0].VisibleRemaining != 2 {
		t.Fatalf("VisibleRemaining once West's Pong is concealed = %d, want back to 2 (concealed tiles excluded)", view.Waits[0].VisibleRemaining)
	}
}

// TestProjectSeatComputesWinPreviewAlongsideCanWin covers the §9.4 "score
// preview before Win" assist: the preview attached to a live ClaimOptionsView
// must be exactly the ScoreResult the real ClaimWin resolution goes on to
// produce, not an approximation — captured before resolution and compared
// against the actual HandResult afterward, rather than hand-deriving Tai
// totals independently in the test.
func TestProjectSeatComputesWinPreviewAlongsideCanWin(t *testing.T) {
	state := dealWithFront(t)
	// East's hand is junkHand17 with its last slot swapped for dots-5-2 so
	// East's first discard is a tile South can claim Win on directly.
	hand := append([]Tile(nil), junkHand17()[:16]...)
	hand = append(hand, tile("dots-5-2", Dots, 5, 2))
	state.Players[0].Hand = hand
	// South: three concealed Pongs plus two more, one dots-5 short of a
	// pair (same shape as TestZimoOnFirstDrawScoresEarthlyAndConcealedZimo,
	// but claiming East's discard rather than self-drawing it).
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
	window, err := engine.Discard(engine.Version, East, "dots-5-2")
	if err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	if !containsSeat(window.Eligible, South) {
		t.Fatalf("expected South to be eligible for East's dots-5-2 discard, eligible = %v", window.Eligible)
	}

	southView, err := engine.ProjectSeat("match-1", South)
	if err != nil {
		t.Fatalf("ProjectSeat(South) error = %v", err)
	}
	if !southView.Claim.Options.CanWin {
		t.Fatal("expected South to be able to claim Win on East's dots-5-2")
	}
	preview := southView.Claim.Options.WinPreview
	if preview == nil || !preview.Winning || preview.RawTai == 0 {
		t.Fatalf("WinPreview = %#v, want a winning, non-zero preview", preview)
	}

	if err := engine.SubmitClaim(ClaimResponse{Seat: South, Type: ClaimWin, StateVersion: window.StateVersion}); err != nil {
		t.Fatalf("SubmitClaim(Win) error = %v", err)
	}
	for _, seat := range []Seat{West, North} {
		if err := engine.SubmitClaim(ClaimResponse{Seat: seat, Type: ClaimPass, StateVersion: window.StateVersion}); err != nil {
			t.Fatalf("pass for %s error = %v", seat, err)
		}
	}
	if _, err := engine.ResolveClaims(window.StateVersion); err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}
	result := engine.Result()
	if result == nil || len(result.Winners) != 1 || result.Winners[0].Seat != South {
		t.Fatalf("result = %#v, want South as the sole winner", result)
	}
	actual := result.Winners[0].Score
	if actual.RawTai != preview.RawTai || len(actual.Patterns) != len(preview.Patterns) {
		t.Fatalf("actual score %#v does not match the earlier WinPreview %#v", actual, preview)
	}
	for index := range actual.Patterns {
		if actual.Patterns[index] != preview.Patterns[index] {
			t.Fatalf("pattern[%d] = %#v, preview had %#v", index, actual.Patterns[index], preview.Patterns[index])
		}
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
