package match

import (
	"context"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/session"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
)

// An AI Practice roster pads the seats a human never filled with synthetic
// bot user IDs (session.AGSResolver.Roster). BotPersonas is what turns those
// into three visibly different opponents rather than three identical ones.

func TestBotPersonasSeatsTheMixedLineup(t *testing.T) {
	seats := map[string]rulesengine.Seat{
		"real-player":                           rulesengine.East,
		session.BotUserIDPrefix + "session-1:2": rulesengine.South,
		session.BotUserIDPrefix + "session-1:3": rulesengine.West,
		session.BotUserIDPrefix + "session-1:4": rulesengine.North,
	}
	personas, err := BotPersonas(seats)
	if err != nil {
		t.Fatalf("BotPersonas() error = %v", err)
	}
	want := map[rulesengine.Seat]string{
		rulesengine.South: "Rush",
		rulesengine.West:  "Guard",
		rulesengine.North: "Big Hand",
	}
	for seat, tag := range want {
		if personas[seat].Tag != tag {
			t.Errorf("%s persona tag = %q, want %q", seat, personas[seat].Tag, tag)
		}
	}
	if _, seated := personas[rulesengine.East]; seated {
		t.Error("the human seat was assigned a persona")
	}
}

// TestRuntimeAIPractice_SeatsNamedPersonas runs the real path end to end:
// AGS roster padding mints the bot user IDs, applyBotSeats marks the seats,
// and the projected table carries a named style for each of them. The unit
// tests above cover the assignment in isolation; this is what proves the
// wiring in between actually reaches a player.
func TestRuntimeAIPractice_SeatsNamedPersonas(t *testing.T) {
	clock := time.Date(2026, 8, 14, 8, 0, 0, 0, time.UTC)
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "session-practice",
		MatchID:   "match-practice",
	}
	runtime := NewRuntime(
		session.StaticResolver{Members: []string{
			"human", "bot:practice:1", "bot:practice:2", "bot:practice:3",
		}},
		&fakeMatchRepository{},
		rulesengine.NewMemoryEventStore(),
		func() time.Time { return clock },
	)

	view, err := runtime.Join(context.Background(), key, "human")
	if err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	if len(view.BotPersonas) != 3 {
		t.Fatalf("practice table seated %d personas, want 3", len(view.BotPersonas))
	}
	want := map[rulesengine.Seat]string{
		rulesengine.South: "Rush",
		rulesengine.West:  "Guard",
		rulesengine.North: "Big Hand",
	}
	for seat, tag := range want {
		persona, seated := view.BotPersonas[seat]
		if !seated {
			t.Errorf("%s has no persona", seat)
			continue
		}
		if persona.Tag != tag {
			t.Errorf("%s style tag = %q, want %q", seat, persona.Tag, tag)
		}
		if persona.Name == "" || persona.Glyph == "" {
			t.Errorf("%s persona is missing display fields: %+v", seat, persona)
		}
	}
	if _, seated := view.BotPersonas[rulesengine.East]; seated {
		t.Error("the human seat was given a persona")
	}
}

// TestBotPersonasIgnoresAHumanOnlyTable keeps public and ranked matches out
// of the persona path entirely: a disconnect takeover there plays the
// neutral policy, not a style nobody chose.
func TestBotPersonasIgnoresAHumanOnlyTable(t *testing.T) {
	seats := map[string]rulesengine.Seat{
		"p1": rulesengine.East, "p2": rulesengine.South,
		"p3": rulesengine.West, "p4": rulesengine.North,
	}
	personas, err := BotPersonas(seats)
	if err != nil {
		t.Fatalf("BotPersonas() error = %v", err)
	}
	if len(personas) != 0 {
		t.Fatalf("BotPersonas(all-human table) = %v, want none", personas)
	}
}
