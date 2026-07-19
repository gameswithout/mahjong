package storage

import (
	"errors"
	"strings"
	"testing"

	"github.com/gameswithout/mahjong/rulesengine"
)

func TestCanonicalRoster_StableAcrossInputOrder(t *testing.T) {
	first, firstHash, err := canonicalRoster([]string{"u3", "u1", "u4", "u2"})
	if err != nil {
		t.Fatalf("canonicalRoster() error = %v", err)
	}
	second, secondHash, err := canonicalRoster([]string{"u2", "u4", "u1", "u3"})
	if err != nil {
		t.Fatalf("canonicalRoster() second error = %v", err)
	}
	if firstHash != secondHash {
		t.Fatalf("roster hashes differ: %q != %q", firstHash, secondHash)
	}
	for index, want := range []string{"u1", "u2", "u3", "u4"} {
		if first[index] != want || second[index] != want {
			t.Fatalf("canonical roster[%d] = %q/%q, want %q", index, first[index], second[index], want)
		}
	}
}

func TestCanonicalRoster_RejectsInvalidRoster(t *testing.T) {
	tests := [][]string{
		{"u1", "u2", "u3"},
		{"u1", "u2", "u3", ""},
		{"u1", "u2", "u3", "u3"},
	}
	for _, roster := range tests {
		if _, _, err := canonicalRoster(roster); !errors.Is(err, ErrInvalidRoster) {
			t.Errorf("canonicalRoster(%v) error = %v, want ErrInvalidRoster", roster, err)
		}
	}
}

func TestRandomizedSeats_AssignsEachSeatExactlyOnce(t *testing.T) {
	assignments, err := randomizedSeats([]string{"u1", "u2", "u3", "u4"})
	if err != nil {
		t.Fatalf("randomizedSeats() error = %v", err)
	}
	seen := map[rulesengine.Seat]bool{}
	for _, seat := range assignments {
		if seen[seat] {
			t.Fatalf("seat %q assigned more than once", seat)
		}
		seen[seat] = true
	}
	for _, seat := range []rulesengine.Seat{rulesengine.East, rulesengine.South, rulesengine.West, rulesengine.North} {
		if !seen[seat] {
			t.Errorf("seat %q was not assigned", seat)
		}
	}
}

func TestMatchKeyRuntimeID_IsStableAndUnambiguous(t *testing.T) {
	key := MatchKey{Namespace: "gameswithout-mahjong", SessionID: "session-1", MatchID: "match-1"}
	if got, want := key.RuntimeID(), key.RuntimeID(); got != want {
		t.Fatalf("RuntimeID() = %q then %q", got, want)
	}
	ambiguous := MatchKey{Namespace: "gameswithout", SessionID: "mahjong/session-1", MatchID: "match-1"}
	if key.RuntimeID() == ambiguous.RuntimeID() {
		t.Fatal("distinct composite keys produced the same runtime ID")
	}
}

func TestMatchKeyValidate_RequiresBoundedIdentity(t *testing.T) {
	valid := MatchKey{Namespace: "gameswithout-mahjong", SessionID: "session-1", MatchID: "match-1"}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid key error = %v", err)
	}
	tests := []MatchKey{
		{Namespace: " ", SessionID: "session-1", MatchID: "match-1"},
		{Namespace: "gameswithout-mahjong", SessionID: "", MatchID: "match-1"},
		{Namespace: "gameswithout-mahjong", SessionID: "session-1", MatchID: strings.Repeat("m", 129)},
	}
	for _, key := range tests {
		if err := key.Validate(); !errors.Is(err, ErrInvalidMatch) {
			t.Errorf("Validate(%#v) error = %v, want ErrInvalidMatch", key, err)
		}
	}
}
