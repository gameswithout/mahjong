package progression

import "github.com/gameswithout/mahjong/rulesengine"

// OutcomeFromView reads a completed hand's XP inputs off the authoritative
// seat projection. Everything priced by §12.1 is derived here from server
// state; nothing is taken from the client.
//
// Returns false when the view is not a completed hand, so callers can treat
// "no hand to price" and "a hand worth zero" as different things.
func OutcomeFromView(
	view rulesengine.SeatView,
	practice bool,
	takenOverMajority bool,
) (HandOutcome, bool) {
	if view.HandResult == nil {
		return HandOutcome{}, false
	}

	outcome := HandOutcome{
		Practice:          practice,
		Kongs:             declaredKongs(view),
		TakenOverMajority: takenOverMajority,
		// Payer is only set for a discard win, and names the seat whose tile
		// was claimed. An exhaustive draw or a Zimo has nobody to blame.
		DealtIn: view.HandResult.Kind == rulesengine.WinDiscard &&
			view.HandResult.Payer == view.Seat,
		// A non-empty wait list is the projection's own statement that this
		// seat was one tile from a win when the hand ended.
		Ting: len(view.Waits) > 0,
	}

	for _, winner := range view.HandResult.Winners {
		if winner.Seat != view.Seat {
			continue
		}
		outcome.Won = true
		outcome.RawTai = winner.Score.RawTai
		// §12.1 pays the Zimo bonus for winning by self-draw. Heavenly and
		// Eight Flowers are their own win kinds and are deliberately not
		// treated as Zimo here — the spec lists one bonus, for one kind.
		outcome.Zimo = view.HandResult.Kind == rulesengine.WinZimo
		break
	}

	return outcome, true
}

// declaredKongs counts this seat's Kongs from its own melds. Exposed and
// concealed Kongs both count: §12.1 pays for declaring a legal Kong and draws
// no distinction between them.
func declaredKongs(view rulesengine.SeatView) int {
	kongs := 0
	for _, meld := range view.OwnMelds {
		if meld.Type == rulesengine.MeldKong {
			kongs++
		}
	}
	return kongs
}
