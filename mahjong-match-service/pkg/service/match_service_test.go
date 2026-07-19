package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/common"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/match"
	pb "github.com/gameswithout/mahjong/mahjong-match-service/pkg/pb"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/session"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type fakeRuntime struct {
	joinView  rulesengine.SeatView
	joinKey   storage.MatchKey
	joinUser  string
	viewKey   storage.MatchKey
	viewUser  string
	applyKey  storage.MatchKey
	applyUser string
	applyCmd  rulesengine.MatchCommand
	joinErr   error
	viewErr   error
	applyErr  error
}

func (f *fakeRuntime) Join(
	_ context.Context,
	key storage.MatchKey,
	userID string,
) (rulesengine.SeatView, error) {
	f.joinKey = key
	f.joinUser = userID
	return f.joinView, f.joinErr
}

func (f *fakeRuntime) View(
	_ context.Context,
	key storage.MatchKey,
	userID string,
) (rulesengine.SeatView, error) {
	f.viewKey = key
	f.viewUser = userID
	return f.joinView, f.viewErr
}

func (f *fakeRuntime) Apply(
	_ context.Context,
	key storage.MatchKey,
	userID string,
	command rulesengine.MatchCommand,
) (rulesengine.CommandResult, rulesengine.SeatView, error) {
	f.applyKey = key
	f.applyUser = userID
	f.applyCmd = command
	return rulesengine.CommandResult{
		Version: f.joinView.StateVersion,
		Phase:   f.joinView.Phase,
	}, f.joinView, f.applyErr
}

func TestMatchServiceJoinMatch_ReturnsCallerProjection(t *testing.T) {
	runtime := &fakeRuntime{joinView: privateView()}
	service := NewMatchService("gameswithout-mahjong", runtime)
	ctx := common.ContextWithPrincipal(context.Background(), common.Principal{UserID: "user-east"})

	response, err := service.JoinMatch(ctx, &pb.JoinMatchRequest{
		Namespace: "gameswithout-mahjong",
		SessionId: "session-1",
		MatchId:   "match-1",
	})
	if err != nil {
		t.Fatalf("JoinMatch() error = %v", err)
	}
	if runtime.joinUser != "user-east" {
		t.Fatalf("runtime user = %q, want user-east", runtime.joinUser)
	}
	if runtime.joinKey.MatchID != "match-1" {
		t.Fatalf("runtime match = %q, want match-1", runtime.joinKey.MatchID)
	}
	if response.GetState().GetMatchId() != "match-1" || response.GetState().GetSeat() != "E" {
		t.Fatalf("response state = %#v", response.GetState())
	}
	if got := len(response.GetState().GetOwnHand()); got != 1 {
		t.Fatalf("own hand count = %d, want 1", got)
	}
	if got := response.GetState().GetPlayers()[1].GetHandCount(); got != 16 {
		t.Fatalf("other hand count = %d, want 16", got)
	}
}

func TestMatchServiceJoinMatch_RejectsMissingPrincipal(t *testing.T) {
	service := NewMatchService("gameswithout-mahjong", &fakeRuntime{})
	_, err := service.JoinMatch(context.Background(), &pb.JoinMatchRequest{
		Namespace: "gameswithout-mahjong",
		SessionId: "session-1",
		MatchId:   "match-1",
	})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("JoinMatch() code = %s, want Unauthenticated", status.Code(err))
	}
}

func TestMatchServiceJoinMatch_RejectsCrossNamespaceRequest(t *testing.T) {
	service := NewMatchService("gameswithout-mahjong", &fakeRuntime{})
	ctx := common.ContextWithPrincipal(context.Background(), common.Principal{UserID: "user-east"})
	_, err := service.JoinMatch(ctx, &pb.JoinMatchRequest{
		Namespace: "other-project",
		SessionId: "session-1",
		MatchId:   "match-1",
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("JoinMatch() code = %s, want PermissionDenied", status.Code(err))
	}
}

func TestMatchServiceJoinMatch_RejectsNilRequestAndRuntime(t *testing.T) {
	ctx := common.ContextWithPrincipal(context.Background(), common.Principal{UserID: "user-east"})
	service := NewMatchService("gameswithout-mahjong", &fakeRuntime{})
	if _, err := service.JoinMatch(ctx, nil); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("JoinMatch(nil) code = %s, want InvalidArgument", status.Code(err))
	}
	uninitialized := NewMatchService("gameswithout-mahjong", nil)
	if _, err := uninitialized.JoinMatch(ctx, &pb.JoinMatchRequest{
		Namespace: "gameswithout-mahjong",
		SessionId: "session-1",
		MatchId:   "match-1",
	}); status.Code(err) != codes.Internal {
		t.Fatalf("JoinMatch() uninitialized code = %s, want Internal", status.Code(err))
	}
}

func TestMatchServiceGetMatchState_UsesAuthenticatedPlayer(t *testing.T) {
	runtime := &fakeRuntime{joinView: privateView()}
	service := NewMatchService("gameswithout-mahjong", runtime)
	ctx := common.ContextWithPrincipal(context.Background(), common.Principal{UserID: "user-east"})

	response, err := service.GetMatchState(ctx, &pb.GetMatchStateRequest{
		Namespace: "gameswithout-mahjong",
		SessionId: "session-1",
		MatchId:   "match-1",
	})
	if err != nil {
		t.Fatalf("GetMatchState() error = %v", err)
	}
	if runtime.viewUser != "user-east" || runtime.viewKey.SessionID != "session-1" {
		t.Fatalf("runtime identity = %q/%q", runtime.viewUser, runtime.viewKey.SessionID)
	}
	if response.GetState().GetMatchId() != "match-1" ||
		response.GetState().GetStateVersion() != runtime.joinView.StateVersion {
		t.Fatalf("response state = %#v", response.GetState())
	}
}

func TestSubmitMatchCommand_RejectsMalformedDiscard(t *testing.T) {
	service := NewMatchService("gameswithout-mahjong", &fakeRuntime{})
	ctx := common.ContextWithPrincipal(context.Background(), common.Principal{UserID: "user-east"})
	_, err := service.SubmitMatchCommand(ctx, &pb.SubmitMatchCommandRequest{
		Namespace: "gameswithout-mahjong",
		SessionId: "session-1",
		MatchId:   "match-1",
		RequestId: "request-1",
		Type:      pb.MatchCommandType_MATCH_COMMAND_TYPE_DISCARD,
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("SubmitMatchCommand() code = %s, want InvalidArgument", status.Code(err))
	}
}

func TestSubmitMatchCommand_RejectsMalformedCommandEnvelope(t *testing.T) {
	base := func() *pb.SubmitMatchCommandRequest {
		return &pb.SubmitMatchCommandRequest{
			Namespace:       "gameswithout-mahjong",
			SessionId:       "session-1",
			MatchId:         "match-1",
			RequestId:       "request-1",
			Type:            pb.MatchCommandType_MATCH_COMMAND_TYPE_DRAW,
			ExpectedVersion: 2,
		}
	}
	tests := []struct {
		name   string
		mutate func(*pb.SubmitMatchCommandRequest)
	}{
		{"empty request ID", func(req *pb.SubmitMatchCommandRequest) { req.RequestId = "" }},
		{"oversized request ID", func(req *pb.SubmitMatchCommandRequest) {
			req.RequestId = strings.Repeat("r", 129)
		}},
		{"unsupported type", func(req *pb.SubmitMatchCommandRequest) {
			req.Type = pb.MatchCommandType_MATCH_COMMAND_TYPE_UNSPECIFIED
		}},
		{"missing claim", func(req *pb.SubmitMatchCommandRequest) {
			req.Type = pb.MatchCommandType_MATCH_COMMAND_TYPE_SUBMIT_CLAIM
		}},
		{"oversized claim action", func(req *pb.SubmitMatchCommandRequest) {
			req.Type = pb.MatchCommandType_MATCH_COMMAND_TYPE_SUBMIT_CLAIM
			req.Claim = &pb.ClaimCommand{
				ActionId: strings.Repeat("a", 129),
				Type:     string(rulesengine.ClaimPass),
			}
		}},
		{"too many claim tiles", func(req *pb.SubmitMatchCommandRequest) {
			req.Type = pb.MatchCommandType_MATCH_COMMAND_TYPE_SUBMIT_CLAIM
			req.Claim = &pb.ClaimCommand{
				ActionId: "claim-1",
				Type:     string(rulesengine.ClaimChow),
				TileIds:  []string{"1", "2", "3", "4", "5"},
			}
		}},
	}
	ctx := common.ContextWithPrincipal(context.Background(), common.Principal{UserID: "user-east"})
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := base()
			test.mutate(req)
			service := NewMatchService("gameswithout-mahjong", &fakeRuntime{})
			if _, err := service.SubmitMatchCommand(ctx, req); status.Code(err) != codes.InvalidArgument {
				t.Fatalf("SubmitMatchCommand() code = %s, want InvalidArgument", status.Code(err))
			}
		})
	}
}

func TestSubmitMatchCommand_ForwardsAuthenticatedCommand(t *testing.T) {
	runtime := &fakeRuntime{joinView: privateView()}
	service := NewMatchService("gameswithout-mahjong", runtime)
	ctx := common.ContextWithPrincipal(context.Background(), common.Principal{UserID: "user-east"})

	response, err := service.SubmitMatchCommand(ctx, &pb.SubmitMatchCommandRequest{
		Namespace:       "gameswithout-mahjong",
		SessionId:       "session-1",
		MatchId:         "match-1",
		RequestId:       "request-1",
		Type:            pb.MatchCommandType_MATCH_COMMAND_TYPE_DISCARD,
		ExpectedVersion: 2,
		TileId:          "characters-1-1",
	})
	if err != nil {
		t.Fatalf("SubmitMatchCommand() error = %v", err)
	}
	if runtime.applyUser != "user-east" || runtime.applyKey.MatchID != "match-1" {
		t.Fatalf("runtime identity = %q/%q", runtime.applyUser, runtime.applyKey.MatchID)
	}
	if runtime.applyCmd.Type != rulesengine.CommandDiscard ||
		runtime.applyCmd.RequestID != "request-1" ||
		runtime.applyCmd.TileID != "characters-1-1" {
		t.Fatalf("runtime command = %#v", runtime.applyCmd)
	}
	if response.GetRequestId() != "request-1" || response.GetStateVersion() != 2 {
		t.Fatalf("response = %#v", response)
	}
}

func TestRPCError_MapsDomainErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
		code codes.Code
	}{
		{"invalid roster", storage.ErrInvalidRoster, codes.FailedPrecondition},
		{"roster changed", storage.ErrRosterChanged, codes.Aborted},
		{"session missing", session.ErrSessionNotFound, codes.NotFound},
		{"session inactive", session.ErrSessionInactive, codes.FailedPrecondition},
		{"not a member", match.ErrNotMember, codes.PermissionDenied},
		{"match not loaded", match.ErrMatchNotLoaded, codes.FailedPrecondition},
		{"action forbidden", match.ErrActionNotAllowed, codes.FailedPrecondition},
		{"stale action", rulesengine.ErrStaleAction, codes.Aborted},
		{"unexpected", errors.New("database unavailable"), codes.Internal},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := status.Code(rpcError(test.err)); got != test.code {
				t.Fatalf("rpcError(%v) code = %s, want %s", test.err, got, test.code)
			}
		})
	}
}

func TestProjectState_ProjectsDiscardAndOnlyOwnClaimResponse(t *testing.T) {
	view := privateView()
	view.LastDiscard = &rulesengine.Discard{
		Seat:     rulesengine.East,
		Tile:     rulesengine.Tile{ID: "dots-9-1", Kind: rulesengine.Dots, Rank: 9, Copy: 1},
		Sequence: 3,
	}
	view.Claim = &rulesengine.SeatClaimView{
		ActionID:     "claim-3",
		StateVersion: 3,
		Discard:      *view.LastDiscard,
		Deadline:     "2026-07-18T12:00:10Z",
		Eligible:     []rulesengine.Seat{rulesengine.South, rulesengine.West, rulesengine.North},
		OwnResponse: &rulesengine.ClaimResponse{
			ActionID:         "claim-3",
			Seat:             rulesengine.South,
			Type:             rulesengine.ClaimPass,
			StateVersion:     3,
			ResponseRevision: 0,
		},
	}

	state := projectState("public-match-id", view)
	if state.GetMatchId() != "public-match-id" ||
		state.GetLastDiscard().GetTile().GetId() != "dots-9-1" {
		t.Fatalf("projected state/discard = %#v", state)
	}
	claim := state.GetClaim()
	if claim.GetActionId() != "claim-3" || len(claim.GetEligible()) != 3 {
		t.Fatalf("projected claim = %#v", claim)
	}
	if claim.GetOwnResponse().GetSeat() != "S" ||
		claim.GetOwnResponse().GetType() != string(rulesengine.ClaimPass) {
		t.Fatalf("projected own response = %#v", claim.GetOwnResponse())
	}
}

func privateView() rulesengine.SeatView {
	return rulesengine.SeatView{
		MatchID:      "internal-runtime-id",
		Seat:         rulesengine.East,
		StateVersion: 2,
		Phase:        rulesengine.PhaseAwaitingDiscard,
		ActiveSeat:   rulesengine.East,
		OwnHand: []rulesengine.Tile{
			{ID: "characters-1-1", Kind: rulesengine.Characters, Rank: 1, Copy: 1},
		},
		Players: []rulesengine.PlayerView{
			{Seat: rulesengine.East, HandCount: 17},
			{Seat: rulesengine.South, HandCount: 16},
			{Seat: rulesengine.West, HandCount: 16},
			{Seat: rulesengine.North, HandCount: 16},
		},
		Wall: rulesengine.WallView{Remaining: 79, DrawableRemaining: 63, ReserveRemaining: 16},
	}
}
