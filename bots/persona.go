package bots

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"
	"sync"

	"github.com/gameswithout/mahjong/rulesengine"
)

// A persona is a playing style: what plan a bot prefers and what risks it
// accepts (docs/bot-playing-style-personas.md). It is deliberately separate
// from difficulty, which answers how accurately the bot executes whatever
// plan it has. A Hard Swift Sparrow is a highly competent rush player; it
// does not quietly turn into River Scholar whenever optimal play conflicts
// with the style.
//
// Each persona lives in personas/<id>/ as two hand-authored files, the same
// split the chess project's Gambit Gus and Fortress Fiona use:
//
//	persona.md  — prose identity, parsed only for display fields
//	style.json  — the bounded numeric weights that bias action selection
//
// Adding a persona is therefore a data change, not a code change. The files
// are embedded rather than read from disk because §11.4 requires a decision
// to replay exactly from (rules version, AI version, difficulty, persona,
// observation, seed): the weights have to travel with the AI version, not
// with whatever happens to be on the deployed container's filesystem.

//go:embed personas
var personaFiles embed.FS

// PersonaVersion is recorded on every Decision alongside the persona ID, so
// a replay can tell a retuned Swift Sparrow from the one that actually
// played the hand. Bump it whenever any personas/*/style.json changes.
const PersonaVersion = "v1.1.0"

// DefaultPersonaID is what an unqualified request resolves to. It is only
// the default, not a privileged persona the others hang off: River Scholar
// is the neutral reference the specialists are measured against (§6.1).
const DefaultPersonaID = "river-scholar"

// PersonaProfile is the §4 style model: utility preferences, never legality
// overrides. Every action is still generated from the same legal action set,
// and every legal Win is still declared regardless of persona.
//
// The weight fields scale terms of the action score; the bias fields are
// additive nudges and may be negative, which is how a persona expresses
// dislike of a claim shape rather than mere indifference to it.
type PersonaProfile struct {
	// CompletionWeight prefers reducing distance to a legal 17-tile hand.
	CompletionWeight float64 `json:"completion_weight"`
	// AcceptanceWeight prefers keeping more still-live improving tiles.
	AcceptanceWeight float64 `json:"acceptance_weight"`
	// TaiWeight prefers expected raw Tai conditional on winning.
	TaiWeight float64 `json:"tai_weight"`
	// RiskWeight penalizes estimated deal-in probability and Tai paid.
	RiskWeight float64 `json:"risk_weight"`
	// ClaimBias is general willingness to open the hand.
	ClaimBias float64 `json:"claim_bias"`
	// ChowBias, PongBias, and KongBias are per-shape preferences on top of
	// ClaimBias — what separates Thunder Tiger from Swift Sparrow, who both
	// claim often but not the same things.
	ChowBias float64 `json:"chow_bias"`
	PongBias float64 `json:"pong_bias"`
	KongBias float64 `json:"kong_bias"`
	// ConcealmentValue is the value of remaining concealed and flexible.
	ConcealmentValue float64 `json:"concealment_value"`
	// Commitment is how much of the hand must already point at a high-Tai
	// pattern before the persona adopts it, as a share in [0, 1]. A high
	// value means the persona effectively never commits.
	Commitment float64 `json:"commitment"`
	// SafeReserveValue is the value of retaining a lower-risk exit tile.
	SafeReserveValue float64 `json:"safe_reserve_value"`
	// ContextSensitivity scales the dealer, continuation, wall, and threat
	// modifiers.
	ContextSensitivity float64 `json:"context_sensitivity"`
	// PatternPreference orders the high-Tai families this persona would
	// rather pursue when several are equally reachable. Empty means the
	// roster default order.
	PatternPreference []patternTarget `json:"pattern_preference,omitempty"`
}

// PersonaBars are the five §5 display ratings, 1-5. They describe intended
// decision preferences for the player-facing card — not guaranteed outcomes,
// and not difficulty.
type PersonaBars struct {
	Pace        int `json:"pace"`
	Value       int `json:"value"`
	Caution     int `json:"caution"`
	Calling     int `json:"calling"`
	Concealment int `json:"concealment"`
}

// Persona is one loaded personality: the display identity from persona.md
// and the decision weights from style.json.
type Persona struct {
	ID string
	// Name is the working fantasy name; Tag is the plain-language style
	// label. §8 is explicit that the tag matters more than the name — a
	// player should read "Rush" and know what to expect.
	Name    string
	Tag     string
	Tagline string
	Glyph   string
	// Personality, Strength, and Weakness are the persona card's prose.
	Personality string
	Strength    string
	Weakness    string
	Bars        PersonaBars
	Profile     PersonaProfile
}

// Roster is the set of hosted personalities.
type Roster struct {
	byID map[string]Persona
	ids  []string
}

// IDs lists every persona ID in stable order.
func (r Roster) IDs() []string { return append([]string(nil), r.ids...) }

// ByID resolves a persona. An unknown ID is reported as unknown rather than
// silently defaulted, so a typo surfaces instead of quietly seating the
// wrong opponent.
func (r Roster) ByID(id string) (Persona, bool) {
	persona, ok := r.byID[strings.TrimSpace(id)]
	return persona, ok
}

// Default is the neutral reference persona.
func (r Roster) Default() Persona { return r.byID[DefaultPersonaID] }

// mixedTableIDs is the §5 recommended default lineup for a table of three
// bots: one opponent races, one protects, and one builds value. That is the
// clearest first-session contrast a player can read off three seats.
var mixedTableIDs = []string{"swift-sparrow", "stone-lion", "jade-dragon"}

// MixedTable returns the recommended default lineup, in seat order.
func (r Roster) MixedTable() []Persona {
	table := make([]Persona, 0, len(mixedTableIDs))
	for _, id := range mixedTableIDs {
		table = append(table, r.byID[id])
	}
	return table
}

// PersonaAssignments seats the recommended mixed lineup across a match's
// bot seats, in table order, so an AI Practice table faces one opponent
// that races, one that protects, and one that builds value.
//
// The assignment is a pure function of which seats are bots, which is
// already persisted in the match record. Nothing extra is stored and no
// snapshot schema changes: replaying a match re-derives exactly the same
// personas that played it. Choosing a persona per seat is a later feature
// and will need real persistence, because a player's choice is not
// recoverable from the seating.
func (r Roster) PersonaAssignments(botSeats []rulesengine.Seat) map[rulesengine.Seat]Persona {
	table := r.MixedTable()
	assignments := make(map[rulesengine.Seat]Persona, len(botSeats))
	seated := map[rulesengine.Seat]bool{}
	for _, seat := range botSeats {
		seated[seat] = true
	}
	ordinal := 0
	for _, seat := range seatOrder {
		if !seated[seat] {
			continue
		}
		assignments[seat] = table[ordinal%len(table)]
		ordinal++
	}
	return assignments
}

var (
	personaRosterOnce sync.Once
	personaRoster     Roster
	personaRosterErr  error
)

// Personas returns the embedded roster, parsed and validated once. An error
// here means the shipped persona data is malformed, which the loader test
// catches long before a build reaches a player.
func Personas() (Roster, error) {
	personaRosterOnce.Do(func() {
		personaRoster, personaRosterErr = loadPersonas(personaFiles, "personas")
	})
	return personaRoster, personaRosterErr
}

func loadPersonas(files fs.FS, root string) (Roster, error) {
	entries, err := fs.ReadDir(files, root)
	if err != nil {
		return Roster{}, fmt.Errorf("bots: read persona root: %w", err)
	}
	roster := Roster{byID: map[string]Persona{}}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		persona, err := loadPersona(files, path.Join(root, entry.Name()), entry.Name())
		if err != nil {
			return Roster{}, err
		}
		roster.byID[persona.ID] = persona
		roster.ids = append(roster.ids, persona.ID)
	}
	sort.Strings(roster.ids)
	if _, ok := roster.byID[DefaultPersonaID]; !ok {
		return Roster{}, fmt.Errorf("bots: default persona %q is missing from the roster", DefaultPersonaID)
	}
	for _, id := range mixedTableIDs {
		if _, ok := roster.byID[id]; !ok {
			return Roster{}, fmt.Errorf("bots: mixed-table persona %q is missing from the roster", id)
		}
	}
	return roster, nil
}

func loadPersona(files fs.FS, dir, id string) (Persona, error) {
	markdown, err := fs.ReadFile(files, path.Join(dir, "persona.md"))
	if err != nil {
		return Persona{}, fmt.Errorf("bots: persona %q: %w", id, err)
	}
	styleJSON, err := fs.ReadFile(files, path.Join(dir, "style.json"))
	if err != nil {
		return Persona{}, fmt.Errorf("bots: persona %q: %w", id, err)
	}

	var style personaStyle
	decoder := json.NewDecoder(bytes.NewReader(styleJSON))
	// A typo'd weight key would otherwise load as a silent zero and change
	// how the persona plays without anything failing.
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&style); err != nil {
		return Persona{}, fmt.Errorf("bots: persona %q style.json: %w", id, err)
	}

	persona := Persona{ID: id, Bars: style.Bars, Profile: style.PersonaProfile}
	persona.Name, persona.Tagline, persona.Glyph, persona.Tag,
		persona.Personality, persona.Strength, persona.Weakness = parsePersonaMarkdown(string(markdown))
	if style.Name != "" {
		persona.Name = style.Name
	}
	if err := persona.validate(); err != nil {
		return Persona{}, err
	}
	return persona, nil
}

// personaStyle is style.json's shape. Embedding PersonaProfile keeps the
// file flat — the weights sit alongside name and bars rather than nested
// under a key, matching the chess project's style.json.
type personaStyle struct {
	Comment string `json:"_comment,omitempty"`
	Name    string `json:"name"`
	PersonaProfile
	Bars PersonaBars `json:"bars"`
}

func (p Persona) validate() error {
	for field, value := range map[string]string{
		"name": p.Name, "tag": p.Tag, "tagline": p.Tagline,
		"glyph": p.Glyph, "personality": p.Personality,
		"strength": p.Strength, "weakness": p.Weakness,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("bots: persona %q has no %s", p.ID, field)
		}
	}
	for field, value := range map[string]float64{
		"completion_weight":   p.Profile.CompletionWeight,
		"acceptance_weight":   p.Profile.AcceptanceWeight,
		"tai_weight":          p.Profile.TaiWeight,
		"risk_weight":         p.Profile.RiskWeight,
		"concealment_value":   p.Profile.ConcealmentValue,
		"safe_reserve_value":  p.Profile.SafeReserveValue,
		"context_sensitivity": p.Profile.ContextSensitivity,
	} {
		if value < 0 || value > maxPersonaWeight {
			return fmt.Errorf("bots: persona %q %s = %v, want [0, %v]", p.ID, field, value, maxPersonaWeight)
		}
	}
	for field, value := range map[string]float64{
		"claim_bias": p.Profile.ClaimBias,
		"chow_bias":  p.Profile.ChowBias,
		"pong_bias":  p.Profile.PongBias,
		"kong_bias":  p.Profile.KongBias,
	} {
		if value < -maxPersonaBias || value > maxPersonaBias {
			return fmt.Errorf("bots: persona %q %s = %v, want [%v, %v]", p.ID, field, value, -maxPersonaBias, maxPersonaBias)
		}
	}
	if p.Profile.Commitment < 0 || p.Profile.Commitment > 1 {
		return fmt.Errorf("bots: persona %q commitment = %v, want [0, 1]", p.ID, p.Profile.Commitment)
	}
	for _, target := range p.Profile.PatternPreference {
		if !knownPattern(target) {
			return fmt.Errorf("bots: persona %q prefers unknown pattern %q", p.ID, target)
		}
	}
	for field, value := range map[string]int{
		"pace": p.Bars.Pace, "value": p.Bars.Value, "caution": p.Bars.Caution,
		"calling": p.Bars.Calling, "concealment": p.Bars.Concealment,
	} {
		if value < 1 || value > 5 {
			return fmt.Errorf("bots: persona %q bar %s = %d, want 1-5", p.ID, field, value)
		}
	}
	return nil
}

const (
	// maxPersonaWeight and maxPersonaBias bound the authored weights. They
	// exist so a slipped decimal point fails the loader instead of shipping
	// a persona that ignores every other term in its own score.
	maxPersonaWeight = 4.0
	maxPersonaBias   = 2.0
)

func knownPattern(target patternTarget) bool {
	for _, candidate := range pursuablePatterns {
		if candidate == target {
			return true
		}
	}
	return false
}

// patternOrder is the persona's preferred order of high-Tai families,
// falling back to the roster default.
func (p PersonaProfile) patternOrder() []patternTarget {
	if len(p.PatternPreference) == 0 {
		return pursuablePatterns
	}
	return p.PatternPreference
}

// ---- persona.md parsing ------------------------------------------------

// parsePersonaMarkdown pulls the display fields out of persona.md. The file
// is hand-authored and is never machine-written, so parse defensively:
// name/tagline/glyph/tag come from "- **Key:** value" bullets, and the prose
// sections are the paragraphs under their own headings.
func parsePersonaMarkdown(markdown string) (name, tagline, glyph, tag, personality, strength, weakness string) {
	var section string
	paragraphs := map[string][]string{}
	for _, line := range strings.Split(markdown, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			section = strings.ToLower(strings.TrimSpace(strings.TrimLeft(trimmed, "# ")))
			continue
		}
		if value, ok := personaBullet(trimmed, "name"); ok {
			name = value
		}
		if value, ok := personaBullet(trimmed, "tagline"); ok {
			tagline = strings.Trim(value, `"“”`)
		}
		if value, ok := personaBullet(trimmed, "glyph"); ok {
			glyph = value
		}
		// The plain-language style label the player actually reads (§8).
		if value, ok := personaBullet(trimmed, "tag"); ok {
			tag = value
		}
		if trimmed == "" || strings.HasPrefix(trimmed, ">") || strings.HasPrefix(trimmed, "-") {
			continue
		}
		paragraphs[section] = append(paragraphs[section], trimmed)
	}
	join := func(key string) string { return strings.Join(paragraphs[key], " ") }
	return name, tagline, glyph, tag, join("personality"), join("strength"), join("weakness")
}

// personaBullet matches "- **Key:** value" with a case-insensitive key.
func personaBullet(line, key string) (string, bool) {
	if !strings.HasPrefix(line, "-") {
		return "", false
	}
	rest := strings.TrimSpace(strings.TrimPrefix(line, "-"))
	rest = strings.ReplaceAll(rest, "**", "")
	prefix := key + ":"
	if len(rest) < len(prefix) || !strings.EqualFold(rest[:len(prefix)], prefix) {
		return "", false
	}
	return strings.TrimSpace(rest[len(prefix):]), true
}
