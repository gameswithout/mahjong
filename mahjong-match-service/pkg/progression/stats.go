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

	// Rate denominators and numerators. AGS Statistics stores one scalar per
	// code and cannot divide, so every rate the dashboard shows is two
	// counters written here and a division done at read time. Storing the
	// ratio instead would be lossy — a 1-of-2 and a 500-of-1000 player would
	// become indistinguishable — and could not be updated incrementally.
	StatTotalRawTai         = "total-raw-tai"
	StatPublicHandsOpened   = "public-hands-opened"
	StatPublicHandsDrawn    = "public-hands-drawn"
	StatPublicHandsTingDraw = "public-hands-ting-at-draw"

	// Tile efficiency. Unlike every other statistic here these cannot be read
	// off a finished hand — whether a discard was the efficient one is a fact
	// about the position it was made in, which the final projection no longer
	// holds. They are counted by replaying the hand's own events.
	StatDiscardsMade      = "discards-made"
	StatDiscardsEfficient = "discards-efficient"
)

// seatStatCodes name the per-seat split counters. East deals, so its results
// are not comparable with the other three and pooling them hides a real
// effect; a player who only ever loses from North learns nothing from a
// combined win rate.
var seatStatCodes = map[rulesengine.Seat]struct{ hands, wins string }{
	rulesengine.East:  {"hands-seat-east", "hands-won-seat-east"},
	rulesengine.South: {"hands-seat-south", "hands-won-seat-south"},
	rulesengine.West:  {"hands-seat-west", "hands-won-seat-west"},
	rulesengine.North: {"hands-seat-north", "hands-won-seat-north"},
}

// SeatSplitStatCodes lists every per-seat counter, in table order, so callers
// that read the dashboard do not have to know how the codes are spelled.
func SeatSplitStatCodes() []string {
	codes := make([]string, 0, len(seatStatCodes)*2)
	for _, seat := range []rulesengine.Seat{
		rulesengine.East, rulesengine.South, rulesengine.West, rulesengine.North,
	} {
		codes = append(codes, seatStatCodes[seat].hands, seatStatCodes[seat].wins)
	}
	return codes
}

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
// Returns nil for Practice. During Alpha, only Online Play advances levels or
// achievements; bot hands remain a consequence-free learning space.
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
	if outcome.Opened {
		updates = append(updates, StatUpdate{
			StatCode: StatPublicHandsOpened, Strategy: StatIncrement, Value: 1,
		})
	}
	// The tenpai-at-draw rate needs its own denominator. Measured against all
	// hands it would mostly report how often the player's table reached a
	// draw at all, which is a fact about the table rather than about them.
	if outcome.ExhaustiveDraw {
		updates = append(updates, StatUpdate{
			StatCode: StatPublicHandsDrawn, Strategy: StatIncrement, Value: 1,
		})
		if outcome.Ting {
			updates = append(updates, StatUpdate{
				StatCode: StatPublicHandsTingDraw, Strategy: StatIncrement, Value: 1,
			})
		}
	}
	if codes, known := seatStatCodes[outcome.Seat]; known {
		updates = append(updates, StatUpdate{
			StatCode: codes.hands, Strategy: StatIncrement, Value: 1,
		})
		if outcome.Won {
			updates = append(updates, StatUpdate{
				StatCode: codes.wins, Strategy: StatIncrement, Value: 1,
			})
		}
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
		// The running total the average is divided out of. It is deliberately
		// a separate code rather than a replacement for the MAX: the two
		// answer different questions, and the best hand a player ever had is
		// not recoverable from a sum.
		updates = append(updates, StatUpdate{
			StatCode: StatTotalRawTai,
			Strategy: StatIncrement,
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
