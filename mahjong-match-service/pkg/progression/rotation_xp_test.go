package progression

import "testing"

func TestRotationHandPaysAFlatRate(t *testing.T) {
	// §12.1 pays the same for completing a Full Rotation hand however it went.
	// A hand lost early in a rotation can be the right play for the match, so
	// unlike Quick Play there is no outcome component.
	award := RotationHandAward()

	if award.Total != 50 {
		t.Fatalf("Total = %d, want 50", award.Total)
	}
	if len(award.Components) != 1 || award.Components[0].Amount != 50 {
		t.Fatalf("components = %+v, want a single flat component", award.Components)
	}
	if award.Source != SourceRotationHand {
		t.Fatalf("Source = %q", award.Source)
	}
}

func TestRotationPlacementXPMatchesTheSpecTable(t *testing.T) {
	for position, want := range map[int]int{1: 400, 2: 250, 3: 150, 4: 100} {
		if got := RotationPlacementXP(position); got != want {
			t.Fatalf("position %d = %d XP, want %d", position, got, want)
		}
	}
}

func TestRotationPlacementRejectsImpossiblePositions(t *testing.T) {
	// A position outside 1-4 means something upstream is wrong. Awarding a
	// guessed value would hide it.
	for _, position := range []int{0, -1, 5, 99} {
		if got := RotationPlacementXP(position); got != 0 {
			t.Fatalf("position %d awarded %d XP", position, got)
		}
		award := RotationPlacementAward(position, false)
		if award.Total != 0 || len(award.Components) != 0 {
			t.Fatalf("position %d produced an award: %+v", position, award)
		}
	}
}

func TestRotationPlacementNamesThePosition(t *testing.T) {
	award := RotationPlacementAward(1, false)
	if award.Components[0].Label != "1st place" {
		t.Fatalf("label = %q", award.Components[0].Label)
	}
	if RotationPlacementAward(3, false).Components[0].Label != "3rd place" {
		t.Fatal("third place was not labelled")
	}
}

func TestRotationPlacementDisclosesARatingTie(t *testing.T) {
	// §8.4: equal table points are a genuine rating tie even though the podium
	// shows an order. The XP still follows the displayed position, but the
	// award says so, because a player who sees "2nd place" for a score they
	// matched deserves the explanation.
	tied := RotationPlacementAward(2, true)
	clean := RotationPlacementAward(2, false)

	if tied.Total != clean.Total {
		t.Fatalf("a tie changed the XP: %d vs %d", tied.Total, clean.Total)
	}
	if tied.Components[0].Label == clean.Components[0].Label {
		t.Fatal("a rating tie was not disclosed in the award")
	}
}

func TestRotationAndQuickPlayScoreDifferently(t *testing.T) {
	// The two modes share almost nothing, and conflating them is the mistake
	// this separation exists to prevent: a Full Rotation hand must not pay
	// Quick Play's win, Zimo, or Tai bonuses.
	quick := HandXP(HandOutcome{Won: true, Zimo: true, RawTai: 10}, 0)
	rotation := RotationHandAward()

	if rotation.Total == quick.Total {
		t.Fatal("a Full Rotation hand paid the Quick Play rate")
	}
	if rotation.Total != 50 {
		t.Fatalf("rotation hand = %d XP, want the flat 50", rotation.Total)
	}
}
