package bots

import (
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gameswithout/mahjong/rulesengine"
)

func TestPersonasLoadsTheWholeRoster(t *testing.T) {
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	want := []string{
		"jade-dragon", "river-scholar", "silent-crane",
		"stone-lion", "swift-sparrow", "thunder-tiger",
	}
	got := roster.IDs()
	if len(got) != len(want) {
		t.Fatalf("Personas() loaded %v, want %v", got, want)
	}
	for index, id := range want {
		if got[index] != id {
			t.Fatalf("Personas() loaded %v, want %v", got, want)
		}
	}
}

// TestEveryPersonaIsFullyAuthored is the guard the loader's validation
// exists for: a persona whose prose or weights are missing would otherwise
// reach a player as a nameless bot with silently-zeroed preferences.
func TestEveryPersonaIsFullyAuthored(t *testing.T) {
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	for _, id := range roster.IDs() {
		persona, ok := roster.ByID(id)
		if !ok {
			t.Fatalf("ByID(%q) = false right after IDs() listed it", id)
		}
		if persona.Name == "" || persona.Tag == "" || persona.Tagline == "" || persona.Glyph == "" {
			t.Errorf("persona %q display fields = %+v, want all populated", id, persona)
		}
		if !strings.Contains(persona.Personality, " ") {
			t.Errorf("persona %q personality = %q, want a sentence", id, persona.Personality)
		}
		if persona.Strength == "" || persona.Weakness == "" {
			t.Errorf("persona %q must document both a strength and a weakness", id)
		}
	}
}

// TestRiverScholarIsTheNeutralBaseline pins the one thing the whole
// comparison rests on: every specialist's §6 tuning hypothesis is stated
// relative to River Scholar, so River Scholar itself must stay unweighted.
func TestRiverScholarIsTheNeutralBaseline(t *testing.T) {
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	scholar := roster.Default()
	if scholar.ID != DefaultPersonaID {
		t.Fatalf("Default() = %q, want %q", scholar.ID, DefaultPersonaID)
	}
	profile := scholar.Profile
	for name, weight := range map[string]float64{
		"completion_weight":   profile.CompletionWeight,
		"acceptance_weight":   profile.AcceptanceWeight,
		"tai_weight":          profile.TaiWeight,
		"risk_weight":         profile.RiskWeight,
		"concealment_value":   profile.ConcealmentValue,
		"safe_reserve_value":  profile.SafeReserveValue,
		"context_sensitivity": profile.ContextSensitivity,
	} {
		if weight != 1 {
			t.Errorf("river-scholar %s = %v, want 1", name, weight)
		}
	}
	for name, bias := range map[string]float64{
		"claim_bias": profile.ClaimBias,
		"chow_bias":  profile.ChowBias,
		"pong_bias":  profile.PongBias,
		"kong_bias":  profile.KongBias,
	} {
		if bias != 0 {
			t.Errorf("river-scholar %s = %v, want 0", name, bias)
		}
	}
}

// TestPersonasDisagreeWithEachOther checks the roster actually spans the §2.2
// axes rather than shipping six differently-named copies of the baseline.
func TestPersonasDisagreeWithEachOther(t *testing.T) {
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	sparrow, _ := roster.ByID("swift-sparrow")
	lion, _ := roster.ByID("stone-lion")
	dragon, _ := roster.ByID("jade-dragon")
	tiger, _ := roster.ByID("thunder-tiger")
	crane, _ := roster.ByID("silent-crane")

	if sparrow.Profile.ClaimBias <= lion.Profile.ClaimBias {
		t.Error("Swift Sparrow must be more willing to open its hand than Stone Lion")
	}
	if lion.Profile.RiskWeight <= sparrow.Profile.RiskWeight {
		t.Error("Stone Lion must fear dealing in more than Swift Sparrow")
	}
	if dragon.Profile.TaiWeight <= sparrow.Profile.TaiWeight {
		t.Error("Jade Dragon must value hand size more than Swift Sparrow")
	}
	if dragon.Profile.Commitment >= sparrow.Profile.Commitment {
		t.Error("Jade Dragon must adopt a pattern on less evidence than Swift Sparrow")
	}
	if tiger.Profile.PongBias <= tiger.Profile.ChowBias {
		t.Error("Thunder Tiger must prefer Pongs to Chows")
	}
	if crane.Profile.ConcealmentValue <= tiger.Profile.ConcealmentValue {
		t.Error("Silent Crane must value staying concealed more than Thunder Tiger")
	}
}

// TestMixedTableIsTheRecommendedContrast covers the §5 default lineup: one
// opponent races, one protects, one builds value.
func TestMixedTableIsTheRecommendedContrast(t *testing.T) {
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	table := roster.MixedTable()
	if len(table) != 3 {
		t.Fatalf("MixedTable() returned %d personas, want 3", len(table))
	}
	tags := make([]string, 0, 3)
	for _, persona := range table {
		if persona.ID == "" {
			t.Fatal("MixedTable() returned an unloaded persona")
		}
		tags = append(tags, persona.Tag)
	}
	want := []string{"Rush", "Guard", "Big Hand"}
	for index, tag := range want {
		if tags[index] != tag {
			t.Fatalf("MixedTable() tags = %v, want %v", tags, want)
		}
	}
}

// TestPersonaAssignmentsSeatTheMixedTableInOrder covers the §5 lineup as it
// actually reaches a table: three bots alongside one human get the racer,
// the guard, and the value hand, in table order.
func TestPersonaAssignmentsSeatTheMixedTableInOrder(t *testing.T) {
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	// Deliberately out of table order — the assignment must not depend on
	// the order the caller happened to collect the seats in.
	assignments := roster.PersonaAssignments([]rulesengine.Seat{
		rulesengine.North, rulesengine.South, rulesengine.West,
	})
	want := map[rulesengine.Seat]string{
		rulesengine.South: "swift-sparrow",
		rulesengine.West:  "stone-lion",
		rulesengine.North: "jade-dragon",
	}
	for seat, id := range want {
		if assignments[seat].ID != id {
			t.Errorf("%s = %q, want %q", seat, assignments[seat].ID, id)
		}
	}
	if _, seated := assignments[rulesengine.East]; seated {
		t.Error("East is a human seat but was assigned a persona")
	}
}

// TestPersonaAssignmentsAreStable is what lets the personas stay unstored:
// a replay re-derives them from the seating rather than reading them back.
func TestPersonaAssignmentsAreStable(t *testing.T) {
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	seats := []rulesengine.Seat{rulesengine.South, rulesengine.West, rulesengine.North}
	first := roster.PersonaAssignments(seats)
	second := roster.PersonaAssignments(seats)
	for seat, persona := range first {
		if second[seat].ID != persona.ID {
			t.Fatalf("%s resolved to %q then %q", seat, persona.ID, second[seat].ID)
		}
	}
}

// TestPersonaAssignmentsHandleFewerBotSeats covers a table that filled with
// two or three humans before the padding ran.
func TestPersonaAssignmentsHandleFewerBotSeats(t *testing.T) {
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	single := roster.PersonaAssignments([]rulesengine.Seat{rulesengine.North})
	if len(single) != 1 {
		t.Fatalf("one bot seat produced %d assignments, want 1", len(single))
	}
	if single[rulesengine.North].ID != "swift-sparrow" {
		t.Errorf("the only bot seat got %q, want the first of the mixed lineup", single[rulesengine.North].ID)
	}
	if len(roster.PersonaAssignments(nil)) != 0 {
		t.Error("a table with no bot seats produced assignments")
	}
}

func TestByIDRejectsAnUnknownPersona(t *testing.T) {
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	if _, ok := roster.ByID("gambit-gus"); ok {
		t.Fatal("ByID(unknown) = true, want false so a typo surfaces instead of silently defaulting")
	}
}

// TestLoaderRejectsMalformedData exercises the failure modes the embedded
// roster is not allowed to have: a typo'd weight key, an out-of-range
// weight, and a bar outside 1-5.
func TestLoaderRejectsMalformedData(t *testing.T) {
	const markdown = `# Test
- **Name:** Test
- **Tag:** Test
- **Tagline:** "Test."
- **Glyph:** X

## Personality
A test persona.

## Strength
Being a test.

## Weakness
Being only a test.
`
	valid := `{
  "name": "Test",
  "completion_weight": 1.0, "acceptance_weight": 1.0, "tai_weight": 1.0,
  "risk_weight": 1.0, "claim_bias": 0.0, "chow_bias": 0.0, "pong_bias": 0.0,
  "kong_bias": 0.0, "concealment_value": 1.0, "commitment": 0.5,
  "safe_reserve_value": 1.0, "context_sensitivity": 1.0,
  "bars": { "pace": 3, "value": 3, "caution": 3, "calling": 3, "concealment": 3 }
}`

	cases := map[string]string{
		"typo'd weight key":    strings.Replace(valid, `"tai_weight"`, `"tia_weight"`, 1),
		"weight out of range":  strings.Replace(valid, `"risk_weight": 1.0`, `"risk_weight": 40.0`, 1),
		"bias out of range":    strings.Replace(valid, `"claim_bias": 0.0`, `"claim_bias": -9.0`, 1),
		"bar out of range":     strings.Replace(valid, `"pace": 3`, `"pace": 9`, 1),
		"unknown pattern":      strings.Replace(valid, `"bars"`, `"pattern_preference": ["thirteen_orphans"], "bars"`, 1),
		"commitment above one": strings.Replace(valid, `"commitment": 0.5`, `"commitment": 1.5`, 1),
	}
	for name, style := range cases {
		t.Run(name, func(t *testing.T) {
			files := fstest.MapFS{
				"personas/test/persona.md": {Data: []byte(markdown)},
				"personas/test/style.json": {Data: []byte(style)},
			}
			if _, err := loadPersonas(files, "personas"); err == nil {
				t.Fatal("loadPersonas() error = nil, want a rejection")
			}
		})
	}

	// The same fixture without the defect still fails, but only because the
	// default persona is absent — proving the cases above fail on their own
	// defect and not on the fixture being incomplete.
	files := fstest.MapFS{
		"personas/test/persona.md": {Data: []byte(markdown)},
		"personas/test/style.json": {Data: []byte(valid)},
	}
	_, err := loadPersonas(files, "personas")
	if err == nil || !strings.Contains(err.Error(), DefaultPersonaID) {
		t.Fatalf("loadPersonas(valid fixture) error = %v, want a missing-default-persona error", err)
	}
}

func TestParsePersonaMarkdownReadsBulletsAndProse(t *testing.T) {
	name, tagline, glyph, tag, personality, strength, weakness := parsePersonaMarkdown(`# Stone Lion

> Editable.

## Identity
- **Name:** Stone Lion
- **Tag:** Guard
- **Tagline:** "Protects its hand."
- **Glyph:** 獅

## Personality
Steady and protective.
Not fearful.

## Strength
The lowest deal-in rate.

## Weakness
Can be outpaced.
`)
	for field, pair := range map[string][2]string{
		"name":        {name, "Stone Lion"},
		"tag":         {tag, "Guard"},
		"tagline":     {tagline, "Protects its hand."},
		"glyph":       {glyph, "獅"},
		"personality": {personality, "Steady and protective. Not fearful."},
		"strength":    {strength, "The lowest deal-in rate."},
		"weakness":    {weakness, "Can be outpaced."},
	} {
		if pair[0] != pair[1] {
			t.Errorf("%s = %q, want %q", field, pair[0], pair[1])
		}
	}
}
