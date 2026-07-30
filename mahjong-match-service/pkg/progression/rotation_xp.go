package progression

// §12.1 Full Rotation XP: 50 per completed hand, plus a placement award at the
// end of the match.
//
// Kept separate from HandXP because the two modes score differently and share
// almost nothing. Quick Play pays for the quality of a single hand — win,
// self-draw, Tai, Kongs. Full Rotation pays a flat rate per hand and settles
// the rest on final placement, because a hand lost early in a rotation can be
// the right play for the match.

const (
	// §12.1: "Complete each public Full Rotation hand".
	RotationHandXP = FullRotationHandXP

	SourceRotationHand      = "rotation_hand"
	SourceRotationPlacement = "rotation_placement"
)

// §12.1 final-placement awards, first through fourth.
var rotationPlacementXP = [...]int{400, 250, 150, 100}

// RotationHandAward is the flat per-hand award. Unlike Quick Play there is no
// outcome component: §12.1 pays the same for completing a hand however it went.
func RotationHandAward() HandAward {
	return HandAward{
		Source: SourceRotationHand,
		Total:  RotationHandXP,
		Components: []XPComponent{{
			Code:   "rotation_hand",
			Label:  "Full Rotation hand",
			Amount: RotationHandXP,
		}},
	}
}

// RotationPlacementXP is the §12.1 award for finishing in the given position.
// Positions outside first through fourth award nothing rather than guessing:
// a five-seat placement is a bug upstream, and inventing a value would hide it.
func RotationPlacementXP(position int) int {
	if position < 1 || position > len(rotationPlacementXP) {
		return 0
	}
	return rotationPlacementXP[position-1]
}

// RotationPlacementAward is the end-of-match award.
//
// ratingTie is carried through from §8.4: equal table points are genuine
// rating ties even though the podium shows an order. It does not change the XP
// — the spec awards by displayed position — but it travels with the award so
// whatever computes Elo later cannot mistake the position for a clean result.
func RotationPlacementAward(position int, ratingTie bool) HandAward {
	amount := RotationPlacementXP(position)
	if amount == 0 {
		return HandAward{Source: SourceRotationPlacement}
	}
	label := placementLabel(position)
	if ratingTie {
		label += " (tied on table points)"
	}
	return HandAward{
		Source: SourceRotationPlacement,
		Total:  amount,
		Components: []XPComponent{{
			Code:   "rotation_placement",
			Label:  label,
			Amount: amount,
		}},
	}
}

func placementLabel(position int) string {
	switch position {
	case 1:
		return "1st place"
	case 2:
		return "2nd place"
	case 3:
		return "3rd place"
	case 4:
		return "4th place"
	default:
		return "Placement"
	}
}
