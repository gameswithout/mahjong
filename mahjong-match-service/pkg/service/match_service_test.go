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

func TestProjectState_ProjectsWaitsOwnMeldsDiscardsAndTurnDeadline(t *testing.T) {
	view := privateView()
	view.Waits = []rulesengine.WaitTileView{
		{Tile: rulesengine.Tile{ID: "dots-5-1", Kind: rulesengine.Dots, Rank: 5, Copy: 1}, VisibleRemaining: 3},
	}
	view.OwnMelds = []rulesengine.Meld{
		{Type: rulesengine.MeldPong, Tiles: []rulesengine.Tile{
			{ID: "wind-east-1", Kind: rulesengine.Wind, Copy: 1},
			{ID: "wind-east-2", Kind: rulesengine.Wind, Copy: 2},
			{ID: "wind-east-3", Kind: rulesengine.Wind, Copy: 3},
		}, Claimed: true},
	}
	view.Discards = []rulesengine.Discard{
		{Seat: rulesengine.East, Tile: rulesengine.Tile{ID: "dots-9-1", Kind: rulesengine.Dots, Rank: 9, Copy: 1}, Sequence: 1},
	}
	view.TurnDeadline = "2026-07-18T12:00:10Z"

	state := projectState("public-match-id", view)
	if len(state.GetWaits()) != 1 || state.GetWaits()[0].GetVisibleRemaining() != 3 {
		t.Fatalf("projected waits = %#v", state.GetWaits())
	}
	if len(state.GetOwnMelds()) != 1 || !state.GetOwnMelds()[0].GetClaimed() {
		t.Fatalf("projected own_melds = %#v", state.GetOwnMelds())
	}
	if len(state.GetDiscards()) != 1 || state.GetDiscards()[0].GetTile().GetId() != "dots-9-1" {
		t.Fatalf("projected discards = %#v", state.GetDiscards())
	}
	if state.GetTurnDeadline() != "2026-07-18T12:00:10Z" {
		t.Fatalf("projected turn_deadline = %q", state.GetTurnDeadline())
	}
}

func TestProjectState_ProjectsPlayerMeldsAndTakenOver(t *testing.T) {
	view := privateView()
	view.Players[1] = rulesengine.PlayerView{
		Seat:      rulesengine.South,
		HandCount: 13,
		TakenOver: true,
		Melds: []rulesengine.MeldView{
			{Type: rulesengine.MeldKong, Concealed: true},
		},
	}

	state := projectState("public-match-id", view)
	south := state.GetPlayers()[1]
	if !south.GetTakenOver() {
		t.Fatalf("expected taken_over projected, got %#v", south)
	}
	if len(south.GetMelds()) != 1 || !south.GetMelds()[0].GetConcealed() || len(south.GetMelds()[0].GetTiles()) != 0 {
		t.Fatalf("projected concealed meld view = %#v", south.GetMelds())
	}
}

// TestProjectState_ProjectsIsBotDistinctFromTakenOver guards against the
// exact bug class that shipped in the first AI Practice deploy: IsBot was
// added to rulesengine.PlayerView and populated correctly there, but
// projectState's field-by-field copy into the protobuf-generated
// pb.PlayerView (and the pb.PlayerView message itself) was never updated
// to carry it, so it silently never reached the wire — every seat showed
// "Auto-playing" instead of "Bot" against a real deployment even though
// every internal/unit test passed. A rulesengine.PlayerView field that
// projectState doesn't copy is invisible to any test that only exercises
// rulesengine directly, which is why this must live here instead.
func TestProjectState_ProjectsIsBotDistinctFromTakenOver(t *testing.T) {
	view := privateView()
	view.Players[1] = rulesengine.PlayerView{
		Seat:      rulesengine.South,
		HandCount: 13,
		TakenOver: true,
		IsBot:     true,
	}
	view.Players[2] = rulesengine.PlayerView{
		Seat:      rulesengine.West,
		HandCount: 13,
		TakenOver: true,
		IsBot:     false,
	}

	state := projectState("public-match-id", view)
	south := state.GetPlayers()[1]
	west := state.GetPlayers()[2]
	if !south.GetIsBot() {
		t.Fatalf("expected is_bot projected for a permanent bot seat, got %#v", south)
	}
	if west.GetIsBot() {
		t.Fatalf("expected is_bot false for a disclosed AFK takeover (not a bot seat), got %#v", west)
	}
	if !south.GetTakenOver() || !west.GetTakenOver() {
		t.Fatalf("both seats should still project taken_over regardless of is_bot: south=%#v west=%#v", south, west)
	}
}

func TestProjectState_ProjectsClaimOptionsWithWinPreview(t *testing.T) {
	view := privateView()
	view.Claim = &rulesengine.SeatClaimView{
		ActionID:     "claim-9",
		StateVersion: 4,
		Discard: rulesengine.Discard{
			Seat: rulesengine.West,
			Tile: rulesengine.Tile{ID: "dots-4-1", Kind: rulesengine.Dots, Rank: 4, Copy: 1},
		},
		Deadline: "2026-07-18T12:00:10Z",
		Eligible: []rulesengine.Seat{rulesengine.East},
		Options: rulesengine.ClaimOptionsView{
			CanWin:   true,
			CanPong:  true,
			ChowSets: [][2]string{{"dots-3-1", "dots-5-1"}},
			WinPreview: &rulesengine.ScoreResult{
				Winning: true,
				RawTai:  3,
				Patterns: []rulesengine.PatternScore{
					{Name: "Base Win", Tai: 1},
				},
			},
		},
	}

	state := projectState("public-match-id", view)
	options := state.GetClaim().GetOptions()
	if !options.GetCanWin() || !options.GetCanPong() {
		t.Fatalf("projected claim options = %#v", options)
	}
	if len(options.GetChowSets()) != 1 || options.GetChowSets()[0].GetTileIds()[0] != "dots-3-1" ||
		options.GetChowSets()[0].GetTileIds()[1] != "dots-5-1" {
		t.Fatalf("projected chow sets = %#v", options.GetChowSets())
	}
	if options.GetWinPreview().GetRawTai() != 3 || len(options.GetWinPreview().GetPatterns()) != 1 {
		t.Fatalf("projected win preview = %#v", options.GetWinPreview())
	}
}

func TestProjectState_ProjectsHandResultSettlementAndNextDealer(t *testing.T) {
	view := privateView()
	view.Phase = rulesengine.PhaseHandComplete
	view.HandResult = &rulesengine.HandResult{
		Kind:  rulesengine.WinDiscard,
		Payer: rulesengine.South,
		Winners: []rulesengine.HandWinner{
			{
				Seat:    rulesengine.East,
				Context: rulesengine.ScoreContext{Seat: rulesengine.East, DiscardWin: true},
				Score: rulesengine.ScoreResult{
					Winning: true,
					RawTai:  4,
					Patterns: []rulesengine.PatternScore{
						{Name: "Base Win", Tai: 1},
						{Name: "Concealed", Tai: 1},
					},
					Shape: rulesengine.HandShape{
						Pair: []rulesengine.Tile{
							{ID: "dots-1-1", Kind: rulesengine.Dots, Rank: 1, Copy: 1},
							{ID: "dots-1-2", Kind: rulesengine.Dots, Rank: 1, Copy: 2},
						},
					},
				},
			},
		},
	}
	view.Settlement = &rulesengine.Settlement{
		Transfers: []rulesengine.Transfer{
			{From: rulesengine.South, To: rulesengine.East, EffectiveTai: 4, RawAmount: 40, Amount: 40},
		},
		Net:          map[rulesengine.Seat]int64{rulesengine.East: 40, rulesengine.South: -40},
		TotalCredits: 40,
		TotalDebits:  40,
	}
	view.NextDealer = &rulesengine.ContinuationOutcome{
		NextDealer:        rulesengine.South,
		NextContinuations: 0,
		DealerRetains:     false,
	}

	state := projectState("public-match-id", view)
	result := state.GetHandResult()
	if result.GetKind() != string(rulesengine.WinDiscard) || result.GetPayer() != "S" {
		t.Fatalf("projected hand_result = %#v", result)
	}
	if len(result.GetWinners()) != 1 || result.GetWinners()[0].GetScore().GetRawTai() != 4 ||
		len(result.GetWinners()[0].GetScore().GetShape().GetPair()) != 2 {
		t.Fatalf("projected hand_result winners = %#v", result.GetWinners())
	}

	settlement := state.GetSettlement()
	if settlement.GetTotalCredits() != 40 || settlement.GetNet()["E"] != 40 || settlement.GetNet()["S"] != -40 {
		t.Fatalf("projected settlement = %#v", settlement)
	}
	if len(settlement.GetTransfers()) != 1 || settlement.GetTransfers()[0].GetAmount() != 40 {
		t.Fatalf("projected settlement transfers = %#v", settlement.GetTransfers())
	}

	nextDealer := state.GetNextDealer()
	if nextDealer.GetNextDealer() != "S" || nextDealer.GetDealerRetains() {
		t.Fatalf("projected next_dealer = %#v", nextDealer)
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
