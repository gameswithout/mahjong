package session

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/AccelByte/accelbyte-go-sdk/session-sdk/pkg/sessionclientmodels"
)

func TestTerminalStatus(t *testing.T) {
	tests := []struct {
		status   string
		terminal bool
	}{
		{"CONNECTED", false},
		{"JOINED", false},
		{"INVITED", false},
		{"DISCONNECTED", false},
		{"LEFT", true},
		{"KICKED", true},
		{"TERMINATED", true},
	}
	for _, test := range tests {
		status := test.status
		if got := terminalStatus(&status); got != test.terminal {
			t.Errorf("terminalStatus(%q) = %v, want %v", test.status, got, test.terminal)
		}
	}
}

func TestRosterFromResponse_RequiresExactActiveSession(t *testing.T) {
	namespace := "gameswithout-mahjong"
	sessionID := "session-1"
	active := true
	response := &sessionclientmodels.ApimodelsGameSessionResponse{
		Namespace: &namespace,
		ID:        &sessionID,
		IsActive:  &active,
		Members: []*sessionclientmodels.ApimodelsUserResponse{
			sessionMember("u1", "CONNECTED"),
			sessionMember("u2", "JOINED"),
			sessionMember("u3", "DISCONNECTED"),
			sessionMember("u4", "INVITED"),
			sessionMember("departed", "LEFT"),
		},
	}
	roster, err := rosterFromResponse(response, namespace, sessionID)
	if err != nil {
		t.Fatalf("rosterFromResponse() error = %v", err)
	}
	if len(roster) != 4 {
		t.Fatalf("roster size = %d, want 4", len(roster))
	}

	inactive := false
	response.IsActive = &inactive
	if _, err := rosterFromResponse(response, namespace, sessionID); !errors.Is(err, ErrSessionInactive) {
		t.Fatalf("inactive error = %v, want ErrSessionInactive", err)
	}
	response.IsActive = &active
	otherNamespace := "other"
	response.Namespace = &otherNamespace
	if _, err := rosterFromResponse(response, namespace, sessionID); !errors.Is(err, ErrSessionIdentity) {
		t.Fatalf("identity error = %v, want ErrSessionIdentity", err)
	}
}

func TestRosterFromResponse_RejectsIncompleteUniqueRoster(t *testing.T) {
	namespace := "gameswithout-mahjong"
	sessionID := "session-1"
	active := true
	response := &sessionclientmodels.ApimodelsGameSessionResponse{
		Namespace: &namespace,
		ID:        &sessionID,
		IsActive:  &active,
		Members: []*sessionclientmodels.ApimodelsUserResponse{
			sessionMember("u1", "JOINED"),
			sessionMember("u1", "CONNECTED"),
			sessionMember("u2", "JOINED"),
			sessionMember("u3", "JOINED"),
			sessionMember("departed", "LEFT"),
		},
	}
	if _, err := rosterFromResponse(response, namespace, sessionID); !errors.Is(err, ErrSessionRoster) {
		t.Fatalf("duplicate roster error = %v, want ErrSessionRoster", err)
	}
	if _, err := rosterFromResponse(nil, namespace, sessionID); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("nil response error = %v, want ErrSessionNotFound", err)
	}
}

func TestStaticResolver_RequiresFourAndReturnsCopy(t *testing.T) {
	members := []string{"u1", "u2", "u3", "u4"}
	resolver := StaticResolver{Members: members}
	roster, err := resolver.Roster(context.Background(), "namespace", "session")
	if err != nil {
		t.Fatalf("Roster() error = %v", err)
	}
	if !reflect.DeepEqual(roster, members) {
		t.Fatalf("Roster() = %#v, want %#v", roster, members)
	}
	roster[0] = "mutated"
	if resolver.Members[0] != "u1" {
		t.Fatal("Roster() returned an alias of the configured members")
	}
	if _, err := (StaticResolver{Members: members[:3]}).Roster(
		context.Background(), "namespace", "session",
	); !errors.Is(err, ErrSessionRoster) {
		t.Fatalf("three-member error = %v, want ErrSessionRoster", err)
	}
}

func sessionMember(userID, status string) *sessionclientmodels.ApimodelsUserResponse {
	return &sessionclientmodels.ApimodelsUserResponse{ID: &userID, StatusV2: &status}
}
