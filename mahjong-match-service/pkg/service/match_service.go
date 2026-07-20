package service

import (
	"context"
	"errors"
	"strings"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/common"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/match"
	pb "github.com/gameswithout/mahjong/mahjong-match-service/pkg/pb"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/session"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type MatchRuntime interface {
	Join(context.Context, storage.MatchKey, string) (rulesengine.SeatView, error)
	View(context.Context, storage.MatchKey, string) (rulesengine.SeatView, error)
	Apply(context.Context, storage.MatchKey, string, rulesengine.MatchCommand) (rulesengine.CommandResult, rulesengine.SeatView, error)
}

type MatchService struct {
	pb.UnimplementedServiceServer
	namespace  string
	runtime    MatchRuntime
	testUserID string
}

func NewMatchService(namespace string, runtime MatchRuntime, testUserID ...string) *MatchService {
	service := &MatchService{namespace: strings.TrimSpace(namespace), runtime: runtime}
	if len(testUserID) > 0 {
		service.testUserID = strings.TrimSpace(testUserID[0])
	}
	return service
}

func (s *MatchService) JoinMatch(
	ctx context.Context,
	req *pb.JoinMatchRequest,
) (*pb.JoinMatchResponse, error) {
	principal, key, err := s.requestContext(ctx, joinRequest(req))
	if err != nil {
		return nil, err
	}
	view, err := s.runtime.Join(ctx, key, principal.UserID)
	if err != nil {
		return nil, rpcError(err)
	}
	return &pb.JoinMatchResponse{State: projectState(key.MatchID, view)}, nil
}

func (s *MatchService) GetMatchState(
	ctx context.Context,
	req *pb.GetMatchStateRequest,
) (*pb.GetMatchStateResponse, error) {
	principal, key, err := s.requestContext(ctx, stateRequest(req))
	if err != nil {
		return nil, err
	}
	view, err := s.runtime.View(ctx, key, principal.UserID)
	if err != nil {
		return nil, rpcError(err)
	}
	return &pb.GetMatchStateResponse{State: projectState(key.MatchID, view)}, nil
}

func (s *MatchService) SubmitMatchCommand(
	ctx context.Context,
	req *pb.SubmitMatchCommandRequest,
) (*pb.SubmitMatchCommandResponse, error) {
	principal, key, err := s.requestContext(ctx, commandRequest(req))
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.GetRequestId()) == "" || len(req.GetRequestId()) > 128 {
		return nil, status.Error(codes.InvalidArgument, "request_id is required and must not exceed 128 characters")
	}
	command, err := toRulesCommand(req)
	if err != nil {
		return nil, err
	}
	result, view, err := s.runtime.Apply(ctx, key, principal.UserID, command)
	if err != nil {
		return nil, rpcError(err)
	}
	return &pb.SubmitMatchCommandResponse{
		RequestId:    req.GetRequestId(),
		StateVersion: result.Version,
		Phase:        string(result.Phase),
		State:        projectState(key.MatchID, view),
	}, nil
}

type requestIdentity struct {
	namespace string
	sessionID string
	matchID   string
}

func joinRequest(req *pb.JoinMatchRequest) requestIdentity {
	if req == nil {
		return requestIdentity{}
	}
	return requestIdentity{req.GetNamespace(), req.GetSessionId(), req.GetMatchId()}
}

func stateRequest(req *pb.GetMatchStateRequest) requestIdentity {
	if req == nil {
		return requestIdentity{}
	}
	return requestIdentity{req.GetNamespace(), req.GetSessionId(), req.GetMatchId()}
}

func commandRequest(req *pb.SubmitMatchCommandRequest) requestIdentity {
	if req == nil {
		return requestIdentity{}
	}
	return requestIdentity{req.GetNamespace(), req.GetSessionId(), req.GetMatchId()}
}

func (s *MatchService) requestContext(
	ctx context.Context,
	request requestIdentity,
) (common.Principal, storage.MatchKey, error) {
	if s == nil || s.runtime == nil {
		return common.Principal{}, storage.MatchKey{}, status.Error(codes.Internal, "match service is not initialized")
	}
	principal, ok := common.PrincipalFromContext(ctx)
	if !ok {
		if s.testUserID == "" {
			return common.Principal{}, storage.MatchKey{}, status.Error(codes.Unauthenticated, "authenticated player identity is missing")
		}
		principal = common.Principal{UserID: s.testUserID}
	}
	key := storage.MatchKey{
		Namespace: strings.TrimSpace(request.namespace),
		SessionID: strings.TrimSpace(request.sessionID),
		MatchID:   strings.TrimSpace(request.matchID),
	}
	if err := key.Validate(); err != nil {
		return common.Principal{}, storage.MatchKey{}, status.Error(codes.InvalidArgument, "namespace, session_id, and match_id are required and must not exceed 128 characters")
	}
	if key.Namespace != s.namespace {
		return common.Principal{}, storage.MatchKey{}, status.Error(codes.PermissionDenied, "namespace is not allowed")
	}
	return principal, key, nil
}

func toRulesCommand(req *pb.SubmitMatchCommandRequest) (rulesengine.MatchCommand, error) {
	command := rulesengine.MatchCommand{
		RequestID:       req.GetRequestId(),
		ExpectedVersion: req.GetExpectedVersion(),
		TileID:          req.GetTileId(),
	}
	switch req.GetType() {
	case pb.MatchCommandType_MATCH_COMMAND_TYPE_DRAW:
		command.Type = rulesengine.CommandDraw
	case pb.MatchCommandType_MATCH_COMMAND_TYPE_DISCARD:
		command.Type = rulesengine.CommandDiscard
		if strings.TrimSpace(command.TileID) == "" {
			return rulesengine.MatchCommand{}, status.Error(codes.InvalidArgument, "tile_id is required for discard")
		}
	case pb.MatchCommandType_MATCH_COMMAND_TYPE_SUBMIT_CLAIM:
		claim := req.GetClaim()
		if claim == nil || strings.TrimSpace(claim.GetActionId()) == "" ||
			len(claim.GetActionId()) > 128 || strings.TrimSpace(claim.GetType()) == "" ||
			len(claim.GetTileIds()) > 4 {
			return rulesengine.MatchCommand{}, status.Error(codes.InvalidArgument, "claim action_id and type are required")
		}
		command.Type = rulesengine.CommandSubmitClaim
		command.Claim = &rulesengine.ClaimResponse{
			ActionID:         claim.GetActionId(),
			Type:             rulesengine.ClaimType(claim.GetType()),
			TileIDs:          append([]string(nil), claim.GetTileIds()...),
			ResponseRevision: claim.GetResponseRevision(),
			Deliberate:       claim.GetDeliberate(),
		}
	default:
		return rulesengine.MatchCommand{}, status.Error(codes.InvalidArgument, "unsupported match command type")
	}
	return command, nil
}

func rpcError(err error) error {
	switch {
	case errors.Is(err, storage.ErrInvalidMatch), errors.Is(err, storage.ErrInvalidRoster):
		return status.Error(codes.FailedPrecondition, err.Error())
	case errors.Is(err, storage.ErrRosterChanged):
		return status.Error(codes.Aborted, err.Error())
	case errors.Is(err, session.ErrSessionNotFound):
		return status.Error(codes.NotFound, err.Error())
	case errors.Is(err, session.ErrSessionRoster):
		return status.Error(codes.FailedPrecondition, err.Error())
	case errors.Is(err, session.ErrSessionInactive), errors.Is(err, session.ErrSessionIdentity):
		return status.Error(codes.FailedPrecondition, err.Error())
	case errors.Is(err, match.ErrNotMember):
		return status.Error(codes.PermissionDenied, err.Error())
	case errors.Is(err, match.ErrMatchNotLoaded):
		return status.Error(codes.FailedPrecondition, "join the match before requesting state")
	case errors.Is(err, match.ErrActionNotAllowed),
		errors.Is(err, rulesengine.ErrTurnState),
		errors.Is(err, rulesengine.ErrTileNotInHand),
		errors.Is(err, rulesengine.ErrClaimIllegal):
		return status.Error(codes.FailedPrecondition, err.Error())
	case errors.Is(err, rulesengine.ErrStaleAction),
		errors.Is(err, rulesengine.ErrActionDuplicate):
		return status.Error(codes.Aborted, err.Error())
	default:
		return status.Error(codes.Internal, "match runtime failed")
	}
}

func projectState(matchID string, view rulesengine.SeatView) *pb.MatchState {
	state := &pb.MatchState{
		MatchId:      matchID,
		Seat:         string(view.Seat),
		StateVersion: view.StateVersion,
		Phase:        string(view.Phase),
		ActiveSeat:   string(view.ActiveSeat),
		OwnHand:      projectTiles(view.OwnHand),
		OwnExposed:   projectTiles(view.OwnExposed),
		OwnMelds:     projectMelds(view.OwnMelds),
		Players:      make([]*pb.PlayerView, 0, len(view.Players)),
		Wall: &pb.WallView{
			Remaining:         int32(view.Wall.Remaining),
			DrawableRemaining: int32(view.Wall.DrawableRemaining),
			ReserveRemaining:  int32(view.Wall.ReserveRemaining),
		},
		WinLocked:    view.WinLocked,
		Waits:        projectWaits(view.Waits),
		Discards:     projectDiscards(view.Discards),
		TurnDeadline: view.TurnDeadline,
	}
	for _, player := range view.Players {
		state.Players = append(state.Players, &pb.PlayerView{
			Seat:      string(player.Seat),
			HandCount: int32(player.HandCount),
			Exposed:   projectTiles(player.Exposed),
			MeldCount: int32(player.MeldCount),
			Melds:     projectMeldViews(player.Melds),
			TakenOver: player.TakenOver,
		})
	}
	if view.LastDiscard != nil {
		state.LastDiscard = projectDiscard(*view.LastDiscard)
	}
	if view.Claim != nil {
		state.Claim = &pb.ClaimView{
			ActionId:     view.Claim.ActionID,
			StateVersion: view.Claim.StateVersion,
			Discard:      projectDiscard(view.Claim.Discard),
			Deadline:     view.Claim.Deadline,
			Eligible:     projectSeats(view.Claim.Eligible),
			Options:      projectClaimOptions(view.Claim.Options),
		}
		if view.Claim.OwnResponse != nil {
			state.Claim.OwnResponse = projectClaimResponse(*view.Claim.OwnResponse)
		}
	}
	if view.HandResult != nil {
		state.HandResult = projectHandResult(*view.HandResult)
	}
	if view.Settlement != nil {
		state.Settlement = projectSettlement(*view.Settlement)
	}
	if view.NextDealer != nil {
		state.NextDealer = &pb.ContinuationOutcome{
			NextDealer:        string(view.NextDealer.NextDealer),
			NextContinuations: int32(view.NextDealer.NextContinuations),
			DealerRetains:     view.NextDealer.DealerRetains,
		}
	}
	return state
}

func projectWaits(waits []rulesengine.WaitTileView) []*pb.WaitTileView {
	result := make([]*pb.WaitTileView, 0, len(waits))
	for _, wait := range waits {
		result = append(result, &pb.WaitTileView{
			Tile:             projectTiles([]rulesengine.Tile{wait.Tile})[0],
			VisibleRemaining: int32(wait.VisibleRemaining),
		})
	}
	return result
}

func projectMelds(melds []rulesengine.Meld) []*pb.Meld {
	result := make([]*pb.Meld, 0, len(melds))
	for _, meld := range melds {
		result = append(result, &pb.Meld{
			Type:      string(meld.Type),
			Tiles:     projectTiles(meld.Tiles),
			Concealed: meld.Concealed,
			Added:     meld.Added,
			Claimed:   meld.Claimed,
		})
	}
	return result
}

func projectMeldViews(melds []rulesengine.MeldView) []*pb.MeldView {
	result := make([]*pb.MeldView, 0, len(melds))
	for _, meld := range melds {
		result = append(result, &pb.MeldView{
			Type:      string(meld.Type),
			Tiles:     projectTiles(meld.Tiles),
			Concealed: meld.Concealed,
		})
	}
	return result
}

func projectDiscards(discards []rulesengine.Discard) []*pb.Discard {
	result := make([]*pb.Discard, 0, len(discards))
	for _, discard := range discards {
		result = append(result, projectDiscard(discard))
	}
	return result
}

func projectClaimOptions(options rulesengine.ClaimOptionsView) *pb.ClaimOptionsView {
	view := &pb.ClaimOptionsView{
		CanWin:  options.CanWin,
		CanPong: options.CanPong,
		CanKong: options.CanKong,
	}
	for _, chowSet := range options.ChowSets {
		view.ChowSets = append(view.ChowSets, &pb.ChowSet{TileIds: []string{chowSet[0], chowSet[1]}})
	}
	if options.WinPreview != nil {
		view.WinPreview = projectScoreResult(*options.WinPreview)
	}
	return view
}

func projectScoreResult(result rulesengine.ScoreResult) *pb.ScoreResult {
	score := &pb.ScoreResult{
		Winning:        result.Winning,
		RawTai:         int32(result.RawTai),
		EffectiveTiles: int32(result.EffectiveTiles),
		Shape: &pb.HandShape{
			Pair:  projectTiles(result.Shape.Pair),
			Melds: projectMelds(result.Shape.Melds),
		},
	}
	for _, pattern := range result.Patterns {
		score.Patterns = append(score.Patterns, &pb.PatternScore{Name: pattern.Name, Tai: int32(pattern.Tai)})
	}
	return score
}

func projectScoreContext(context rulesengine.ScoreContext) *pb.ScoreContext {
	return &pb.ScoreContext{
		Seat:            string(context.Seat),
		PrevailingWind:  string(context.PrevailingWind),
		DiscardWin:      context.DiscardWin,
		Zimo:            context.Zimo,
		Replacement:     context.Replacement,
		LastTile:        context.LastTile,
		RobbedAddedKong: context.RobbedAddedKong,
		EightFlowers:    context.EightFlowers,
		EarthlyHand:     context.EarthlyHand,
		HeavenlyHand:    context.HeavenlyHand,
		SingleWait:      context.SingleWait,
	}
}

func projectHandResult(result rulesengine.HandResult) *pb.HandResult {
	handResult := &pb.HandResult{
		Kind:          string(result.Kind),
		Payer:         string(result.Payer),
		WinningTileId: result.WinningTileID,
	}
	for _, winner := range result.Winners {
		handResult.Winners = append(handResult.Winners, &pb.HandWinner{
			Seat:    string(winner.Seat),
			Context: projectScoreContext(winner.Context),
			Score:   projectScoreResult(winner.Score),
		})
	}
	return handResult
}

func projectSettlement(settlement rulesengine.Settlement) *pb.Settlement {
	result := &pb.Settlement{
		Net:          make(map[string]int64, len(settlement.Net)),
		TotalCredits: settlement.TotalCredits,
		TotalDebits:  settlement.TotalDebits,
	}
	for seat, amount := range settlement.Net {
		result.Net[string(seat)] = amount
	}
	for _, transfer := range settlement.Transfers {
		result.Transfers = append(result.Transfers, &pb.Transfer{
			From:         string(transfer.From),
			To:           string(transfer.To),
			EffectiveTai: transfer.EffectiveTai,
			RawAmount:    transfer.RawAmount,
			Amount:       transfer.Amount,
			Capped:       transfer.Capped,
		})
	}
	return result
}

func projectTiles(tiles []rulesengine.Tile) []*pb.Tile {
	result := make([]*pb.Tile, 0, len(tiles))
	for _, tile := range tiles {
		result = append(result, &pb.Tile{
			Id:   tile.ID,
			Kind: string(tile.Kind),
			Rank: uint32(tile.Rank),
			Copy: uint32(tile.Copy),
		})
	}
	return result
}

func projectDiscard(discard rulesengine.Discard) *pb.Discard {
	return &pb.Discard{
		Seat:     string(discard.Seat),
		Tile:     projectTiles([]rulesengine.Tile{discard.Tile})[0],
		Sequence: discard.Sequence,
	}
}

func projectSeats(seats []rulesengine.Seat) []string {
	result := make([]string, 0, len(seats))
	for _, seat := range seats {
		result = append(result, string(seat))
	}
	return result
}

func projectClaimResponse(response rulesengine.ClaimResponse) *pb.ClaimResponse {
	return &pb.ClaimResponse{
		ActionId:         response.ActionID,
		Seat:             string(response.Seat),
		Type:             string(response.Type),
		TileIds:          append([]string(nil), response.TileIDs...),
		StateVersion:     response.StateVersion,
		ResponseRevision: response.ResponseRevision,
		Deliberate:       response.Deliberate,
	}
}
