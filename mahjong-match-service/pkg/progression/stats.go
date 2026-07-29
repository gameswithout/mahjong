package progression

import "github.com/gameswithout/mahjong/rulesengine"

// §12.3 achievement source statistics.
//
// AGS incremental achievements unlock when a linked Statistic crosses a goal
// value, so these are the values the achievement configuration evaluates. The
// mapping is a pure function over one completed hand: storage owns nothing
// here, and the AGS call is somebody else's problem.
//
// Our own xp_awards and jade_hand_participation tables remain the audit
// record. These stats are a projection for AGS to evaluate against, the same
// relationship jade_wallet_sync has with the AGS Wallet.

// Update strategies, matching the v2 bulk statitem API's enum.
const (
	StatIncrement = "INCREMENT"
	StatMax       = "MAX"
)

// Stat codes. These must match the stat definitions configured in the
// namespace exactly; a typo is a silent no-op, not an error.
const (
	StatPublicHandsCompleted = "public-hands-completed"
	StatPublicHandsWon       = "public-hands-won"
	StatZimoWins             = "zimo-wins"
	StatKongsDeclared        = "kongs-declared"
	StatHighestRawTai        = "highest-raw-tai"
	// P2.3 dashboard statistics. Unlike the codes above, no achievement reads
	// these — they exist so a player can see how they actually play. They ride
	// the same bulk update because they come from the same completed hand.
	StatPublicHandsDealtIn = "public-hands-dealt-in"
	StatPublicHandsTing    = "public-hands-ting"
)

// StatUpdate is one entry in a bulk statitem update.
type StatUpdate struct {
	StatCode string
	Strategy string
	Value    float64
}

// patternStatCodes maps a scoring pattern emitted by rulesengine onto the stat
// that counts wins containing it.
//
// Keyed on the exact pattern name the engine produces (rulesengine/scoring.go).
// A pattern absent from this map simply scores no achievement stat, which is
// the correct behaviour for the many patterns §12.3 does not award for.
var patternStatCodes = map[string]string{
	"All Pongs":             "wins-all-pongs",
	"Full Flush":            "wins-full-flush",
	"Half Flush":            "wins-half-flush",
	"Big Three Dragons":     "wins-big-three-dragons",
	"Big Four Winds":        "wins-big-four-winds",
	"All Honors":            "wins-all-honors",
	"Eight Flowers":         "wins-eight-flowers",
	"Robbing an Added Kong": "wins-robbing-kong",
	"Win After Replacement": "wins-after-replacement",
	"Last Tile Zimo":        "wins-last-tile-zimo",
	"Concealed Zimo":        "wins-concealed-zimo",
	"Complete Seasons":      "wins-complete-flowers",
	"Complete Flowers":      "wins-complete-flowers",
	// §12.3 Three of a Mind is "Three Concealed Pongs or a higher
	// concealed-Pong tier", so all three tiers feed one stat.
	"Three Concealed Pongs": "wins-concealed-pongs",
	"Four Concealed Pongs":  "wins-concealed-pongs",
	"Five Concealed Pongs":  "wins-concealed-pongs",
}

// HandStats prices one completed hand into achievement statistics.
//
// Returns nil for AI Practice. §11.4 is explicit that Practice grants no
// achievements, so Practice must not move a single achievement stat — the one
// invariant most likely to be broken by a later refactor, and the one most
// worth a test.
//
// A seat played mostly by a takeover bot still counts the hand as completed —
// the player was present for it — but earns none of the play-quality stats,
// mirroring how §12.1 pays that seat completion XP only.
func HandStats(outcome HandOutcome, view rulesengine.SeatView) []StatUpdate {
	if outcome.Practice {
		return nil
	}

	updates := []StatUpdate{
		{StatCode: StatPublicHandsCompleted, Strategy: StatIncrement, Value: 1},
	}
	if outcome.TakenOverMajority {
		return updates
	}

	if outcome.Kongs > 0 {
		updates = append(updates, StatUpdate{
			StatCode: StatKongsDeclared,
			Strategy: StatIncrement,
			Value:    float64(outcome.Kongs),
		})
	}

	// Both P2.3 rates are counted against hands completed, so they are
	// recorded for every seat that played its own hand — including the ones
	// that lost, which is where a deal-in necessarily happens.
	if outcome.DealtIn {
		updates = append(updates, StatUpdate{
			StatCode: StatPublicHandsDealtIn, Strategy: StatIncrement, Value: 1,
		})
	}
	if outcome.Ting {
		updates = append(updates, StatUpdate{
			StatCode: StatPublicHandsTing, Strategy: StatIncrement, Value: 1,
		})
	}

	if !outcome.Won {
		return updates
	}

	updates = append(updates, StatUpdate{
		StatCode: StatPublicHandsWon, Strategy: StatIncrement, Value: 1,
	})
	if outcome.Zimo {
		updates = append(updates, StatUpdate{
			StatCode: StatZimoWins, Strategy: StatIncrement, Value: 1,
		})
	}
	if outcome.RawTai > 0 {
		// MAX, not INCREMENT: §12.3's High Value and Master Craft ask for a
		// single hand worth at least N Tai, not a lifetime total.
		updates = append(updates, StatUpdate{
			StatCode: StatHighestRawTai,
			Strategy: StatMax,
			Value:    float64(outcome.RawTai),
		})
	}

	updates = append(updates, patternWinStats(view)...)
	return updates
}

// patternWinStats counts each awarded pattern in the local seat's winning hand
// at most once.
//
// The de-duplication is not cosmetic: the v2 bulk API processes entries
// concurrently and explicitly warns against repeating a statCode in one
// request, and Complete Seasons and Complete Flowers both map to the same
// stat, so a hand holding both would otherwise emit it twice.
func patternWinStats(view rulesengine.SeatView) []StatUpdate {
	if view.HandResult == nil {
		return nil
	}
	seen := map[string]bool{}
	var updates []StatUpdate
	for _, winner := range view.HandResult.Winners {
		if winner.Seat != view.Seat {
			continue
		}
		for _, pattern := range winner.Score.Patterns {
			statCode, awarded := patternStatCodes[pattern.Name]
			if !awarded || seen[statCode] {
				continue
			}
			seen[statCode] = true
			updates = append(updates, StatUpdate{
				StatCode: statCode, Strategy: StatIncrement, Value: 1,
			})
		}
	}
	return updates
}
