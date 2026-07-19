// Command gengoldens regenerates rulesengine/testdata/goldens/scoring.json.
//
// Each case's expected patterns/raw_tai are computed independently of
// ScoreHand by the small reference functions below, which reimplement the
// §6.1/§6.2 pattern table directly from the spec rather than by calling the
// engine. rules.CanWin is used only to confirm a constructed hand is
// structurally a legal win (5 melds + pair) — never to derive the expected
// score. This keeps the fixtures a genuine independent check.
//
// Run with: go run ./rulesengine/cmd/gengoldens
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"

	rules "github.com/gameswithout/mahjong/rulesengine"
)

type meldJSON struct {
	Type      string   `json:"type"`
	Tiles     []string `json:"tiles"`
	Concealed bool     `json:"concealed,omitempty"`
	Added     bool     `json:"added,omitempty"`
	Claimed   bool     `json:"claimed,omitempty"`
}

type contextJSON struct {
	Seat            string `json:"seat,omitempty"`
	PrevailingWind  string `json:"prevailing_wind,omitempty"`
	DiscardWin      bool   `json:"discard_win,omitempty"`
	Zimo            bool   `json:"zimo,omitempty"`
	Replacement     bool   `json:"replacement,omitempty"`
	LastTile        bool   `json:"last_tile,omitempty"`
	RobbedAddedKong bool   `json:"robbed_added_kong,omitempty"`
	EightFlowers    bool   `json:"eight_flowers,omitempty"`
	EarthlyHand     bool   `json:"earthly_hand,omitempty"`
	HeavenlyHand    bool   `json:"heavenly_hand,omitempty"`
	SingleWait      bool   `json:"single_wait,omitempty"`
}

type expectJSON struct {
	Winning  bool           `json:"winning"`
	RawTai   int            `json:"raw_tai"`
	Patterns map[string]int `json:"patterns"`
}

type caseJSON struct {
	Name    string      `json:"name"`
	Hand    []string    `json:"hand"`
	Melds   []meldJSON  `json:"melds"`
	Flowers []string    `json:"flowers"`
	Context contextJSON `json:"context"`
	Expect  expectJSON  `json:"expect"`
}

type fileJSON struct {
	Version int        `json:"version"`
	Rules   string     `json:"rules"`
	Notes   string     `json:"notes"`
	Cases   []caseJSON `json:"cases"`
}

var catalogByID = func() map[string]rules.Tile {
	m := map[string]rules.Tile{}
	for _, t := range rules.Catalog() {
		m[t.ID] = t
	}
	return m
}()

func resolveTiles(ids []string) []rules.Tile {
	out := make([]rules.Tile, 0, len(ids))
	for _, id := range ids {
		t, ok := catalogByID[id]
		if !ok {
			panic("unknown tile id " + id)
		}
		out = append(out, t)
	}
	return out
}

// --- tile-ID builders -------------------------------------------------

func chow(kind string, rank int) []string {
	return []string{
		fmt.Sprintf("%s-%d-1", kind, rank),
		fmt.Sprintf("%s-%d-1", kind, rank+1),
		fmt.Sprintf("%s-%d-1", kind, rank+2),
	}
}

func pongNum(kind string, rank, startCopy int) []string {
	return []string{
		fmt.Sprintf("%s-%d-%d", kind, rank, startCopy),
		fmt.Sprintf("%s-%d-%d", kind, rank, startCopy+1),
		fmt.Sprintf("%s-%d-%d", kind, rank, startCopy+2),
	}
}

func kongNum(kind string, rank int) []string {
	return []string{
		fmt.Sprintf("%s-%d-1", kind, rank),
		fmt.Sprintf("%s-%d-2", kind, rank),
		fmt.Sprintf("%s-%d-3", kind, rank),
		fmt.Sprintf("%s-%d-4", kind, rank),
	}
}

func pairNum(kind string, rank, startCopy int) []string {
	return []string{
		fmt.Sprintf("%s-%d-%d", kind, rank, startCopy),
		fmt.Sprintf("%s-%d-%d", kind, rank, startCopy+1),
	}
}

func honorPong(kind, name string, startCopy int) []string {
	return []string{
		fmt.Sprintf("%s-%s-%d", kind, name, startCopy),
		fmt.Sprintf("%s-%s-%d", kind, name, startCopy+1),
		fmt.Sprintf("%s-%s-%d", kind, name, startCopy+2),
	}
}

func honorPair(kind, name string, startCopy int) []string {
	return []string{
		fmt.Sprintf("%s-%s-%d", kind, name, startCopy),
		fmt.Sprintf("%s-%s-%d", kind, name, startCopy+1),
	}
}

// --- case builder -------------------------------------------------------

type builder struct {
	name    string
	handIDs []string
	melds   []meldJSON
	flowers []string
	used    map[string]bool
}

func newCase(name string) *builder {
	return &builder{name: name, used: map[string]bool{}, melds: []meldJSON{}, flowers: []string{}}
}

func (b *builder) mark(ids []string) {
	for _, id := range ids {
		if b.used[id] {
			panic(fmt.Sprintf("case %s: duplicate tile %s", b.name, id))
		}
		b.used[id] = true
	}
}

func (b *builder) hand(ids ...string) *builder {
	b.mark(ids)
	b.handIDs = append(b.handIDs, ids...)
	return b
}

func (b *builder) meld(meldType string, ids []string, concealed, added, claimed bool) *builder {
	b.mark(ids)
	b.melds = append(b.melds, meldJSON{Type: meldType, Tiles: ids, Concealed: concealed, Added: added, Claimed: claimed})
	return b
}

func (b *builder) flower(name string) *builder {
	id := "flower-" + name
	b.mark([]string{id})
	b.flowers = append(b.flowers, id)
	return b
}

func (b *builder) build(ctx contextJSON, patterns map[string]int) caseJSON {
	handTiles := resolveTiles(b.handIDs)
	rulesMelds := make([]rules.Meld, 0, len(b.melds))
	for _, m := range b.melds {
		rulesMelds = append(rulesMelds, rules.Meld{
			Type:      rules.MeldType(m.Type),
			Tiles:     resolveTiles(m.Tiles),
			Concealed: m.Concealed,
			Added:     m.Added,
			Claimed:   m.Claimed,
		})
	}
	if !rules.CanWin(handTiles, rulesMelds) {
		panic(fmt.Sprintf("case %s: hand is not structurally a winning hand", b.name))
	}
	total := 0
	for _, tai := range patterns {
		total += tai
	}
	return caseJSON{
		Name:    b.name,
		Hand:    b.handIDs,
		Melds:   b.melds,
		Flowers: b.flowers,
		Context: ctx,
		Expect:  expectJSON{Winning: true, RawTai: total, Patterns: patterns},
	}
}

// --- reference pattern calculators (from spec §6.1/§6.2, independent of scoring.go) ---

func merge(maps ...map[string]int) map[string]int {
	out := map[string]int{}
	for _, m := range maps {
		for k, v := range m {
			out[k] += v
		}
	}
	return out
}

func baseWin() map[string]int { return map[string]int{"Base Win": 1} }

func concealedOrZimo(zimo, concealedHand bool) map[string]int {
	switch {
	case zimo && concealedHand:
		return map[string]int{"Concealed Zimo": 3}
	case zimo:
		return map[string]int{"Zimo": 1}
	case concealedHand:
		return map[string]int{"Concealed": 1}
	default:
		return map[string]int{}
	}
}

func seatCode(word string) string { return word[:1] }

func dragonSetName(color string) string {
	return strings.ToUpper(color[:1]) + color[1:] + " Dragon Set"
}

// dragonPatterns: pongColors are dragon colors with a Pong/Kong set;
// pairIsDragon marks whether the pair is a Dragon tile (any color).
func dragonPatterns(pongColors []string, pairIsDragon bool) map[string]int {
	out := map[string]int{}
	for _, c := range pongColors {
		out[dragonSetName(c)] = 1
	}
	switch len(pongColors) {
	case 3:
		out["Big Three Dragons"] = 8
	case 2:
		if pairIsDragon {
			out["Small Three Dragons"] = 4
		}
	}
	return out
}

// windPatterns: pongDirs are wind directions with a Pong/Kong set.
func windPatterns(pongDirs []string, seat, prevailing string, pairIsWind bool) map[string]int {
	out := map[string]int{}
	dirSet := map[string]bool{}
	for _, d := range pongDirs {
		dirSet[d] = true
	}
	if dirSet[seat] {
		out["Seat Wind Set"] = 1
	}
	if dirSet[prevailing] {
		out["Prevailing Wind Set"] = 1
	}
	switch len(pongDirs) {
	case 4:
		out["Big Four Winds"] = 16
	case 3:
		if pairIsWind {
			out["Small Four Winds"] = 8
		}
	}
	return out
}

func concealedProgress(count int) map[string]int {
	switch {
	case count >= 5:
		return map[string]int{"Five Concealed Pongs": 8}
	case count >= 4:
		return map[string]int{"Four Concealed Pongs": 5}
	case count >= 3:
		return map[string]int{"Three Concealed Pongs": 2}
	default:
		return map[string]int{}
	}
}

func kongTai(exposedAdded, concealed int) map[string]int {
	out := map[string]int{}
	if exposedAdded > 0 {
		out["Exposed/Added Kong"] = exposedAdded
	}
	if concealed > 0 {
		out["Concealed Kong"] = concealed * 2
	}
	return out
}

func allPongsPattern(fire bool) map[string]int {
	if fire {
		return map[string]int{"All Pongs": 4}
	}
	return map[string]int{}
}

func allChowsPattern(fire bool) map[string]int {
	if fire {
		return map[string]int{"All Chows": 2}
	}
	return map[string]int{}
}

func fullyExposedPattern(fire bool) map[string]int {
	if fire {
		return map[string]int{"Fully Exposed": 2}
	}
	return map[string]int{}
}

func singleWaitPattern(fire bool) map[string]int {
	if fire {
		return map[string]int{"Single Wait": 1}
	}
	return map[string]int{}
}

func suitPattern(numberedKindsCount int, honorsPresent bool) map[string]int {
	switch {
	case numberedKindsCount == 0 && honorsPresent:
		return map[string]int{"All Honors": 8}
	case numberedKindsCount == 1 && honorsPresent:
		return map[string]int{"Half Flush": 4}
	case numberedKindsCount == 1 && !honorsPresent:
		return map[string]int{"Full Flush": 8}
	default:
		return map[string]int{}
	}
}

func noHonorsPattern(allChows bool, flowersPresent, honorsPresent bool) map[string]int {
	if !allChows && !flowersPresent && !honorsPresent {
		return map[string]int{"No Honors or Flowers": 2}
	}
	return map[string]int{}
}

func flowerPatterns(seat string, owned []string) map[string]int {
	out := map[string]int{}
	matching := map[string][2]string{
		"East":  {"spring", "plum"},
		"South": {"summer", "orchid"},
		"West":  {"autumn", "chrysanthemum"},
		"North": {"winter", "bamboo"},
	}
	seasons := map[string]bool{"spring": true, "summer": true, "autumn": true, "winter": true}
	ownedSet := map[string]bool{}
	seasonCount, plantCount := 0, 0
	for _, n := range owned {
		ownedSet[n] = true
		if seasons[n] {
			seasonCount++
		} else {
			plantCount++
		}
	}
	for _, n := range matching[seat] {
		if ownedSet[n] {
			out["Matching Flower"] += 1
		}
	}
	if seasonCount == 4 {
		out["Complete Seasons"] = 2
	}
	if plantCount == 4 {
		out["Complete Flowers"] = 2
	}
	return out
}

func eventPatterns(ctx contextJSON, heavenly bool) map[string]int {
	out := map[string]int{}
	if heavenly {
		return out
	}
	if ctx.Replacement {
		out["Win After Replacement"] = 1
	}
	if ctx.LastTile {
		out["Last Tile Zimo"] = 1
	}
	if ctx.RobbedAddedKong {
		out["Robbing an Added Kong"] = 1
	}
	return out
}

// --- case generation ------------------------------------------------------

// windDirName maps the wind color/name used in tile IDs to the capitalized
// seat name ScoreContext.Seat and the wind-set helpers expect.
func cap1(s string) string { return strings.ToUpper(s[:1]) + s[1:] }

func generateCases() []caseJSON {
	var cases []caseJSON

	// --- Dragon Set: each color in isolation (concealed Zimo skeleton) ---
	for _, color := range []string{"red", "green", "white"} {
		c := newCase("dragon-set-" + color + "-isolated")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 7)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("dots", 1)...)
		c.hand(honorPong("dragon", color, 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true), dragonPatterns([]string{color}, false))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true}, patterns))
	}

	// --- Small Three Dragons: each 2-of-3 color combination ---
	colorTriples := [][3]string{{"red", "green", "white"}, {"red", "white", "green"}, {"green", "white", "red"}}
	for _, triple := range colorTriples {
		pongColors := []string{triple[0], triple[1]}
		pairColor := triple[2]
		c := newCase(fmt.Sprintf("small-three-dragons-%s-%s-pair-%s", pongColors[0], pongColors[1], pairColor))
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 7)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(honorPong("dragon", pongColors[0], 1)...)
		c.hand(honorPair("dragon", pairColor, 1)...)
		c.meld("pong", honorPong("dragon", pongColors[1], 1), true, false, false)
		patterns := merge(baseWin(), concealedOrZimo(true, true), dragonPatterns(pongColors, true))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true}, patterns))
	}

	// --- Big Three Dragons (also trips Three Concealed Pongs) ---
	{
		c := newCase("big-three-dragons")
		c.hand(chow("characters", 1)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(honorPong("dragon", "red", 1)...)
		c.hand(honorPong("dragon", "green", 1)...)
		c.hand(honorPong("dragon", "white", 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true),
			dragonPatterns([]string{"red", "green", "white"}, false), concealedProgress(3))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true}, patterns))
	}

	// --- Wind Set: seat-only, prevailing-only, both stacking ---
	{
		// Seat South, prevailing East (default): South Pong -> seat only.
		c := newCase("wind-set-seat-only")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 7)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("dots", 1)...)
		c.hand(honorPong("wind", "south", 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true), windPatterns([]string{"south"}, "south", "east", false))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true}, patterns))
	}
	{
		// Seat South, prevailing East: East Pong -> prevailing only.
		c := newCase("wind-set-prevailing-only")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 7)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("dots", 1)...)
		c.hand(honorPong("wind", "east", 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true), windPatterns([]string{"east"}, "south", "east", false))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true}, patterns))
	}
	{
		// Seat East, prevailing East: East Pong -> both stack.
		c := newCase("wind-set-seat-and-prevailing-stack")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 7)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("dots", 1)...)
		c.hand(honorPong("wind", "east", 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true), windPatterns([]string{"east"}, "east", "east", false))
		cases = append(cases, c.build(contextJSON{Seat: "E", Zimo: true}, patterns))
	}

	// --- Small Four Winds: pair rotates through all four directions ---
	allDirs := []string{"east", "south", "west", "north"}
	for _, pairDir := range allDirs {
		var pongDirs []string
		for _, d := range allDirs {
			if d != pairDir {
				pongDirs = append(pongDirs, d)
			}
		}
		c := newCase("small-four-winds-pair-" + pairDir)
		c.hand(chow("characters", 1)...)
		c.hand(chow("bamboo", 1)...)
		for i, d := range pongDirs {
			if i == 0 {
				c.hand(honorPong("wind", d, 1)...)
			} else {
				c.meld("pong", honorPong("wind", d, 1), true, false, false)
			}
		}
		c.hand(honorPair("wind", pairDir, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true),
			windPatterns(pongDirs, "south", "east", true), concealedProgress(3))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true}, patterns))
	}

	// --- Big Four Winds ---
	{
		c := newCase("big-four-winds")
		c.hand(chow("characters", 1)...)
		c.hand(honorPong("wind", "east", 1)...)
		c.hand(honorPong("wind", "south", 1)...)
		c.hand(honorPong("wind", "west", 1)...)
		c.hand(honorPong("wind", "north", 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true),
			windPatterns([]string{"east", "south", "west", "north"}, "east", "east", false),
			concealedProgress(4))
		cases = append(cases, c.build(contextJSON{Seat: "E", Zimo: true}, patterns))
	}

	// --- Suit patterns: Half Flush x3, Full Flush x3, All Honors x1 ---
	for _, kind := range []string{"characters", "bamboo", "dots"} {
		c := newCase("half-flush-" + kind)
		c.hand(chow(kind, 1)...)
		c.hand(chow(kind, 4)...)
		c.hand(chow(kind, 7)...)
		c.hand(honorPong("dragon", "red", 1)...)
		c.hand(honorPong("dragon", "green", 1)...)
		c.hand(honorPair("wind", "east", 1)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true),
			dragonPatterns([]string{"red", "green"}, false), suitPattern(1, true))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true}, patterns))
	}
	for _, kind := range []string{"characters", "bamboo", "dots"} {
		c := newCase("full-flush-" + kind)
		c.hand(chow(kind, 1)...)
		c.hand(chow(kind, 4)...)
		c.hand(chow(kind, 7)...)
		c.hand(pongNum(kind, 2, 2)...)
		c.hand(pongNum(kind, 8, 2)...)
		c.hand(pairNum(kind, 5, 2)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true), suitPattern(1, false),
			noHonorsPattern(false, false, false))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true}, patterns))
	}
	{
		c := newCase("all-honors")
		c.hand(honorPong("wind", "east", 1)...)
		c.hand(honorPong("wind", "south", 1)...)
		c.hand(honorPong("wind", "west", 1)...)
		c.hand(honorPong("dragon", "red", 1)...)
		c.hand(honorPong("dragon", "green", 1)...)
		c.hand(honorPair("dragon", "white", 1)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true),
			dragonPatterns([]string{"red", "green"}, true),
			windPatterns([]string{"east", "south", "west"}, "east", "east", false),
			concealedProgress(5), allPongsPattern(true), suitPattern(0, true))
		cases = append(cases, c.build(contextJSON{Seat: "E", Zimo: true}, patterns))
	}

	// --- All Pongs isolated (mixed suits, no honors, no flush trigger) ---
	{
		c := newCase("all-pongs-mixed-suits")
		c.hand(pongNum("characters", 2, 1)...)
		c.hand(pongNum("bamboo", 3, 1)...)
		c.hand(pongNum("dots", 4, 1)...)
		c.hand(pongNum("characters", 6, 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		c.meld("pong", pongNum("bamboo", 5, 1), false, false, true)
		patterns := merge(baseWin(), concealedOrZimo(true, false), allPongsPattern(true), concealedProgress(4),
			noHonorsPattern(false, false, false))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true}, patterns))
	}

	// --- Concealed-pong progression: below-threshold negative, 3, 4, 5 ---
	{
		c := newCase("concealed-pongs-below-threshold")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 4)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(pongNum("dots", 2, 1)...)
		c.hand(pongNum("dots", 5, 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true), concealedProgress(2), noHonorsPattern(false, false, false))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true}, patterns))
	}

	// --- Kong Tai progression (exposed/added vs concealed counts) ---
	kongCombos := []struct {
		name           string
		exposed        int
		concealed      int
		exposedRanks   []int
		concealedRanks []int
		exposedKind    string
		concealedKind  string
	}{
		{"one-exposed-kong-only", 1, 0, []int{2}, nil, "characters", ""},
		{"one-concealed-kong-only", 0, 1, nil, []int{2}, "", "characters"},
	}
	for _, combo := range kongCombos {
		c := newCase("kong-tai-" + combo.name)
		c.hand(chow("characters", 6)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("bamboo", 5)...)
		c.hand(chow("dots", 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		if combo.exposed == 1 {
			c.meld("kong", kongNum(combo.exposedKind, combo.exposedRanks[0]), false, false, true)
		}
		if combo.concealed == 1 {
			c.meld("kong", kongNum(combo.concealedKind, combo.concealedRanks[0]), true, false, false)
		}
		concealedHand := combo.exposed == 0
		patterns := merge(baseWin(), concealedOrZimo(true, concealedHand), kongTai(combo.exposed, combo.concealed),
			noHonorsPattern(false, false, false))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true}, patterns))
	}
	{
		// Two exposed/added + one concealed Kong, stacked with All Pongs.
		c := newCase("kong-tai-two-exposed-one-concealed-all-pongs")
		c.hand(pairNum("dots", 9, 1)...)
		c.meld("kong", kongNum("characters", 2), false, false, true)
		c.meld("kong", kongNum("bamboo", 3), false, true, false)
		c.meld("kong", kongNum("dots", 4), true, false, false)
		c.meld("pong", pongNum("characters", 6, 1), false, false, true)
		c.meld("pong", pongNum("bamboo", 7, 1), false, false, true)
		patterns := merge(baseWin(), concealedOrZimo(true, false), kongTai(2, 1), allPongsPattern(true),
			noHonorsPattern(false, false, false))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true}, patterns))
	}

	// --- Flower patterns: matching per seat, complete seasons, complete flowers ---
	seatFlowers := map[string][2]string{
		"East": {"spring", "plum"}, "South": {"summer", "orchid"},
		"West": {"autumn", "chrysanthemum"}, "North": {"winter", "bamboo"},
	}
	for seat, flowers := range seatFlowers {
		c := newCase("matching-flowers-" + strings.ToLower(seat))
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 4)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("bamboo", 4)...)
		c.hand(chow("dots", 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		c.flower(flowers[0])
		c.flower(flowers[1])
		patterns := merge(baseWin(), concealedOrZimo(true, true), flowerPatterns(seat, []string{flowers[0], flowers[1]}))
		cases = append(cases, c.build(contextJSON{Seat: seatCode(seat), Zimo: true}, patterns))
	}
	{
		c := newCase("complete-seasons")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 4)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("bamboo", 4)...)
		c.hand(chow("dots", 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		for _, name := range []string{"spring", "summer", "autumn", "winter"} {
			c.flower(name)
		}
		patterns := merge(baseWin(), concealedOrZimo(true, true), flowerPatterns("North", []string{"spring", "summer", "autumn", "winter"}))
		cases = append(cases, c.build(contextJSON{Seat: "N", Zimo: true}, patterns))
	}
	{
		c := newCase("complete-flowers")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 4)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("bamboo", 4)...)
		c.hand(chow("dots", 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		for _, name := range []string{"plum", "orchid", "chrysanthemum", "bamboo"} {
			c.flower(name)
		}
		patterns := merge(baseWin(), concealedOrZimo(true, true), flowerPatterns("West", []string{"plum", "orchid", "chrysanthemum", "bamboo"}))
		cases = append(cases, c.build(contextJSON{Seat: "W", Zimo: true}, patterns))
	}

	// --- Single Wait: positive and explicit negative (flag off) ---
	{
		c := newCase("single-wait-flag-set")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 4)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("dots", 1)...)
		c.hand(chow("dots", 4)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(false, true), singleWaitPattern(true), noHonorsPattern(false, false, false))
		cases = append(cases, c.build(contextJSON{Seat: "S", DiscardWin: true, SingleWait: true}, patterns))
	}
	{
		c := newCase("single-wait-flag-unset")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 4)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("dots", 1)...)
		c.hand(chow("dots", 4)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(false, true), allChowsPattern(true))
		cases = append(cases, c.build(contextJSON{Seat: "S", DiscardWin: true, SingleWait: false}, patterns))
	}

	// --- Fully Exposed: negative (4 open + 1 concealed meld) ---
	{
		c := newCase("fully-exposed-negative-one-concealed-meld")
		c.hand(pongNum("dots", 5, 1)...)
		c.hand(pairNum("characters", 9, 1)...)
		c.meld("pong", pongNum("bamboo", 1, 1), false, false, true)
		c.meld("pong", pongNum("bamboo", 2, 1), false, false, true)
		c.meld("pong", pongNum("bamboo", 3, 1), false, false, true)
		c.meld("pong", pongNum("dots", 1, 1), false, false, true)
		patterns := merge(baseWin(), fullyExposedPattern(false), singleWaitPattern(true), allPongsPattern(true),
			noHonorsPattern(false, false, false))
		cases = append(cases, c.build(contextJSON{Seat: "W", DiscardWin: true, SingleWait: true}, patterns))
	}

	// --- All Chows: negative via Zimo (requires DiscardWin, not just non-Zimo) ---
	{
		c := newCase("all-chows-negative-zimo-not-discard-win")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 4)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("bamboo", 4)...)
		c.hand(chow("dots", 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true), allChowsPattern(false),
			noHonorsPattern(false, false, false))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true}, patterns))
	}
	{
		c := newCase("all-chows-negative-single-wait")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 4)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("bamboo", 4)...)
		c.hand(chow("dots", 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(false, true), allChowsPattern(false),
			singleWaitPattern(true), noHonorsPattern(false, false, false))
		cases = append(cases, c.build(contextJSON{Seat: "S", DiscardWin: true, SingleWait: true}, patterns))
	}
	{
		// Non-matching flower present: All Chows AND No Honors or Flowers both
		// excluded by the flower alone (Matching Flower does not fire either,
		// since South's flowers are summer/orchid, not plum).
		c := newCase("all-chows-negative-flower-present")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 4)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("bamboo", 4)...)
		c.hand(chow("dots", 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		c.flower("plum")
		patterns := merge(baseWin(), concealedOrZimo(false, true), allChowsPattern(false),
			noHonorsPattern(false, true, false), flowerPatterns("South", []string{"plum"}))
		cases = append(cases, c.build(contextJSON{Seat: "S", DiscardWin: true}, patterns))
	}

	// --- Heavenly Hand: excludes Zimo/SingleWait/WinAfterReplacement even if flagged ---
	{
		c := newCase("heavenly-hand-excludes-zimo-and-single-wait-flags")
		c.hand(pongNum("characters", 1, 1)...)
		c.hand(pongNum("characters", 2, 1)...)
		c.hand(pongNum("characters", 3, 1)...)
		c.hand(pongNum("bamboo", 1, 1)...)
		c.hand(chow("dots", 1)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), map[string]int{"Heavenly Hand": 24}, concealedOrZimo(false, true),
			concealedProgress(4), noHonorsPattern(false, false, false))
		cases = append(cases, c.build(contextJSON{Seat: "E", HeavenlyHand: true, Zimo: true,
			SingleWait: true, Replacement: true}, patterns))
	}

	// --- Earthly Hand stacks normally with Zimo (unlike Heavenly) ---
	{
		c := newCase("earthly-hand-stacks-with-zimo")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 4)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("dots", 1)...)
		c.hand(chow("dots", 4)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), map[string]int{"Earthly Hand": 16}, concealedOrZimo(true, true), noHonorsPattern(false, false, false))
		cases = append(cases, c.build(contextJSON{Seat: "S", EarthlyHand: true, Zimo: true}, patterns))
	}

	// --- Win After Replacement isolated (no Last Tile) ---
	{
		c := newCase("win-after-replacement-isolated")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 4)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("dots", 1)...)
		c.hand(chow("dots", 4)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true), eventPatterns(contextJSON{Replacement: true}, false),
			noHonorsPattern(false, false, false))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true, Replacement: true}, patterns))
	}

	// --- Last Tile Zimo isolated (front draw, not a replacement) ---
	{
		c := newCase("last-tile-zimo-isolated")
		c.hand(chow("characters", 1)...)
		c.hand(chow("characters", 4)...)
		c.hand(chow("bamboo", 1)...)
		c.hand(chow("dots", 1)...)
		c.hand(chow("dots", 4)...)
		c.hand(pairNum("dots", 9, 1)...)
		patterns := merge(baseWin(), concealedOrZimo(true, true), eventPatterns(contextJSON{LastTile: true}, false),
			noHonorsPattern(false, false, false))
		cases = append(cases, c.build(contextJSON{Seat: "S", Zimo: true, LastTile: true}, patterns))
	}

	sort.Slice(cases, func(i, j int) bool { return cases[i].Name < cases[j].Name })
	return cases
}

func main() {
	generated := generateCases()

	existingPath := "rulesengine/testdata/goldens/scoring.json"
	var existing fileJSON
	raw, err := os.ReadFile(existingPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "read existing goldens:", err)
		os.Exit(1)
	}
	if err := json.Unmarshal(raw, &existing); err != nil {
		fmt.Fprintln(os.Stderr, "parse existing goldens:", err)
		os.Exit(1)
	}

	seen := map[string]bool{}
	final := make([]caseJSON, 0, len(existing.Cases)+len(generated))
	for _, c := range existing.Cases {
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

	out := fileJSON{
		Version: existing.Version,
		Rules:   existing.Rules,
		Notes:   existing.Notes,
		Cases:   final,
	}
	encoded, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "encode goldens:", err)
		os.Exit(1)
	}
	if err := os.WriteFile(existingPath, append(encoded, '\n'), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "write goldens:", err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "wrote %d cases (%d existing + %d generated) to %s\n",
		len(final), len(existing.Cases), len(generated), existingPath)
}
