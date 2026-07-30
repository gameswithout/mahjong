package service

import (
	"context"
	"testing"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/common"
	pb "github.com/gameswithout/mahjong/mahjong-match-service/pkg/pb"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/progression"
	"github.com/gameswithout/mahjong/rulesengine"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type fakeProgressionRepository struct {
	player               progression.Player
	award                progression.HandAward
	onboarding           progression.OnboardingState
	applied              bool
	recordedOutcome      progression.OnboardingOutcome
	takenOverMajority    bool
	takeoverHistoryReads int
}

type fakeServiceAchievementReader struct {
	userID string
	rows   []progression.AchievementProgress
	err    error
}

func (f *fakeServiceAchievementReader) UnlockedAchievementCodes(
	context.Context,
	string,
) ([]string, error) {
	return nil, f.err
}

func (f *fakeServiceAchievementReader) AchievementProgress(
	_ context.Context,
	userID string,
) ([]progression.AchievementProgress, error) {
	f.userID = userID
	return f.rows, f.err
}

func (f *fakeProgressionRepository) AwardXP(
	_ context.Context,
	userID string,
	_ string,
	award progression.HandAward,
) (progression.Player, progression.HandAward, bool, error) {
	if f.award.AwardID == "" {
		f.award = award
	}
	if f.player.UserID == "" {
		f.player = progression.PlayerFromXP(userID, f.award.Total)
	}
	return f.player, f.award, f.applied, nil
}

func (f *fakeProgressionRepository) RecordOnboarding(
	_ context.Context,
	_ string,
	outcome progression.OnboardingOutcome,
	award progression.HandAward,
) (
	progression.Player,
	progression.HandAward,
	progression.OnboardingState,
	bool,
	error,
) {
	f.recordedOutcome = outcome
	if f.award.AwardID == "" {
		f.award = award
	}
	return f.player, f.award, f.onboarding, f.applied, nil
}

func (f *fakeProgressionRepository) PlayerProgression(
	context.Context,
	string,
) (progression.Player, error) {
	return f.player, nil
}

func (f *fakeProgressionRepository) TakenOverMajority(
	context.Context,
	string,
	string,
) (bool, error) {
	f.takeoverHistoryReads++
	return f.takenOverMajority, nil
}

func TestMatchServiceGetProgressionProjectsFullCurve(t *testing.T) {
	player := progression.PlayerFromXP("player-1", progression.OnboardingXP)
	player.Onboarding = &progression.OnboardingState{
		Outcome:    progression.OnboardingCompleted,
		RecordedAt: "2026-07-27T12:00:00Z",
	}
	repository := &fakeProgressionRepository{player: player}
	matchService := NewMatchService("gameswithout-mahjong", &fakeRuntime{})
	matchService.SetProgression(progression.NewCoordinator(repository))
	ctx := common.ContextWithPrincipal(
		context.Background(),
		common.Principal{UserID: "player-1"},
	)

	response, err := matchService.GetProgression(ctx, &pb.GetProgressionRequest{
		Namespace: "gameswithout-mahjong",
	})
	if err != nil {
		t.Fatalf("GetProgression() error = %v", err)
	}
	if response.GetProgression().GetLevel() != 2 ||
		response.GetProgression().GetLifetimeXp() != progression.OnboardingXP {
		t.Fatalf("progression = %#v", response.GetProgression())
	}
	if response.GetProgression().GetOnboarding().GetOutcome() !=
		pb.OnboardingOutcome_ONBOARDING_OUTCOME_COMPLETED {
		t.Fatalf("onboarding = %#v", response.GetProgression().GetOnboarding())
	}
	if len(response.GetCurve()) != progression.MaxLevel {
		t.Fatalf("curve length = %d, want %d", len(response.GetCurve()), progression.MaxLevel)
	}
	if response.GetCurve()[0].GetLevel() != 1 ||
		response.GetCurve()[0].GetTotalXpRequired() != 0 ||
		response.GetCurve()[49].GetLevel() != progression.MaxLevel {
		t.Fatalf(
			"curve endpoints = %#v / %#v",
			response.GetCurve()[0],
			response.GetCurve()[49],
		)
	}
}

func TestMatchServiceGetPlayerAchievementsUsesBearerIdentityAndProjectsCatalog(t *testing.T) {
	reader := &fakeServiceAchievementReader{rows: []progression.AchievementProgress{
		{Code: "first-hand", Current: 1, Unlocked: true},
		{Code: "self-reliant", Current: 4},
	}}
	coordinator := progression.NewCoordinator(nil)
	coordinator.SetAchievementReader(reader)
	matchService := NewMatchService("gameswithout-mahjong", &fakeRuntime{})
	matchService.SetProgression(coordinator)
	ctx := common.ContextWithPrincipal(
		context.Background(),
		common.Principal{UserID: "player-from-token"},
	)

	response, err := matchService.GetPlayerAchievements(
		ctx,
		&pb.GetPlayerAchievementsRequest{Namespace: "gameswithout-mahjong"},
	)
	if err != nil {
		t.Fatalf("GetPlayerAchievements() error = %v", err)
	}
	if reader.userID != "player-from-token" {
		t.Fatalf("reader user ID = %q", reader.userID)
	}
	if len(response.GetAchievements()) != 32 {
		t.Fatalf("achievement count = %d, want 32", len(response.GetAchievements()))
	}
	eligible := 0
	byCode := map[string]*pb.PlayerAchievement{}
	for _, achievement := range response.GetAchievements() {
		byCode[achievement.GetCode()] = achievement
		if achievement.GetEligible() {
			eligible++
		}
	}
	if eligible != 23 {
		t.Fatalf("eligible count = %d, want 23", eligible)
	}
	if got := byCode["first-hand"]; got == nil || !got.GetUnlocked() ||
		got.GetCurrent() != 1 || got.GetGoal() != 1 || got.GetXpReward() != 100 {
		t.Fatalf("first-hand = %#v", got)
	}
	if got := byCode["first-win"]; got == nil ||
		got.GetBonusReward() != "First Victory title" {
		t.Fatalf("first-win = %#v", got)
	}
	if got := byCode["claim-student"]; got == nil || got.GetEligible() ||
		got.GetUnavailableReason() == "" {
		t.Fatalf("claim-student = %#v", got)
	}
}

func TestMatchServiceGetPlayerAchievementsRequiresConfiguredReader(t *testing.T) {
	matchService := NewMatchService("gameswithout-mahjong", &fakeRuntime{})
	matchService.SetProgression(progression.NewCoordinator(nil))
	ctx := common.ContextWithPrincipal(
		context.Background(),
		common.Principal{UserID: "player-1"},
	)

	_, err := matchService.GetPlayerAchievements(
		ctx,
		&pb.GetPlayerAchievementsRequest{Namespace: "gameswithout-mahjong"},
	)
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("error code = %s, want FailedPrecondition", status.Code(err))
	}
}

func TestMatchServiceAwardOnboardingXPRecordsExplicitOutcome(t *testing.T) {
	player := progression.PlayerFromXP("player-1", progression.OnboardingXP)
	onboarding := progression.OnboardingState{
		Outcome:    progression.OnboardingSkipped,
		RecordedAt: "2026-07-27T12:00:00Z",
	}
	player.Onboarding = &onboarding
	award := progression.OnboardingAward()
	award.AwardID = "onboarding:player-1"
	repository := &fakeProgressionRepository{
		player:     player,
		award:      award,
		onboarding: onboarding,
		applied:    true,
	}
	matchService := NewMatchService("gameswithout-mahjong", &fakeRuntime{})
	matchService.SetProgression(progression.NewCoordinator(repository))
	ctx := common.ContextWithPrincipal(
		context.Background(),
		common.Principal{UserID: "player-1"},
	)

	response, err := matchService.AwardOnboardingXP(
		ctx,
		&pb.AwardOnboardingXPRequest{
			Namespace: "gameswithout-mahjong",
			Outcome:   pb.OnboardingOutcome_ONBOARDING_OUTCOME_SKIPPED,
		},
	)
	if err != nil {
		t.Fatalf("AwardOnboardingXP() error = %v", err)
	}
	if repository.recordedOutcome != progression.OnboardingSkipped {
		t.Fatalf("recorded outcome = %q, want skipped", repository.recordedOutcome)
	}
	if !response.GetGranted() ||
		response.GetAward().GetAwardId() != "onboarding:player-1" ||
		response.GetAward().GetComponents()[0].GetCode() != progression.ComponentTutorial {
		t.Fatalf("response = %#v", response)
	}

	_, err = matchService.AwardOnboardingXP(
		ctx,
		&pb.AwardOnboardingXPRequest{Namespace: "gameswithout-mahjong"},
	)
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("missing outcome code = %s, want InvalidArgument", status.Code(err))
	}
}

func TestMatchServiceProjectsXPWithoutJadeCoordinator(t *testing.T) {
	view := privateView()
	view.Phase = rulesengine.PhaseHandComplete
	view.HandResult = &rulesengine.HandResult{Kind: rulesengine.WinDiscard}
	runtime := &fakeRuntime{joinView: view}
	repository := &fakeProgressionRepository{applied: true}
	matchService := NewMatchService("gameswithout-mahjong", runtime)
	matchService.SetProgression(progression.NewCoordinator(repository))
	ctx := common.ContextWithPrincipal(
		context.Background(),
		common.Principal{UserID: "player-1"},
	)

	response, err := matchService.GetMatchState(ctx, &pb.GetMatchStateRequest{
		Namespace: "gameswithout-mahjong",
		SessionId: "session-1",
		MatchId:   "match-1",
	})
	if err != nil {
		t.Fatalf("GetMatchState() error = %v", err)
	}
	if response.GetState().GetJadeAccount() != nil {
		t.Fatalf("unexpected Jade projection = %#v", response.GetState().GetJadeAccount())
	}
	if response.GetState().GetXpAward().GetTotal() != progression.PublicHandXP ||
		response.GetState().GetProgression().GetLifetimeXp() != progression.PublicHandXP {
		t.Fatalf("XP projection = %#v", response.GetState())
	}
	if repository.takeoverHistoryReads != 1 {
		t.Fatalf(
			"takeover history reads = %d, want 1",
			repository.takeoverHistoryReads,
		)
	}
}
