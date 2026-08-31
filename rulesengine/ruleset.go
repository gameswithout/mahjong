package rulesengine

// Ruleset binds hand rules to an explicit settlement sub-selection. Keeping
// the policy here prevents a lobby or result client from silently choosing a
// payout model that does not belong to the rules being played.
type Ruleset struct {
	ID         string           `json:"id"`
	Settlement SettlementPolicy `json:"settlement"`
}

type SettlementModel string

const SettlementModelLinearBaseTai SettlementModel = "linear_base_tai"

// SettlementPolicy is the configurable payout portion of a ruleset.
// Amounts remain integer table-stake units so lobby tiers can scale the same
// rules without changing their shape.
type SettlementPolicy struct {
	ID               string          `json:"id"`
	Model            SettlementModel `json:"model"`
	BaseUnits        int64           `json:"base_units"`
	TaiCap           int64           `json:"tai_cap"`
	DealerMultiplier int64           `json:"dealer_multiplier"`
}

const Taiwanese16V11RulesetID = "taiwanese-16-v1.1"

var Taiwanese16V11Ruleset = Ruleset{
	ID: Taiwanese16V11RulesetID,
	Settlement: SettlementPolicy{
		ID:               "taiwanese-linear-base-tai-v1",
		Model:            SettlementModelLinearBaseTai,
		BaseUnits:        1,
		TaiCap:           16,
		DealerMultiplier: 2,
	},
}
