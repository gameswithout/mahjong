package bots

import (
	"reflect"
	"testing"

	"github.com/gameswithout/mahjong/rulesengine"
)

func personaFixture(t *testing.T, id string) Persona {
	t.Helper()
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	persona, ok := roster.ByID(id)
	if !ok {
		t.Fatalf("ByID(%q) = false", id)
	}
	return persona
}

// personaHand is a mid-hand fixture with something for every persona to
// want: a live run, a spare pair, a lone Dragon, and enough dead weight
// that the discard choice is genuinely open.
func personaObservation(t *testing.T) Observation {
	t.Helper()
	return Observation{
		Seat:           rulesengine.South,
		Dealer:         rulesengine.East,
		PrevailingWind: rulesengine.East,
		Hand: []rulesengine.Tile{
			tile("bamboo-2-1", rulesengine.Bamboo, 2, 1),
			tile("bamboo-3-1", rulesengine.Bamboo, 3, 1),
			tile("bamboo-4-1", rulesengine.Bamboo, 4, 1),
			tile("bamboo-6-1", rulesengine.Bamboo, 6, 1),
			tile("bamboo-7-1", rulesengine.Bamboo, 7, 1),
			tile("bamboo-8-1", rulesengine.Bamboo, 8, 1),
			tile("dots-5-1", rulesengine.Dots, 5, 1),
			tile("dots-5-2", rulesengine.Dots, 5, 2),
			tile("dots-6-1", rulesengine.Dots, 6, 1),
			tile("dots-7-1", rulesengine.Dots, 7, 1),
			tile("characters-1-1", rulesengine.Characters, 1, 1),
			tile("characters-9-1", rulesengine.Characters, 9, 1),
			tile("dragon-red-1", rulesengine.Dragon, 0, 1),
			tile("wind-north-1", rulesengine.Wind, 0, 1),
			tile("characters-4-1", rulesengine.Characters, 4, 1),
			tile("characters-6-1", rulesengine.Characters, 6, 1),
		},
		Opponents: []OpponentView{
			{Seat: rulesengine.West, HandCount: 16},
			{Seat: rulesengine.North, HandCount: 16},
			{Seat: rulesengine.East, HandCount: 16},
		},
		DrawableRemaining: 60,
	}
}

func TestPersonaDecisionsReplayFromSeed(t *testing.T) {
	obs := personaObservation(t)
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	claimOptions := ClaimOptions{
		Discard:  tile("dots-5-3", rulesengine.Dots, 5, 3),
		CanPong:  true,
		ChowSets: [][2]string{{"dots-6-1", "dots-7-1"}},
	}
	for _, id := range roster.IDs() {
		persona, _ := roster.ByID(id)
		for _, base := range []Policy{NewEasyPolicy(), NewMediumPolicy(), NewHardPolicy()} {
			policy := NewPersonaPolicy(base, persona)
			for seed := uint64(1); seed <= 3; seed++ {
				first := policy.DecideDiscard(obs, seed)
				second := policy.DecideDiscard(obs, seed)
				if !reflect.DeepEqual(first.Action, second.Action) {
					t.Fatalf("%s/%s seed %d: discard not reproducible: %#v vs %#v", id, base.Difficulty(), seed, first.Action, second.Action)
				}
				firstClaim := policy.DecideClaim(obs, claimOptions, seed)
				secondClaim := policy.DecideClaim(obs, claimOptions, seed)
				if !reflect.DeepEqual(firstClaim.Action, secondClaim.Action) {
					t.Fatalf("%s/%s seed %d: claim not reproducible: %#v vs %#v", id, base.Difficulty(), seed, firstClaim.Action, secondClaim.Action)
				}
			}
		}
	}
}

// TestPersonaIsRecordedOnEveryDecision is the §11.4 replay requirement: a
// stored decision has to say which style produced it, or a retuned persona
// silently invalidates every past replay.
func TestPersonaIsRecordedOnEveryDecision(t *testing.T) {
	obs := personaObservation(t)
	persona := personaFixture(t, "swift-sparrow")
	policy := NewPersonaPolicy(NewMediumPolicy(), persona)

	decisions := []Decision{
		policy.DecideDiscard(obs, 5),
		policy.DecideClaim(obs, ClaimOptions{Discard: tile("dots-5-3", rulesengine.Dots, 5, 3), CanPong: true}, 5),
		policy.DecideSelfKong(obs, nil, 5),
	}
	for index, decision := range decisions {
		if decision.Persona != "swift-sparrow" {
			t.Errorf("decision %d persona = %q, want swift-sparrow", index, decision.Persona)
		}
		if decision.PersonaVersion != PersonaVersion {
			t.Errorf("decision %d persona version = %q, want %q", index, decision.PersonaVersion, PersonaVersion)
		}
	}

	// A bare difficulty policy must leave both fields empty, so a takeover
	// seat is never mistaken for a chosen persona.
	plain := NewMediumPolicy().DecideDiscard(obs, 5)
	if plain.Persona != "" || plain.PersonaVersion != "" {
		t.Errorf("difficulty-only decision = %q/%q, want both empty", plain.Persona, plain.PersonaVersion)
	}
}

// TestEveryPersonaAlwaysDeclaresALegalWin is the §11.3 rule no style may
// bend: a Big Hand persona never passes a legal Win to chase more Tai.
func TestEveryPersonaAlwaysDeclaresALegalWin(t *testing.T) {
	obs := personaObservation(t)
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	options := ClaimOptions{CanWin: true, CanPong: true, CanKong: true, ChowSets: [][2]string{{"dots-6-1", "dots-7-1"}}}
	for _, id := range roster.IDs() {
		persona, _ := roster.ByID(id)
		for _, base := range []Policy{NewEasyPolicy(), NewMediumPolicy(), NewHardPolicy()} {
			decision := NewPersonaPolicy(base, persona).DecideClaim(obs, options, 9)
			if decision.Action.Kind != ActionDeclareWin {
				t.Fatalf("%s/%s chose %s with a legal Win available, want ActionDeclareWin", id, base.Difficulty(), decision.Action.Kind)
			}
		}
	}
}

// TestEveryPersonaDiscardsALegalTile guards the other non-negotiable: a
// persona reweights the legal action set, it never leaves it. Flowers are
// exposed on sight and must never be chosen (§5.4).
func TestEveryPersonaDiscardsALegalTile(t *testing.T) {
	obs := personaObservation(t)
	obs.Hand = append(obs.Hand, rulesengine.Tile{ID: "flower-plum", Kind: rulesengine.Flower})
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	legal := map[string]bool{}
	for _, item := range legalDiscards(obs.Hand) {
		legal[item.ID] = true
	}
	for _, id := range roster.IDs() {
		persona, _ := roster.ByID(id)
		for _, base := range []Policy{NewEasyPolicy(), NewMediumPolicy(), NewHardPolicy()} {
			for seed := uint64(1); seed <= 20; seed++ {
				decision := NewPersonaPolicy(base, persona).DecideDiscard(obs, seed)
				if !legal[decision.Action.TileID] {
					t.Fatalf("%s/%s seed %d discarded %q, which is not a legal discard", id, base.Difficulty(), seed, decision.Action.TileID)
				}
			}
		}
	}
}

// TestSwiftSparrowClaimsWhereStoneLionPasses is the roster's headline
// contrast: given the same ordinary Chow, the rush persona takes the tempo
// and the guard persona keeps its hand closed.
func TestSwiftSparrowClaimsWhereStoneLionPasses(t *testing.T) {
	obs := personaObservation(t)
	options := ClaimOptions{
		Discard:  tile("dots-8-1", rulesengine.Dots, 8, 1),
		ChowSets: [][2]string{{"dots-6-1", "dots-7-1"}},
	}
	sparrow := NewPersonaPolicy(NewHardPolicy(), personaFixture(t, "swift-sparrow")).DecideClaim(obs, options, 3)
	if sparrow.Action.Kind != ActionChow {
		t.Errorf("Swift Sparrow chose %s on an ordinary Chow, want ActionChow", sparrow.Action.Kind)
	}
	for _, id := range []string{"stone-lion", "silent-crane"} {
		decision := NewPersonaPolicy(NewHardPolicy(), personaFixture(t, id)).DecideClaim(obs, options, 3)
		if decision.Action.Kind != ActionPass {
			t.Errorf("%s chose %s on an ordinary Chow, want ActionPass", id, decision.Action.Kind)
		}
	}
}

// TestThunderTigerPrefersThePongToTheChow separates the two calling
// personas: both claim readily, but only one of them wants sequences
// (§6.5 — "may pass an available Chow yet take a later Pong").
func TestThunderTigerPrefersThePongToTheChow(t *testing.T) {
	obs := personaObservation(t)
	options := ClaimOptions{
		Discard:  tile("dots-5-3", rulesengine.Dots, 5, 3),
		CanPong:  true,
		ChowSets: [][2]string{{"dots-6-1", "dots-7-1"}},
	}
	tiger := NewPersonaPolicy(NewHardPolicy(), personaFixture(t, "thunder-tiger")).DecideClaim(obs, options, 3)
	if tiger.Action.Kind != ActionPong {
		t.Errorf("Thunder Tiger chose %s with both a Pong and a Chow available, want ActionPong", tiger.Action.Kind)
	}
}

// TestStoneLionFoldsOnAVisibleThreatBeforeTheWallRunsDown covers §6.3's
// "folds earlier": the §11.3 trigger needs both a threat and a late wall,
// and a Guard-class persona does not wait for the second.
func TestStoneLionFoldsOnAVisibleThreatBeforeTheWallRunsDown(t *testing.T) {
	obs := personaObservation(t)
	obs.DrawableRemaining = 60 // nowhere near §11.3's late-wall threshold
	obs.Opponents[0].Melds = []rulesengine.Meld{
		pongMeld(rulesengine.Characters, 2, false),
		pongMeld(rulesengine.Characters, 5, false),
		pongMeld(rulesengine.Characters, 8, false),
	}
	lion := NewPersonaPolicy(NewHardPolicy(), personaFixture(t, "stone-lion"))
	if !lion.(personaPolicy).shouldFold(obs) {
		t.Fatal("Stone Lion does not fold against three exposed melds on a full wall")
	}
	sparrow := NewPersonaPolicy(NewHardPolicy(), personaFixture(t, "swift-sparrow"))
	if sparrow.(personaPolicy).shouldFold(obs) {
		t.Fatal("Swift Sparrow folds against three exposed melds on a full wall; only a Guard persona should")
	}
}

// TestPersonaAndDifficultyStayOrthogonal is §2.3's requirement: dropping
// from Hard to Easy must degrade execution, not quietly swap the style for
// a different one. Every difficulty ranks the same action best; only how
// reliably it is chosen changes.
func TestPersonaAndDifficultyStayOrthogonal(t *testing.T) {
	obs := personaObservation(t)
	persona := personaFixture(t, "jade-dragon")
	want := NewPersonaPolicy(NewHardPolicy(), persona).DecideDiscard(obs, 1).Action.TileID

	agreements := 0
	const trials = 40
	for seed := uint64(1); seed <= trials; seed++ {
		if NewPersonaPolicy(NewMediumPolicy(), persona).DecideDiscard(obs, seed).Action.TileID == want {
			agreements++
		}
	}
	// Medium takes its persona's top pick most of the time and slips to the
	// runner-up the rest, so it should agree with Hard far more often than
	// not without agreeing always.
	if agreements <= trials/2 {
		t.Fatalf("Medium Jade Dragon agreed with Hard Jade Dragon %d/%d times, want a clear majority", agreements, trials)
	}
}

// TestNewPersonaPolicyPassesThroughAnEmptyPersona keeps the fallback honest:
// an unresolved persona must leave the difficulty policy untouched rather
// than seating a bot with silently-zeroed weights.
func TestNewPersonaPolicyPassesThroughAnEmptyPersona(t *testing.T) {
	base := NewMediumPolicy()
	if got := NewPersonaPolicy(base, Persona{}); got != base {
		t.Fatalf("NewPersonaPolicy(base, zero persona) = %#v, want base unchanged", got)
	}
}
