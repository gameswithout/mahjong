package service

import (
	"context"
	"errors"
	"strings"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/common"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/economy"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/match"
	pb "github.com/gameswithout/mahjong/mahjong-match-service/pkg/pb"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/progression"
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
	namespace   string
	runtime     MatchRuntime
	economy     *economy.Coordinator
	progression *progression.Coordinator
	testUserID  string
}

func NewMatchService(namespace string, runtime MatchRuntime, testUserID ...string) *MatchService {
	service := &MatchService{namespace: strings.TrimSpace(namespace), runtime: runtime}
	if len(testUserID) > 0 {
		service.testUserID = strings.TrimSpace(testUserID[0])
	}
	return service
}

func (s *MatchService) SetEconomy(coordinator *economy.Coordinator) {
	if s != nil {
		s.economy = coordinator
	}
}

func (s *MatchService) SetProgression(coordinator *progression.Coordinator) {
	if s != nil {
		s.progression = coordinator
	}
}

func (s *MatchService) GetJadeAccount(
	ctx context.Context,
	req *pb.GetJadeAccountRequest,
) (*pb.GetJadeAccountResponse, error) {
	principal, err := s.jadePrincipal(ctx, namespaceFromGetJade(req))
	if err != nil {
		return nil, err
	}
	account, err := s.economy.Account(ctx, principal.UserID)
	if err != nil {
		return nil, rpcError(err)
	}
	return &pb.GetJadeAccountResponse{Account: projectJadeAccount(account)}, nil
}

func (s *MatchService) ReserveJade(
	ctx context.Context,
	req *pb.ReserveJadeRequest,
) (*pb.ReserveJadeResponse, error) {
	principal, err := s.jadePrincipal(ctx, namespaceFromReserveJade(req))
	if err != nil {
		return nil, err
	}
	account, reservation, err := s.economy.Reserve(ctx, principal.UserID)
	if err != nil {
		return nil, rpcError(err)
	}
	return &pb.ReserveJadeResponse{
		Account: projectJadeAccount(account),
		Reservation: &pb.JadeReservation{
			ReservationId: reservation.ID,
			Amount:        reservation.Amount,
			Status:        reservation.Status,
		},
	}, nil
}

func (s *MatchService) ReleaseJade(
	ctx context.Context,
	req *pb.ReleaseJadeRequest,
) (*pb.ReleaseJadeResponse, error) {
	principal, err := s.jadePrincipal(ctx, namespaceFromReleaseJade(req))
	if err != nil {
		return nil, err
	}
	account, err := s.economy.Release(ctx, principal.UserID)
	if err != nil {
		return nil, rpcError(err)
	}
	return &pb.ReleaseJadeResponse{Account: projectJadeAccount(account)}, nil
}

// ClaimJadeWelfare is the §7.5 recovery path out of a locked-out balance.
//
// A refused claim is a successful response carrying a reason code, not an
// error. The player asked whether they could recover; "not until you finish a
// Practice hand today" is an answer, and an error status would push the client
// into a failure branch for an ordinary outcome.
func (s *MatchService) ClaimJadeWelfare(
	ctx context.Context,
	req *pb.ClaimJadeWelfareRequest,
) (*pb.ClaimJadeWelfareResponse, error) {
	principal, err := s.jadePrincipal(ctx, namespaceFromClaimWelfare(req))
	if err != nil {
		return nil, err
	}
	account, status, err := s.economy.ClaimWelfare(ctx, principal.UserID)
	if err != nil {
		return nil, rpcError(err)
	}
	return &pb.ClaimJadeWelfareResponse{
		Account: projectJadeAccount(account),
		Granted: status.Eligible,
		Amount:  status.Amount,
		Reason:  status.Reason,
	}, nil
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
	if s.economy != nil && !economy.IsPractice(view) {
		if err := s.economy.Bind(ctx, principal.UserID, key.RuntimeID()); err != nil {
			return nil, rpcError(err)
		}
	}
	state, err := s.projectState(ctx, key, principal.UserID, view)
	if err != nil {
		return nil, rpcError(err)
	}
	return &pb.JoinMatchResponse{State: state}, nil
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
	if s.economy != nil && !economy.IsPractice(view) {
		if err := s.economy.Bind(ctx, principal.UserID, key.RuntimeID()); err != nil {
			return nil, rpcError(err)
		}
	}
	state, err := s.projectState(ctx, key, principal.UserID, view)
	if err != nil {
		return nil, rpcError(err)
	}
	return &pb.GetMatchStateResponse{State: state}, nil
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
	current, err := s.runtime.View(ctx, key, principal.UserID)
	if err != nil {
		return nil, rpcError(err)
	}
	if s.economy != nil && !economy.IsPractice(current) {
		if err := s.economy.Bind(ctx, principal.UserID, key.RuntimeID()); err != nil {
			return nil, rpcError(err)
		}
	}
	result, view, err := s.runtime.Apply(ctx, key, principal.UserID, command)
	if err != nil {
		return nil, rpcError(err)
	}
	state, err := s.projectState(ctx, key, principal.UserID, view)
	if err != nil {
		return nil, rpcError(err)
	}
	return &pb.SubmitMatchCommandResponse{
		RequestId:    req.GetRequestId(),
		StateVersion: result.Version,
		Phase:        string(result.Phase),
		State:        state,
	}, nil
}

func namespaceFromGetJade(req *pb.GetJadeAccountRequest) string {
	if req == nil {
		return ""
	}
	return req.GetNamespace()
}

func namespaceFromReserveJade(req *pb.ReserveJadeRequest) string {
	if req == nil {
		return ""
	}
	return req.GetNamespace()
}

func namespaceFromReleaseJade(req *pb.ReleaseJadeRequest) string {
	if req == nil {
		return ""
	}
	return req.GetNamespace()
}

func namespaceFromClaimWelfare(req *pb.ClaimJadeWelfareRequest) string {
	if req == nil {
		return ""
	}
	return req.GetNamespace()
}

func (s *MatchService) jadePrincipal(
	ctx context.Context,
	namespace string,
) (common.Principal, error) {
	if s == nil || s.economy == nil {
		return common.Principal{}, status.Error(codes.Internal, "Jade economy is not initialized")
	}
	namespace = strings.TrimSpace(namespace)
	if namespace == "" {
		return common.Principal{}, status.Error(codes.InvalidArgument, "namespace is required")
	}
	if namespace != s.namespace {
		return common.Principal{}, status.Error(codes.PermissionDenied, "namespace is not allowed")
	}
	principal, ok := common.PrincipalFromContext(ctx)
	if !ok {
		if s.testUserID == "" {
			return common.Principal{}, status.Error(codes.Unauthenticated, "authenticated player identity is missing")
		}
		principal = common.Principal{UserID: s.testUserID}
	}
	return principal, nil
}

// progressionPrincipal mirrors jadePrincipal's namespace and identity checks
// for the XP surface, which has its own initialization and must not report a
// missing Jade economy when progression is what is unavailable.
func (s *MatchService) progressionPrincipal(
	ctx context.Context,
	namespace string,
) (common.Principal, error) {
	if s == nil || s.progression == nil {
		return common.Principal{}, status.Error(codes.Internal, "progression is not initialized")
	}
	namespace = strings.TrimSpace(namespace)
	if namespace == "" {
		return common.Principal{}, status.Error(codes.InvalidArgument, "namespace is required")
	}
	if namespace != s.namespace {
		return common.Principal{}, status.Error(codes.PermissionDenied, "namespace is not allowed")
	}
	principal, ok := common.PrincipalFromContext(ctx)
	if !ok {
		if s.testUserID == "" {
			return common.Principal{}, status.Error(codes.Unauthenticated, "authenticated player identity is missing")
		}
		principal = common.Principal{UserID: s.testUserID}
	}
	return principal, nil
}

func (s *MatchService) projectState(
	ctx context.Context,
	key storage.MatchKey,
	userID string,
	view rulesengine.SeatView,
) (*pb.MatchState, error) {
	state := projectState(key.MatchID, view)
	var settlement *economy.PlayerSettlement
	if s.economy != nil {
		account, projectedSettlement, err := s.economy.Project(
			ctx, userID, key.RuntimeID(), view,
		)
		if err != nil {
			return nil, err
		}
		if account != nil {
			state.JadeAccount = projectJadeAccount(*account)
		}
		settlement = projectedSettlement
	}
	if s.progression != nil {
		// Priced from the same authoritative view the state is built from, and
		// idempotent per (match, player), so the projection poll that repeats a
		// finished hand cannot pay for it twice.
		xp, xpErr := s.progression.RecordHand(
			ctx, userID, key.RuntimeID(), view, economy.IsPractice(view),
		)
		if xpErr != nil {
			return nil, rpcError(xpErr)
		}
		if xp != nil {
			state.XpAward = projectHandXPAward(xp.Award)
			state.Progression = projectProgression(xp.Player)
			for _, achievement := range xp.Achievements {
				state.Achievements = append(state.Achievements, projectHandXPAward(achievement))
			}
		}
	}
	if settlement != nil {
		state.JadeSettlement = &pb.JadeSettlement{
			Seat:          string(settlement.Seat),
			Delta:         settlement.Delta,
			BalanceBefore: settlement.BalanceBefore,
			BalanceAfter:  settlement.BalanceAfter,
			JournalId:     settlement.JournalID,
		}
	}
	return state, nil
}

func projectJadeAccount(account economy.Account) *pb.JadeAccount {
	return &pb.JadeAccount{
		CurrencyCode:     account.CurrencyCode,
		Balance:          account.Balance,
		Reserved:         account.Reserved,
		Available:        account.Available,
		Eligible:         account.Eligible,
		MinimumBalance:   account.Minimum,
		StakePerTai:      account.StakePerTai,
		DebitCap:         account.DebitCap,
		WalletSyncStatus: account.WalletStatus,
		WalletSyncError:  account.WalletError,
		WelfareEligible:  account.Welfare.Eligible,
		WelfareAmount:    account.Welfare.Amount,
		WelfareReason:    account.Welfare.Reason,
	}
}

func projectHandXPAward(award progression.HandAward) *pb.HandXPAward {
	components := make([]*pb.XPComponent, 0, len(award.Components))
	for _, component := range award.Components {
		components = append(components, &pb.XPComponent{
			Code:   component.Code,
			Label:  component.Label,
			Amount: int32(component.Amount),
		})
	}
	return &pb.HandXPAward{
		AwardId:       award.AwardID,
		Source:        award.Source,
		Total:         int32(award.Total),
		Components:    components,
		CappedByDaily: award.CappedByDaily,
	}
}

func projectLevelReward(reward progression.LevelReward) *pb.LevelReward {
	return &pb.LevelReward{
		Code:  reward.Code,
		Level: int32(reward.Level),
		Kind:  string(reward.Kind),
		Name:  reward.Name,
	}
}

func projectLevelStep(step progression.LevelStep) *pb.LevelStep {
	rewards := make([]*pb.LevelReward, 0, len(step.Rewards))
	for _, reward := range step.Rewards {
		rewards = append(rewards, projectLevelReward(reward))
	}
	return &pb.LevelStep{
		Level:           int32(step.Level),
		TotalXpRequired: int64(step.TotalXPRequired),
		XpForNextLevel:  int64(step.XPForNextLevel),
		Rewards:         rewards,
	}
}

func projectOnboardingOutcome(outcome progression.OnboardingOutcome) pb.OnboardingOutcome {
	switch outcome {
	case progression.OnboardingCompleted:
		return pb.OnboardingOutcome_ONBOARDING_OUTCOME_COMPLETED
	case progression.OnboardingSkipped:
		return pb.OnboardingOutcome_ONBOARDING_OUTCOME_SKIPPED
	default:
		return pb.OnboardingOutcome_ONBOARDING_OUTCOME_UNSPECIFIED
	}
}

func projectProgression(player progression.Player) *pb.PlayerProgression {
	earned := make([]*pb.LevelReward, 0, len(player.Earned))
	for _, reward := range player.Earned {
		earned = append(earned, projectLevelReward(reward))
	}
	projected := &pb.PlayerProgression{
		Level:          int32(player.Level.Level),
		LifetimeXp:     int64(player.LifetimeXP),
		XpIntoLevel:    int64(player.Level.XPIntoLevel),
		XpForNextLevel: int64(player.Level.XPForNextLevel),
		AtCap:          player.Level.AtCap,
		Earned:         earned,
	}
	if player.Next != nil {
		projected.Next = projectLevelReward(*player.Next)
	}
	if player.Onboarding != nil {
		projected.Onboarding = &pb.OnboardingState{
			Outcome:    projectOnboardingOutcome(player.Onboarding.Outcome),
			RecordedAt: player.Onboarding.RecordedAt,
		}
	}
	return projected
}

func namespaceFromGetProgression(req *pb.GetProgressionRequest) string {
	if req == nil {
		return ""
	}
	return req.GetNamespace()
}

func namespaceFromAwardOnboarding(req *pb.AwardOnboardingXPRequest) string {
	if req == nil {
		return ""
	}
	return req.GetNamespace()
}

func (s *MatchService) GetProgression(
	ctx context.Context,
	req *pb.GetProgressionRequest,
) (*pb.GetProgressionResponse, error) {
	principal, err := s.progressionPrincipal(ctx, namespaceFromGetProgression(req))
	if err != nil {
		return nil, err
	}
	player, err := s.progression.Player(ctx, principal.UserID)
	if err != nil {
		return nil, rpcError(err)
	}
	curve := make([]*pb.LevelStep, 0, progression.MaxLevel)
	for _, step := range progression.LevelCurve() {
		curve = append(curve, projectLevelStep(step))
	}
	return &pb.GetProgressionResponse{
		Progression: projectProgression(player),
		Curve:       curve,
	}, nil
}

func (s *MatchService) AwardOnboardingXP(
	ctx context.Context,
	req *pb.AwardOnboardingXPRequest,
) (*pb.AwardOnboardingXPResponse, error) {
	principal, err := s.progressionPrincipal(ctx, namespaceFromAwardOnboarding(req))
	if err != nil {
		return nil, err
	}
	var outcome progression.OnboardingOutcome
	switch req.GetOutcome() {
	case pb.OnboardingOutcome_ONBOARDING_OUTCOME_COMPLETED:
		outcome = progression.OnboardingCompleted
	case pb.OnboardingOutcome_ONBOARDING_OUTCOME_SKIPPED:
		outcome = progression.OnboardingSkipped
	default:
		return nil, status.Error(codes.InvalidArgument, "onboarding outcome is required")
	}
	result, err := s.progression.AwardOnboarding(ctx, principal.UserID, outcome)
	if err != nil {
		return nil, rpcError(err)
	}
	return &pb.AwardOnboardingXPResponse{
		Progression: projectProgression(result.Player),
		Award:       projectHandXPAward(result.Award),
		Granted:     !result.AlreadyAwarded,
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
	case pb.MatchCommandType_MATCH_COMMAND_TYPE_DECLARE_ZIMO:
		command.Type = rulesengine.CommandDeclareZimo
	case pb.MatchCommandType_MATCH_COMMAND_TYPE_DECLARE_CONCEALED_KONG:
		if len(req.GetTileIds()) != 4 {
			return rulesengine.MatchCommand{}, status.Error(codes.InvalidArgument, "four tile_ids are required for concealed Kong")
		}
		command.Type = rulesengine.CommandDeclareConcealedKong
		command.TileIDs = append([]string(nil), req.GetTileIds()...)
	case pb.MatchCommandType_MATCH_COMMAND_TYPE_DECLARE_ADDED_KONG:
		if strings.TrimSpace(command.TileID) == "" {
			return rulesengine.MatchCommand{}, status.Error(codes.InvalidArgument, "tile_id is required for added Kong")
		}
		command.Type = rulesengine.CommandDeclareAddedKong
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
	case errors.Is(err, economy.ErrIneligible),
		errors.Is(err, economy.ErrInsufficientReserve),
		errors.Is(err, economy.ErrReservationMissing):
		return status.Error(codes.FailedPrecondition, err.Error())
	case errors.Is(err, economy.ErrReservationBound):
		return status.Error(codes.Aborted, err.Error())
	case errors.Is(err, economy.ErrSettlementPending):
		return status.Error(codes.Unavailable, err.Error())
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
			IsBot:     player.IsBot,
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
	if view.SelfTurnOptions != nil {
		state.SelfTurnOptions = &pb.SelfTurnOptions{
			CanWin:           view.SelfTurnOptions.CanWin,
			AddedKongTileIds: append([]string(nil), view.SelfTurnOptions.AddedKongTileIDs...),
		}
		if view.SelfTurnOptions.WinPreview != nil {
			state.SelfTurnOptions.WinPreview = projectScoreResult(*view.SelfTurnOptions.WinPreview)
		}
		for _, ids := range view.SelfTurnOptions.ConcealedKongs {
			state.SelfTurnOptions.ConcealedKongs = append(
				state.SelfTurnOptions.ConcealedKongs,
				&pb.TileIDSet{TileIds: append([]string(nil), ids...)},
			)
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
