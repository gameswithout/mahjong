// Command gensettlementgoldens regenerates the "settlements" section of
// rulesengine/testdata/goldens/settlement.json.
//
// Every expected net is computed independently of SettleHand, straight from
// the §5.12/§7.3 formulas (raw = stake*(rawTai+dealerTai); single-claim
// payers cap via min(raw, cap); multi-claim payers cap via the specified
// integer largest-remainder allocation, reimplemented here rather than
// imported, since SettleHand's allocator is unexported). The "continuations"
// section and any hand-authored cases are preserved as-is.
//
// Run with: go run ./rulesengine/cmd/gensettlementgoldens
package main

import (
	"encoding/json"
	"fmt"
	"os"
)

type winnerJSON struct {
	Seat   string `json:"seat"`
	RawTai int    `json:"raw_tai"`
}

type resultJSON struct {
	Kind    string       `json:"kind"`
	Payer   string       `json:"payer,omitempty"`
	Winners []winnerJSON `json:"winners,omitempty"`
}

type expectJSON struct {
	Net map[string]int64 `json:"net"`
}

type settlementCase struct {
	Name          string     `json:"name"`
	Tier          string     `json:"tier"`
	Dealer        string     `json:"dealer"`
	Continuations int        `json:"continuations"`
	Result        resultJSON `json:"result"`
	Expect        expectJSON `json:"expect"`
}

type fileJSON struct {
	Version       int              `json:"version"`
	Rules         string           `json:"rules"`
	Settlements   []settlementCase `json:"settlements"`
	Continuations []json.RawMessage `json:"continuations"`
}

var seats = []string{"E", "S", "W", "N"}

var tierStakeCap = map[string][2]int64{
	"bamboo":    {10, 300},
	"sparrow":   {100, 3000},
	"windcloud": {1000, 30000},
	"dragons":   {10000, 300000},
}

func dealerTai(k int) int64 { return int64(1 + 2*k) }

func otherSeats(exclude string) []string {
	out := make([]string, 0, 3)
	for _, s := range seats {
		if s != exclude {
			out = append(out, s)
		}
	}
	return out
}

func zeroNet() map[string]int64 {
	return map[string]int64{"E": 0, "S": 0, "W": 0, "N": 0}
}

// singlePayerCase builds a discard/rob-style case: one payer, one winner.
func singlePayerCase(name, tier, dealer string, k int, kind, payer, winner string, rawTai int) settlementCase {
	stakeCap := tierStakeCap[tier]
	stake, cap := stakeCap[0], stakeCap[1]
	effective := int64(rawTai)
	if winner == dealer || payer == dealer {
		effective += dealerTai(k)
	}
	raw := stake * effective
	amount := raw
	if amount > cap {
		amount = cap
	}
	net := zeroNet()
	net[winner] += amount
	net[payer] -= amount
	return settlementCase{
		Name: name, Tier: tier, Dealer: dealer, Continuations: k,
		Result: resultJSON{Kind: kind, Payer: payer, Winners: []winnerJSON{{Seat: winner, RawTai: rawTai}}},
		Expect: expectJSON{Net: net},
	}
}

// threePayerCase builds a zimo/eight_flowers/heavenly-style case: the three
// non-winner seats each pay independently, each capped on its own claim.
func threePayerCase(name, tier, dealer string, k int, kind, winner string, rawTai int) settlementCase {
	stakeCap := tierStakeCap[tier]
	stake, cap := stakeCap[0], stakeCap[1]
	net := zeroNet()
	for _, payer := range otherSeats(winner) {
		effective := int64(rawTai)
		if winner == dealer || payer == dealer {
			effective += dealerTai(k)
		}
		raw := stake * effective
		amount := raw
		if amount > cap {
			amount = cap
		}
		net[winner] += amount
		net[payer] -= amount
	}
	return settlementCase{
		Name: name, Tier: tier, Dealer: dealer, Continuations: k,
		Result: resultJSON{Kind: kind, Winners: []winnerJSON{{Seat: winner, RawTai: rawTai}}},
		Expect: expectJSON{Net: net},
	}
}

// multiWinnerCapCase builds a discard case where several winners claim
// against one payer whose cap is exceeded, using the §7.3 integer
// largest-remainder allocation (winner seat order breaks equal remainders).
func multiWinnerCapCase(name, tier, dealer, payer string, k int, winnerTai map[string]int) settlementCase {
	stakeCap := tierStakeCap[tier]
	stake, cap := stakeCap[0], stakeCap[1]

	type claim struct {
		seat string
		raw  int64
	}
	var claims []claim
	var total int64
	for _, seat := range seats {
		rawTai, ok := winnerTai[seat]
		if !ok {
			continue
		}
		effective := int64(rawTai)
		if seat == dealer || payer == dealer {
			effective += dealerTai(k)
		}
		raw := stake * effective
		claims = append(claims, claim{seat: seat, raw: raw})
		total += raw
	}

	amounts := make(map[string]int64, len(claims))
	if total <= cap {
		for _, c := range claims {
			amounts[c.seat] = c.raw
		}
	} else {
		type alloc struct {
			seat      string
			amount    int64
			remainder int64
		}
		var allocs []alloc
		var assigned int64
		for _, c := range claims {
			product := cap * c.raw
			amount := product / total
			remainder := product % total
			allocs = append(allocs, alloc{c.seat, amount, remainder})
			assigned += amount
		}
		// Largest remainder first; ties broken by seat/claim order (already
		// the order claims were appended, matching winner seat order E-S-W-N).
		order := make([]int, len(allocs))
		for i := range order {
			order[i] = i
		}
		for i := 1; i < len(order); i++ {
			for j := i; j > 0 && allocs[order[j]].remainder > allocs[order[j-1]].remainder; j-- {
				order[j], order[j-1] = order[j-1], order[j]
			}
		}
		leftover := cap - assigned
		pos := 0
		for leftover > 0 {
			allocs[order[pos%len(order)]].amount++
			pos++
			leftover--
		}
		for _, a := range allocs {
			amounts[a.seat] = a.amount
		}
	}

	net := zeroNet()
	var winnerList []winnerJSON
	for _, seat := range seats {
		rawTai, ok := winnerTai[seat]
		if !ok {
			continue
		}
		net[seat] += amounts[seat]
		net[payer] -= amounts[seat]
		winnerList = append(winnerList, winnerJSON{Seat: seat, RawTai: rawTai})
	}

	return settlementCase{
		Name: name, Tier: tier, Dealer: dealer, Continuations: k,
		Result: resultJSON{Kind: "discard", Payer: payer, Winners: winnerList},
		Expect: expectJSON{Net: net},
	}
}

func generate() []settlementCase {
	var cases []settlementCase
	tiers := []string{"bamboo", "sparrow", "windcloud", "dragons"}

	// --- Discard model: sweep dealer-is-winner / dealer-is-payer / neither,
	// across all tiers and a small + a cap-triggering raw Tai. ---
	discardScenarios := []struct {
		name   string
		dealer string
		payer  string
		winner string
	}{
		{"dealer-is-winner", "E", "S", "E"},
		{"dealer-is-payer", "E", "E", "S"},
		{"dealer-is-neither", "E", "S", "W"},
	}
	for _, scenario := range discardScenarios {
		for _, tier := range tiers {
			for _, rawTai := range []int{3, 20} {
				name := fmt.Sprintf("discard-%s-%s-tai%d", scenario.name, tier, rawTai)
				cases = append(cases, singlePayerCase(name, tier, scenario.dealer, 1, "discard", scenario.payer, scenario.winner, rawTai))
			}
		}
	}

	// --- Rob model (declarer pays, same shape as discard) ---
	for _, tier := range tiers {
		cases = append(cases, singlePayerCase("rob-dealer-is-declarer-"+tier, tier, "E", 0, "rob", "E", "S", 6))
		cases = append(cases, singlePayerCase("rob-non-dealer-declarer-"+tier, tier, "E", 0, "rob", "N", "S", 6))
	}

	// --- Zimo model: dealer winner / dealer among payers / neither ---
	zimoScenarios := []struct {
		name   string
		dealer string
		winner string
	}{
		{"dealer-zimo-winner", "E", "E"},
		{"non-dealer-zimo-dealer-pays-more", "E", "S"},
	}
	for _, scenario := range zimoScenarios {
		for _, tier := range tiers {
			for _, rawTai := range []int{4, 25} {
				name := fmt.Sprintf("zimo-%s-%s-tai%d", scenario.name, tier, rawTai)
				cases = append(cases, threePayerCase(name, tier, scenario.dealer, 2, "zimo", scenario.winner, rawTai))
			}
		}
	}

	// --- Eight Flowers / Heavenly (three-payer, fixed high raw Tai) ---
	for _, tier := range tiers {
		cases = append(cases, threePayerCase("eight-flowers-non-dealer-"+tier, tier, "E", 0, "eight_flowers", "S", 15))
		cases = append(cases, threePayerCase("heavenly-dealer-winner-"+tier, tier, "E", 3, "heavenly", "E", 30))
	}

	// --- Dealer Tai progression at a fixed tier/raw Tai (k = 0..10) ---
	for k := 0; k <= 10; k++ {
		name := fmt.Sprintf("dealer-tai-progression-k%d", k)
		cases = append(cases, singlePayerCase(name, "sparrow", "E", k, "discard", "S", "E", 5))
	}

	// --- Multi-winner cap-split cases (largest-remainder allocation) ---
	cases = append(cases, multiWinnerCapCase("three-winners-cap-split-bamboo", "bamboo", "N", "N", 0,
		map[string]int{"E": 12, "S": 9, "W": 7}))
	cases = append(cases, multiWinnerCapCase("two-winners-dealer-payer-cap-split", "sparrow", "N", "N", 1,
		map[string]int{"E": 30, "S": 18}))
	cases = append(cases, multiWinnerCapCase("three-winners-no-cap-triggered", "dragons", "N", "N", 0,
		map[string]int{"E": 2, "S": 1, "W": 1}))

	return cases
}

func main() {
	path := "rulesengine/testdata/goldens/settlement.json"
	raw, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "read existing goldens:", err)
		os.Exit(1)
	}
	var existing fileJSON
	if err := json.Unmarshal(raw, &existing); err != nil {
		fmt.Fprintln(os.Stderr, "parse existing goldens:", err)
		os.Exit(1)
	}

	generated := generate()
	seen := map[string]bool{}
	final := make([]settlementCase, 0, len(existing.Settlements)+len(generated))
	for _, c := range existing.Settlements {
		if seen[c.Name] {
			fmt.Fprintln(os.Stderr, "duplicate case name in existing file:", c.Name)
			os.Exit(1)
		}
		seen[c.Name] = true
		final = append(final, c)
	}
	for _, c := range generated {
		if seen[c.Name] {
			fmt.Fprintln(os.Stderr, "generated case collides with existing name:", c.Name)
			os.Exit(1)
		}
		seen[c.Name] = true
		final = append(final, c)
	}

	out := fileJSON{Version: existing.Version, Rules: existing.Rules, Settlements: final, Continuations: existing.Continuations}
	encoded, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "encode goldens:", err)
		os.Exit(1)
	}
	if err := os.WriteFile(path, append(encoded, '\n'), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "write goldens:", err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "wrote %d settlement cases (%d existing + %d generated) to %s\n",
		len(final), len(existing.Settlements), len(generated), path)
}
