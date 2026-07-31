// Package progression implements §12.1 XP awards and §12.2 the level curve.
//
// XP measures participation and mastery. It never changes matchmaking strength
// or table eligibility, and nothing in this package may be consulted when
// deciding whether a player can enter a lobby.
//
// The award rules are pure functions over a hand's outcome and the day's
// running totals, so they are testable without a database. Storage owns the
// idempotency keys and the SQL; this file owns only the arithmetic.
package progression

import "time"

// §12.1 award values.
const (
	OnboardingXP = 500

	PracticeHandXP     = 25
	PublicHandXP       = 100
	PublicWinXP        = 75
	ZimoXP             = 25
	TaiXPPerTai        = 10
	TaiXPCapPerHand    = 100
	KongXPPerKong      = 5
	KongXPCapPerHand   = 20
	FullRotationHandXP = 50
)

// §12.2 level curve. XP to advance from level L to L+1 is 500 + 100*(L-1).
const (
	BaseLevelXP   = 500
	LevelXPStep   = 100
	MaxLevel      = 10
	StartingLevel = 1
)

// Award sources. These are the reason codes carried on every ledger row, and
// analytics counts them; they are not display text.
const (
	SourceOnboarding = "onboarding"
	SourcePractice   = "practice_hand"
	SourcePublicHand = "public_hand"
)

const RulesVersion = "taiwanese-16-v1.1"

const (
	ComponentTutorial      = "tutorial"
	ComponentPracticeHand  = "practice_hand"
	ComponentHandCompleted = "hand_completed"
	ComponentHandWon       = "hand_won"
	ComponentZimo          = "zimo"
	ComponentTai           = "tai"
	ComponentKong          = "kong"
)

// HandOutcome is everything §12.1 needs to price one completed hand for one
// player. It is derived from the authoritative seat view, never from anything
// the client claims.
type HandOutcome struct {
	Practice bool
	Won      bool
	Zimo     bool
	RawTai   int
	// Kongs the player declared during the hand.
	Kongs int
	// TakenOverMajority is true when the seat was bot-controlled for more than
	// half the hand. §12.1: such a player receives completion XP only.
	TakenOverMajority bool
	// DealtIn is true when somebody won on this seat's discard. It carries no
	// XP consequence — §12.1 does not punish dealing in — and exists only as a
	// P2.3 statistic, because deal-in rate is the number that tells a player
	// most about their defensive play.
	DealtIn bool
	// Ting is true when this seat was still holding a waiting hand as the hand
	// ended. Deliberately not "reached Ting at any point": that would need the
	// runtime to watch every transition and remember, and this is derivable
	// from the final projection alone. The dashboard labels it accordingly.
	Ting bool
}

// XPComponent is one line of the award, kept separate so the result screen can
// explain where the number came from instead of showing an unexplained total.
type XPComponent struct {
	Code   string
	Label  string
	Amount int
}

type HandAward struct {
	AwardID    string
	Source     string
	Total      int
	Components []XPComponent
	// Retained on the wire for compatibility with earlier clients. Alpha has
	// no daily XP cap, so new awards leave this false.
	CappedByDaily bool
}

// HandXP prices one completed hand.
//
// practiceXPToday is retained in the signature for storage/API compatibility.
// Alpha progression has no daily XP cap.
func HandXP(outcome HandOutcome, practiceXPToday int) HandAward {
	if outcome.Practice {
		return practiceAward(outcome)
	}
	return publicAward(outcome)
}

func practiceAward(outcome HandOutcome) HandAward {
	award := HandAward{
		Source: SourcePractice,
		Total:  PracticeHandXP,
		Components: []XPComponent{{
			Code: ComponentPracticeHand, Label: "Practice hand", Amount: PracticeHandXP,
		}},
	}
	// Match History includes every completed game, including Practice. Keep a
	// zero-value outcome marker in the same immutable ledger row without
	// changing Practice XP or feeding the public achievement projection.
	if outcome.Won {
		award.Components = append(award.Components, XPComponent{
			Code: ComponentHandWon, Label: "Won the hand", Amount: 0,
		})
	}
	return award
}

func publicAward(outcome HandOutcome) HandAward {
	award := HandAward{
		Source: SourcePublicHand,
		Total:  PublicHandXP,
		Components: []XPComponent{{
			Code: ComponentHandCompleted, Label: "Hand completed", Amount: PublicHandXP,
		}},
	}

	// §12.1: a seat under takeover control for more than half the hand earns
	// completion XP only. The player was not the one making those decisions.
	if outcome.TakenOverMajority {
		return award
	}

	if outcome.Won {
		award.Total += PublicWinXP
		award.Components = append(award.Components,
			XPComponent{Code: ComponentHandWon, Label: "Won the hand", Amount: PublicWinXP})

		if outcome.Zimo {
			award.Total += ZimoXP
			award.Components = append(award.Components,
				XPComponent{Code: ComponentZimo, Label: "Self-draw", Amount: ZimoXP})
		}

		if tai := taiBonus(outcome.RawTai); tai > 0 {
			award.Total += tai
			award.Components = append(award.Components,
				XPComponent{Code: ComponentTai, Label: "Tai scored", Amount: tai})
		}
	}

	// Kongs are declared during play, so they pay whether or not the hand was
	// won. Chow and Pong claims are worth 0 and are deliberately not listed.
	if kong := kongBonus(outcome.Kongs); kong > 0 {
		award.Total += kong
		award.Components = append(award.Components,
			XPComponent{Code: ComponentKong, Label: "Kongs declared", Amount: kong})
	}

	return award
}

// OnboardingAward is the one-time award shared by completion and intentional
// skip. The caller supplies the stable award ID because it includes the user
// identity and belongs to the persistence boundary.
func OnboardingAward() HandAward {
	return HandAward{
		Source: SourceOnboarding,
		Total:  OnboardingXP,
		Components: []XPComponent{{
			Code: ComponentTutorial, Label: "Tutorial", Amount: OnboardingXP,
		}},
	}
}

func taiBonus(rawTai int) int {
	if rawTai <= 0 {
		return 0
	}
	return min(rawTai*TaiXPPerTai, TaiXPCapPerHand)
}

func kongBonus(kongs int) int {
	if kongs <= 0 {
		return 0
	}
	return min(kongs*KongXPPerKong, KongXPCapPerHand)
}

// Level is a player's standing derived from lifetime XP. It is always derived,
// never stored as a fact of its own: §12.2 requires the server to recompute
// level from lifetime XP if the curve ever changes.
type Level struct {
	Level int
	// XPIntoLevel and XPForNextLevel describe progress through the current
	// level. At the cap both are zero and AtCap is true.
	XPIntoLevel    int
	XPForNextLevel int
	LifetimeXP     int
	AtCap          bool
}

// XPToAdvance is the §12.2 cost of moving from level to level+1.
func XPToAdvance(level int) int {
	if level < StartingLevel {
		level = StartingLevel
	}
	return BaseLevelXP + LevelXPStep*(level-StartingLevel)
}

// LevelForXP walks the increasingly difficult curve from level 1. Alpha caps at level 10;
// excess XP is retained but does not display a higher level.
func LevelForXP(lifetimeXP int) Level {
	if lifetimeXP < 0 {
		lifetimeXP = 0
	}
	level := StartingLevel
	remaining := lifetimeXP
	for level < MaxLevel {
		cost := XPToAdvance(level)
		if remaining < cost {
			return Level{
				Level:          level,
				XPIntoLevel:    remaining,
				XPForNextLevel: cost,
				LifetimeXP:     lifetimeXP,
			}
		}
		remaining -= cost
		level++
	}
	return Level{
		Level:      MaxLevel,
		LifetimeXP: lifetimeXP,
		AtCap:      true,
	}
}

// UTCDay keeps XP ledger rows partitionable and auditable by UTC date.
func UTCDay(at time.Time) time.Time {
	utc := at.UTC()
	return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
}
