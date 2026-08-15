import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BrowserIam, IamAuthError, createBrowserIam, type GuestIdentity } from "./iam";
import { CLOSED_BETA_COUNTRIES, DEFAULT_COUNTRY_CODE } from "./countries";
import { accelByteConfig } from "./config";
import {
  LobbyConnectionError,
  createLobbyConnection,
  type LobbyConnection,
} from "./lobby";
import {
  createSessionClient,
  SessionLookupError,
  type GameSessionSummary,
  type SessionMember,
  type SessionCreateConfig,
} from "./session";
import {
  createMatchmakingClient,
  MatchmakingError,
  type MatchmakingTicket,
} from "./matchmaking";
import {
  createMatchRuntimeConnection,
  MatchRuntimeError,
  type MatchRuntimeConnection,
} from "./match-runtime";
import { createJadeClient, JadeError } from "./jade";
import { jadeEntryRequirementMessage, stakeSummary } from "./jade-entry";
import { JadeRecoveryCard, type JadeRecoveryState } from "./JadeRecoveryCard";
import { LobbyHeader } from "./LobbyHeader";
import { LockedTiers } from "./LockedTiers";
import { playableTier, tierName, tierSummary } from "./lobby-tiers";
import { queueElapsedLabel, queueHealth, queueHealthMessage } from "./queue-health";
import { TutorialScreen } from "./tutorial/TutorialScreen";
import { createFriendsClient, FriendsError, type Friend, type FriendRequest } from "./friends";
import { FriendsPanel, type FriendsState } from "./FriendsPanel";
import { createPartyClient, PartyError, partyIsFull, type Party } from "./party";
import { PartyPanel, type PartyState } from "./PartyPanel";
import type { TutorialEvent } from "./tutorial/analytics";
import {
  createProgressionClient,
  ProgressionError,
  type ProgressionSnapshot,
} from "./progression";
import { AchievementScreen, ProgressionScreen } from "./ProgressionScreen";
import {
  createPlayerStatsClient,
  PlayerStatsError,
  reconcilePlayerStatsWithHistory,
  type PlayerStatSummary,
} from "./player-stats";
import { getMatchHistory, MatchHistoryError, type MatchHistoryEntry } from "./match-history";
import { StatisticsScreen } from "./StatisticsScreen";
import {
  createFreshPracticeSession,
  isPracticeMatch,
  leaveSessionIfPresent,
} from "./practice-flow";
import { browserMatchResumeStore, type MatchResumePointer } from "./match-resume";
import { MAX_RECONNECT_ATTEMPTS, pollDelayMs, reconnectDelayMs } from "./poll-backoff";
import { createStakedMatchmakingTicket } from "./staked-matchmaking";
import type {
  ClaimType,
  JadeAccount,
  OnboardingOutcome,
  MatchCommandRequest,
  PlayerAchievement,
  SeatView,
} from "../protocol/envelope";
import { MatchTable } from "./MatchTable";
import { VideoCallPanel } from "./VideoCallPanel";
import { useVideoCall } from "./useVideoCall";
import type { SeatId } from "./matchTableTypes";
import { CompletedHandFlow } from "./CompletedHandFlow";
import { RotationPanel } from "./RotationPanel";
import type {
  FriendRequestOutcome,
  ResultFriendOpponent,
  ResultFriendRelationship,
  ResultFriendsState,
} from "./HandResultScreen";
import { AccountUpgradeCard } from "./AccountUpgradeCard";
import { MINIMUM_ACCOUNT_AGE, ageInYears } from "./age-gate";
import { PracticeLaunchCard } from "./PracticeLaunchCard";
import { seatViewToMatchTableState } from "./matchTableAdapter";
import { MATCH_LOADING_SCREEN_MS, MatchLoadingScreen } from "./MatchLoadingScreen";
import { createBrowserTelemetry, type GameTelemetry } from "./telemetry";
import {
  defaultPlayerProfile,
  loadPlayerProfile,
  MAX_PROFILE_NICKNAME_LENGTH,
  savePlayerProfile,
  type PlayerProfileConfig,
} from "./player-profile";
import { SettingsScreen } from "./SettingsScreen";
import {
  DEFAULT_PLAYER_SETTINGS,
  createPlayerSettingsClient,
  loadCachedPlayerSettings,
  saveCachedPlayerSettings,
  type PlayerSettings,
} from "./settings";
import { FeedbackScreen } from "./FeedbackScreen";
import { createFeedbackClient, type PlayerFeedback } from "./feedback";
import { displayCountryName, formatNumber, t, translateSource } from "./i18n";
import { useLocale } from "./i18n/useLocale";
import "./styles.css";
import "./match-table.css";

// §8.7 auto-reconnect tuning: which MatchRuntimeErrorCode values are worth
// retrying automatically (a dropped/stalled connection) versus surfacing
// immediately (configuration/protocol errors that retrying cannot fix).
// not_found covers the short AGS Session propagation window immediately
// after one-action Practice creation.
const MATCH_RUNTIME_RETRYABLE_CODES = new Set(["closed", "network", "not_found", "timeout"]);
// How long a live table may keep showing its last authoritative view while
// its polls keep failing, before the player is moved to the manual error
// panel. Long enough to ride out a cellular blackout — a tunnel, a lift, an
// LTE/5G handover — without the player noticing; short enough that a
// genuinely dead match does not leave them staring at a frozen board.
export const STALLED_TABLE_GRACE_MS = 60_000;
// The lobby-side polls are cheaper and shorter-lived than the match poll, and
// both are waiting on another person to act, so they stay at three seconds
// when healthy and back off from there.
const ROSTER_POLL_INTERVAL_MS = 3_000;
const TICKET_POLL_INTERVAL_MS = 3_000;
// How many consecutive ticket-poll failures to absorb before pulling the
// player out of the queue. A single dropped request on a phone is noise, not a
// matchmaking failure, and ejecting them from the queue for it means losing
// their place in it.
const TICKET_POLL_FAILURE_TOLERANCE = 3;
const HUMAN_MATCH_SIZE = 4;
const AUTO_DRAW_DELAY_MS = 320;

export function shouldAutomaticallyRetryMatchRuntime(code: string, attempt: number): boolean {
  return MATCH_RUNTIME_RETRYABLE_CODES.has(code) && attempt < MAX_RECONNECT_ATTEMPTS;
}

type LobbyStatus = "connecting" | "connected" | "reconnecting";

type ViewState =
  | { status: "idle" }
  | { status: "signing_in" }
  | { status: "signed_in"; userId: string; lobbyStatus: LobbyStatus }
  | { status: "error"; phase: "iam" | "lobby"; code: string; message: string };

// §10.2/§10.3, D8 (revised 2026-07-19): email/password via AGS IAM's native
// EMAILPASSWD auth, alongside Guest. Registration is two steps — request a
// verification code, then submit it with the account details — so the
// account is created already-verified rather than needing a separate
// post-registration verify step.
type EmailAuthTab = "signin" | "register";

type EmailAuthState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "error"; message: string };

function emailAuthErrorMessage(error: unknown): string {
  if (error instanceof IamAuthError) {
    return error.message;
  }
  return "Something went wrong. Please retry.";
}

type SessionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "empty" }
  | { status: "loaded"; session: GameSessionSummary }
  | { status: "error"; code: string; message: string; retryLeaveSessionId?: string };

type MatchmakingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "releasing" }
  | { status: "searching"; ticket: MatchmakingTicket }
  | { status: "canceling"; ticket: MatchmakingTicket }
  | { status: "matched"; ticket: MatchmakingTicket }
  | {
      status: "error";
      code: string;
      message: string;
      recovery?: "cancel_ticket" | "release_reservation";
      ticket?: MatchmakingTicket;
    };

type MatchRuntimeState =
  | { status: "idle" }
  | { status: "preparing"; message: string }
  | { status: "connecting"; matchId: string }
  // stalled records the most recent failed request while the table is up.
  // The table keeps rendering its last authoritative view: polling continues
  // underneath, so a server-side error that clears on its own recovers
  // silently instead of ejecting the player from a live hand.
  | {
      status: "joined";
      matchId: string;
      view: SeatView;
      commandPending: boolean;
      stalled?: { code: string; message: string; since: number };
    }
  | {
      status: "error";
      code: string;
      message: string;
      retry?: "runtime" | "practice";
      retryPreviousSessionId?: string;
    };

type JadeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; account: JadeAccount }
  | { status: "error"; code: string; message: string };

type StatisticsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; summary: PlayerStatSummary; history: MatchHistoryEntry[] }
  | { status: "error"; message: string };

type ProgressionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; snapshot: ProgressionSnapshot }
  | { status: "error"; code: string; message: string };

type AchievementState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; achievements: PlayerAchievement[] }
  | { status: "error"; code: string; message: string };

type SettingsSyncStatus = "idle" | "loading" | "ready" | "saving" | "error";

type OnlineSessionEntryMode = "manual" | "matchmaking";
type OnlineMatchmakingMode = "bamboo_quick_play" | "full_rotation";

export function shouldAutomaticallyEnterHumanMatch(
  mode: OnlineSessionEntryMode,
  memberCount: number,
  runtimeStatus: MatchRuntimeState["status"],
): boolean {
  return mode === "matchmaking" && memberCount >= HUMAN_MATCH_SIZE && runtimeStatus === "idle";
}

function resultOpponents(members: SessionMember[], ownUserId: string): ResultFriendOpponent[] {
  const seen = new Set<string>();
  const opponents: ResultFriendOpponent[] = [];
  for (const member of members) {
    const userId = member.userId.trim();
    if (!userId || userId === ownUserId || seen.has(userId)) {
      continue;
    }
    seen.add(userId);
    const displayName = member.displayName?.trim();
    opponents.push({
      userId,
      ...(displayName ? { displayName } : {}),
    });
  }
  return opponents;
}

// P4.3 relationship projection. The AGS Session roster is the source for
// "who was at this public table"; AGS Friends remains the source for whether
// each opponent can receive a new request. No match-state identity field or
// client-side guessed friendship is needed.
export function buildResultFriendsState(
  session: GameSessionSummary,
  friends: FriendsState,
  ownUserId: string,
): ResultFriendsState {
  const opponents = resultOpponents(session.members, ownUserId);
  if (friends.status === "error") {
    return { status: "error", opponents, code: friends.code, message: friends.message };
  }
  if (friends.status !== "ready") {
    return { status: "loading", opponents };
  }

  const friendIds = new Set(friends.friends.map((friend) => friend.userId));
  const incomingIds = new Set(friends.incoming.map((request) => request.userId));
  const outgoingIds = new Set(friends.outgoing.map((request) => request.userId));
  return {
    status: "ready",
    opponents: opponents.map((opponent) => {
      let relationship: ResultFriendRelationship = "available";
      if (friendIds.has(opponent.userId)) {
        relationship = "friend";
      } else if (outgoingIds.has(opponent.userId)) {
        relationship = "outgoing";
      } else if (incomingIds.has(opponent.userId)) {
        relationship = "incoming";
      }
      return { ...opponent, relationship };
    }),
  };
}

export function shouldAutomaticallyDraw(view: SeatView, commandPending: boolean): boolean {
  return (
    !commandPending &&
    view.phase === "awaiting_draw" &&
    view.active_seat === view.seat
  );
}

function achievementAwardKey(award: NonNullable<SeatView["achievements"]>[number]): string {
  if (award.award_id) {
    return `id:${award.award_id}`;
  }
  const components = (award.components ?? [])
    .map((component) => component.code ?? component.label)
    .sort()
    .join(",");
  return `content:${award.source ?? ""}:${components}:${award.total ?? 0}`;
}

// Achievement awards are emitted only when AGS first reports the unlock. A
// later poll for the same completed hand legitimately omits that one-shot
// event, but the result screen must keep it visible until the player leaves.
export function retainAchievementAwards(
  previous: SeatView | undefined,
  next: SeatView,
): SeatView {
  if (!previous || previous.match_id !== next.match_id) {
    return next;
  }
  const combined = [...(previous.achievements ?? []), ...(next.achievements ?? [])];
  if (combined.length === 0) {
    return next;
  }
  const seen = new Set<string>();
  const achievements = combined.filter((award) => {
    const key = achievementAwardKey(award);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return { ...next, achievements };
}

function errorView(error: unknown): { code: string; message: string } {
  if (error instanceof IamAuthError) {
    return { code: error.code, message: error.message };
  }

  return { code: "unknown", message: "Guest sign-in failed. Please retry." };
}

function sessionErrorView(error: unknown): { code: string; message: string } {
  if (error instanceof SessionLookupError) {
    return { code: error.code, message: error.message };
  }

  return { code: "unknown", message: "Session lookup failed. Please retry." };
}

function matchmakingErrorView(error: unknown): { code: string; message: string } {
  if (error instanceof MatchmakingError) {
    return { code: error.code, message: error.message };
  }

  return { code: "unknown", message: "Matchmaking failed. Please retry." };
}

function matchRuntimeErrorView(error: unknown): { code: string; message: string } {
  if (error instanceof MatchRuntimeError) {
    return { code: error.code, message: error.message };
  }

  return { code: "unknown", message: "Match runtime failed. Please retry." };
}

function friendsErrorView(error: unknown): { code: string; message: string } {
  if (error instanceof FriendsError) {
    return { code: error.code, message: error.message };
  }
  return { code: "unknown", message: "Friends could not be loaded. Please retry." };
}

function partyErrorView(error: unknown): { code: string; message: string } {
  if (error instanceof PartyError) {
    return { code: error.code, message: error.message };
  }
  return { code: "unknown", message: "Party could not be loaded. Please retry." };
}

function jadeErrorView(error: unknown): { code: string; message: string } {
  if (error instanceof JadeError) {
    return { code: error.code, message: error.message };
  }
  return { code: "unknown", message: "Jade account could not be loaded. Please retry." };
}

function sessionIdFragment(sessionId: string): string {
  if (sessionId.length <= 16) {
    return sessionId;
  }

  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}

export function App(
  {
    iam: injectedIam,
    telemetry: injectedTelemetry,
  }: { iam?: BrowserIam; telemetry?: GameTelemetry } = {},
) {
  // One subscription at the application boundary refreshes every translated
  // child when the global language selector changes.
  useLocale();
  const [stableIam] = useState(() => injectedIam ?? createBrowserIam());
  const [gameTelemetry] = useState<GameTelemetry>(() =>
    injectedTelemetry ??
      createBrowserTelemetry({
        baseURL: accelByteConfig.baseURL,
        namespace: accelByteConfig.namespace,
        clientVersion: accelByteConfig.sessionClientVersion,
        getAccessToken: () => stableIam.getAccessToken(),
      }),
  );
  const [optionalAnalyticsConsent, setOptionalAnalyticsConsent] = useState(() =>
    gameTelemetry.optionalConsent(),
  );
  const [state, setState] = useState<ViewState>({ status: "idle" });
  const [sessionState, setSessionState] = useState<SessionState>({ status: "idle" });
  const [matchmakingState, setMatchmakingState] = useState<MatchmakingState>({ status: "idle" });
  const [matchRuntimeState, setMatchRuntimeState] = useState<MatchRuntimeState>({ status: "idle" });
  const [jadeState, setJadeState] = useState<JadeState>({ status: "idle" });
  const [jadeRecoveryState, setJadeRecoveryState] = useState<JadeRecoveryState>({
    status: "idle",
  });
  const [onlineSessionEntryMode, setOnlineSessionEntryMode] =
    useState<OnlineSessionEntryMode>("manual");
  const [joinSessionId, setJoinSessionId] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());
  // When the current queue attempt started, so the wait can be reported in the
  // player's own elapsed time rather than AGS's per-poll queueTime.
  const [queueStartedAt, setQueueStartedAt] = useState<number | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [controlRestoredNotice, setControlRestoredNotice] = useState(false);
  const [fullscreenHelp, setFullscreenHelp] = useState(false);
  const [introducedMatchId, setIntroducedMatchId] = useState<string | null>(null);
  // Whether the signed-in AGS account is still headless (device ID only).
  // Drives the end-of-match "create a full account" offer, and is cleared the
  // moment the upgrade succeeds so the offer stops after the next hand.
  const [isGuestAccount, setIsGuestAccount] = useState(false);
  const [playerProfile, setPlayerProfile] = useState<PlayerProfileConfig>(() =>
    defaultPlayerProfile(true),
  );
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [accountUpgradeOpen, setAccountUpgradeOpen] = useState(false);
  // undefined = closed, null = general lobby feedback, string = result report.
  const [feedbackSessionId, setFeedbackSessionId] =
    useState<string | null | undefined>(undefined);
  const [playerSettings, setPlayerSettings] =
    useState<PlayerSettings>(DEFAULT_PLAYER_SETTINGS);
  const [settingsSyncStatus, setSettingsSyncStatus] =
    useState<SettingsSyncStatus>("idle");
  const [friendsState, setFriendsState] = useState<FriendsState>({ status: "idle" });
  const [partyState, setPartyState] = useState<PartyState>({ status: "idle" });
  const [partyBusy, setPartyBusy] = useState(false);
  const [progressionState, setProgressionState] = useState<ProgressionState>({ status: "idle" });
  const [progressionOpen, setProgressionOpen] = useState(false);
  const [achievementState, setAchievementState] = useState<AchievementState>({ status: "idle" });
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  // §P2.3. Statistics come straight from AGS rather than the match service, so
  // they load on demand instead of riding the lobby's other traffic.
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [statisticsState, setStatisticsState] = useState<StatisticsState>({ status: "idle" });
  const [emailAuthTab, setEmailAuthTab] = useState<EmailAuthTab>("signin");
  const [emailAuthState, setEmailAuthState] = useState<EmailAuthState>({ status: "idle" });
  // Tracks the registration wizard step independent of emailAuthState's
  // transient working/error status, which also flips true->false->true
  // while the "code" step's own submit (registerWithEmail) is in flight.
  const [emailCodeRequested, setEmailCodeRequested] = useState(false);
  const [emailForm, setEmailForm] = useState({
    email: "",
    password: "",
    username: "",
    country: DEFAULT_COUNTRY_CODE,
    birthYear: "",
    birthMonth: "",
    ageConfirmed: false,
    code: "",
  });
  const wasTakenOverRef = useRef(false);
  // How the current AGS identity was established. Only a "guest" match is
  // written to the resume store, because guest is the one identity the client
  // can silently re-authenticate on reload (its device ID is persisted;
  // loginAsGuest is headless). See match-resume.ts.
  const authMethodRef = useRef<"guest" | "email" | null>(null);
  // Guards the one-shot mount resume so React StrictMode's double effect
  // invocation cannot start two guest logins / two joins.
  const resumeStartedRef = useRef(false);
  const lobbyRef = useRef<LobbyConnection | null>(null);
  const queueTelemetryRef = useRef(new Set<string>());
  // MatchmakingState deliberately stays about lifecycle only. This ref keeps
  // the product mode beside that lifecycle so polling, cancellation, joining,
  // and requeueing all use the same pool and only Quick Play touches Jade.
  const matchmakingModeRef = useRef<OnlineMatchmakingMode>("bamboo_quick_play");
  const handTelemetryKeyRef = useRef<string | null>(null);
  const rotationTelemetryKeyRef = useRef<string | null>(null);
  const resultFriendsTelemetryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const mountedAt = Date.now();
    gameTelemetry.start();
    gameTelemetry.track("app_session_started", {
      dimensions: { entry_point: "web" },
    });
    const interactiveTimer = window.setTimeout(() => {
      gameTelemetry.track("app_interactive", {
        measurements: { interactive_ms: Math.max(0, Date.now() - mountedAt) },
      });
    }, 0);
    const onVisibilityChange = () => {
      gameTelemetry.track("app_visibility_changed", {
        dimensions: { visibility_state: document.visibilityState },
      });
    };
    const onPageHide = () => void gameTelemetry.flush();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearTimeout(interactiveTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      gameTelemetry.stop();
    };
  }, [gameTelemetry]);

  useEffect(() => {
    if (state.status !== "signed_in") return;
    setPlayerProfile(loadPlayerProfile(state.userId, isGuestAccount));
  }, [state.status, state.status === "signed_in" ? state.userId : null, isGuestAccount]);

  const settingsRequestRef = useRef(0);
  const statisticsRequestRef = useRef(0);

  async function loadPlayerSettings() {
    if (state.status !== "signed_in") return;
    const requestId = ++settingsRequestRef.current;
    const cached = loadCachedPlayerSettings(state.userId);
    if (cached) {
      setPlayerSettings(cached);
      updateOptionalAnalyticsConsent(cached.optionalAnalyticsConsent);
    }
    setSettingsSyncStatus("loading");
    try {
      const stored = await createPlayerSettingsClient(
        stableIam.getAuthenticatedSdk(),
        accelByteConfig.namespace,
        state.userId,
      ).getStored();
      if (requestId !== settingsRequestRef.current) return;
      const settings = stored ?? cached ?? DEFAULT_PLAYER_SETTINGS;
      setPlayerSettings(settings);
      saveCachedPlayerSettings(state.userId, settings);
      updateOptionalAnalyticsConsent(settings.optionalAnalyticsConsent);
      setSettingsSyncStatus("ready");
    } catch {
      if (requestId !== settingsRequestRef.current) return;
      setSettingsSyncStatus("error");
    }
  }

  async function updatePlayerSettings(settings: PlayerSettings) {
    if (state.status !== "signed_in") return;
    const requestId = ++settingsRequestRef.current;
    setPlayerSettings(settings);
    saveCachedPlayerSettings(state.userId, settings);
    updateOptionalAnalyticsConsent(settings.optionalAnalyticsConsent);
    setSettingsSyncStatus("saving");
    try {
      const saved = await createPlayerSettingsClient(
        stableIam.getAuthenticatedSdk(),
        accelByteConfig.namespace,
        state.userId,
      ).save(settings);
      if (requestId !== settingsRequestRef.current) return;
      setPlayerSettings(saved);
      saveCachedPlayerSettings(state.userId, saved);
      setSettingsSyncStatus("ready");
    } catch {
      if (requestId !== settingsRequestRef.current) return;
      setSettingsSyncStatus("error");
    }
  }

  async function submitFeedback(feedback: PlayerFeedback) {
    if (state.status !== "signed_in") {
      throw new Error("Sign in is required to submit feedback.");
    }
    await createFeedbackClient(
      stableIam.getAuthenticatedSdk(),
      accelByteConfig.namespace,
      state.userId,
    ).submit(feedback);
  }

  useEffect(() => {
    if (state.status === "signed_in") {
      void loadPlayerSettings();
      void loadStatistics();
    } else {
      settingsRequestRef.current += 1;
      setPlayerSettings(DEFAULT_PLAYER_SETTINGS);
      setSettingsSyncStatus("idle");
    }
  }, [state.status, state.status === "signed_in" ? state.userId : null]);

  function updatePlayerProfile(profile: PlayerProfileConfig) {
    const normalized = {
      ...profile,
      nickname: profile.nickname.slice(0, MAX_PROFILE_NICKNAME_LENGTH),
    };
    setPlayerProfile(normalized);
    if (state.status === "signed_in") {
      savePlayerProfile(state.userId, normalized);
    }
  }

  function updateOptionalAnalyticsConsent(enabled: boolean) {
    gameTelemetry.setOptionalConsent(enabled);
    setOptionalAnalyticsConsent(enabled);
  }

  function recordTutorialEvent(event: TutorialEvent) {
    gameTelemetry.track(event.name, {
      dimensions: {
        script_version: event.scriptVersion,
        chapter_id: event.chapterId,
        step_id: event.stepId,
        from_step_id: event.fromStepId,
      },
    });
  }
  const matchRuntimeRef = useRef<MatchRuntimeConnection | null>(null);
  const matchRuntimeMatchIdRef = useRef<string | null>(null);
  // Consecutive failed match-runtime requests, which set how long the poll
  // loop waits before trying again. A ref rather than state: the loop reads it
  // when it schedules the next tick, and re-rendering on every failed poll
  // would only churn the table.
  const syncFailuresRef = useRef(0);
  const sessionRequestRef = useRef(0);
  const matchmakingRequestRef = useRef(0);
  // Jade is refreshed from several lifecycle paths (sign-in, settlement, and
  // returning to the lobby). Ignore an older response once a newer refresh or
  // authoritative match projection has won the race.
  const jadeRequestRef = useRef(0);
  const progressionRequestRef = useRef(0);
  const achievementRequestRef = useRef(0);
  // Social reads can outlive the identity that started them. Keeping their
  // generations separate prevents a full account's friends or party from
  // appearing after the player switches to a guest identity.
  const friendsRequestRef = useRef(0);
  const partyRequestRef = useRef(0);
  const friendsMutationRef = useRef(0);
  const partyMutationRef = useRef(0);
  const autoJoiningSessionIdRef = useRef<string | null>(null);
  const autoDrawStateKeyRef = useRef<string | null>(null);

  // Video chat: peer-to-peer camera/mic for online (human) matches. The
  // controller is created unconditionally (rules of hooks) but stays idle until
  // the player taps "Video chat", and only ever dials the other *human* seats —
  // so an all-bot Practice table yields an empty seat list and never surfaces
  // the feature at all. The stable key keeps the seat array identity steady
  // across renders so the mesh isn't torn down on every poll tick.
  const joinedVideoView = matchRuntimeState.status === "joined" ? matchRuntimeState.view : null;
  const videoHumanSeatsKey = joinedVideoView
    ? joinedVideoView.players
        .filter((player) => !player.is_bot && player.seat !== joinedVideoView.seat)
        .map((player) => player.seat)
        .sort()
        .join(",")
    : "";
  const videoHumanSeats = useMemo<SeatId[]>(
    () => (videoHumanSeatsKey ? (videoHumanSeatsKey.split(",") as SeatId[]) : []),
    [videoHumanSeatsKey],
  );
  // Stable across renders so a reconnecting match runtime keeps reading the
  // live token rather than one frozen at whichever render built it.
  const matchRuntimeCredentials = useMemo(
    () => ({
      getAccessToken: () => stableIam.getAccessToken(),
      refreshAccessToken: () => stableIam.refreshAccessToken(),
    }),
    [stableIam],
  );

  const videoController = useVideoCall({
    matchId: matchRuntimeState.status === "joined" ? matchRuntimeState.matchId : "",
    localSeat: (matchRuntimeState.status === "joined" ? matchRuntimeState.view.seat : "E") as SeatId,
    humanSeats: videoHumanSeats,
    iceConfigUrl: accelByteConfig.iceConfigURL ?? "",
    getAccessToken: () => stableIam.getAccessToken(),
  });

  // The roster poll below exists to notice the other three seats arriving so
  // the table can open itself. Once the runtime has joined, the seat view is
  // the authority on who is at the table and the roster is read by nothing —
  // so polling it there is a second request every three seconds, on the same
  // cellular link as the match poll, for data the hand does not use.
  const activeSessionId =
    state.status === "signed_in" &&
    state.lobbyStatus === "connected" &&
    sessionState.status === "loaded" &&
    matchRuntimeState.status !== "joined"
      ? sessionState.session.sessionId
      : null;

  useEffect(() => {
    return () => {
      sessionRequestRef.current += 1;
      matchmakingRequestRef.current += 1;
      progressionRequestRef.current += 1;
      achievementRequestRef.current += 1;
      friendsRequestRef.current += 1;
      partyRequestRef.current += 1;
      friendsMutationRef.current += 1;
      partyMutationRef.current += 1;
      lobbyRef.current?.disconnect();
      lobbyRef.current = null;
      matchRuntimeRef.current?.close();
      matchRuntimeRef.current = null;
      matchRuntimeMatchIdRef.current = null;
      autoJoiningSessionIdRef.current = null;
    };
  }, []);

  // One-shot on mount: if a fresh guest resume pointer survives from a prior
  // page load, rejoin that match instead of showing the sign-in screen. The
  // ref guard keeps React StrictMode's double effect invocation from starting
  // two resumes.
  useEffect(() => {
    if (resumeStartedRef.current) {
      return;
    }
    resumeStartedRef.current = true;
    const pointer = browserMatchResumeStore.load();
    if (pointer) {
      void resumeMatch(pointer);
    }
    // resumeMatch is a stable component-scoped closure; this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadedSessionId =
    sessionState.status === "loaded" ? sessionState.session.sessionId : null;

  useEffect(() => {
    if (
      loadedSessionId &&
      matchRuntimeMatchIdRef.current &&
      matchRuntimeMatchIdRef.current !== loadedSessionId
    ) {
      matchRuntimeRef.current?.close();
      matchRuntimeRef.current = null;
      matchRuntimeMatchIdRef.current = null;
      setMatchRuntimeState({ status: "idle" });
    }
  }, [loadedSessionId]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const sessionId = activeSessionId;
    const requestId = sessionRequestRef.current;
    let cancelled = false;

    let failures = 0;
    let timer = 0;

    async function refreshRosterInBackground() {
      try {
        const session = await createAuthenticatedSessionClient().getSession(sessionId);
        if (cancelled || requestId !== sessionRequestRef.current) {
          return;
        }

        failures = 0;
        setSessionState((current) =>
          current.status === "loaded" && current.session.sessionId === sessionId
            ? { status: "loaded", session }
            : current,
        );
      } catch {
        // Keep the last known roster visible during transient polling failures.
        failures += 1;
      }
    }

    // Awaiting each poll before scheduling the next keeps a slow cellular
    // round trip from stacking requests behind itself, and the backoff stops a
    // link that is down from being hammered every three seconds.
    const schedule = (): void => {
      if (cancelled) {
        return;
      }
      timer = window.setTimeout(async () => {
        await refreshRosterInBackground();
        schedule();
      }, pollDelayMs(failures, Math.random, ROSTER_POLL_INTERVAL_MS));
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeSessionId]);

  const activeTicketId =
    matchmakingState.status === "searching" || matchmakingState.status === "canceling"
      ? matchmakingState.ticket.ticketId
      : null;

  useEffect(() => {
    if (!activeTicketId || matchmakingState.status !== "searching") {
      return;
    }

    const ticketId = activeTicketId;
    const requestId = matchmakingRequestRef.current;
    const matchmakingMode = matchmakingModeRef.current;
    let cancelled = false;
    let failures = 0;
    let timer = 0;

    async function refreshTicketInBackground() {
      try {
        const ticket = createAuthenticatedMatchmakingClient(
          undefined,
          matchPoolForMode(matchmakingMode),
        ).getTicket(ticketId);
        const nextTicket = await ticket;
        if (cancelled || requestId !== matchmakingRequestRef.current) {
          return;
        }

        if (nextTicket.matchFound || nextTicket.sessionId) {
          setMatchmakingState({ status: "matched", ticket: nextTicket });
          return;
        }

        if (nextTicket.isActive === false) {
          const release =
            matchmakingMode === "bamboo_quick_play"
              ? await releaseJadeReservation()
              : ({ released: true } as const);
          if (cancelled || requestId !== matchmakingRequestRef.current) {
            return;
          }
          if (!release.released) {
            setMatchmakingState(reservationReleaseError(release));
            return;
          }
          setMatchmakingState({
            status: "error",
            code: "inactive",
            message: "AGS closed this matchmaking ticket before a table was found.",
          });
          return;
        }

        failures = 0;
        setMatchmakingState({ status: "searching", ticket: nextTicket });
      } catch (error) {
        if (cancelled || requestId !== matchmakingRequestRef.current) {
          return;
        }

        // Losing one poll is not losing the ticket: AGS is still holding the
        // player's place in the queue, so retry a few times before giving up
        // their spot over what may be a single dropped request.
        failures += 1;
        if (failures < TICKET_POLL_FAILURE_TOLERANCE) {
          return;
        }

        const safeError = matchmakingErrorView(error);
        setMatchmakingState({ status: "error", ...safeError });
      }
    }

    const schedule = (): void => {
      if (cancelled) {
        return;
      }
      timer = window.setTimeout(async () => {
        await refreshTicketInBackground();
        schedule();
      }, pollDelayMs(failures, Math.random, TICKET_POLL_INTERVAL_MS));
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeTicketId, matchmakingState.status]);

  const queueing =
    matchmakingState.status === "loading" ||
    matchmakingState.status === "searching" ||
    matchmakingState.status === "canceling";
  const matchmakingRecoveryRequired =
    matchmakingState.status === "error" && Boolean(matchmakingState.recovery);
  const matchmakingBlocksSessionActions =
    queueing ||
    matchmakingState.status === "releasing" ||
    matchmakingState.status === "matched" ||
    matchmakingRecoveryRequired;

  // Derived rather than cleared at each exit: matchmaking leaves the queue from
  // a dozen places (matched, canceled, failed, superseded, signed out), and a
  // stale clock would keep ticking behind whichever one got missed.
  useEffect(() => {
    if (!queueing && queueStartedAt !== null) {
      setQueueStartedAt(null);
    }
  }, [queueing, queueStartedAt]);

  const lobbyConnected = state.status === "signed_in" && state.lobbyStatus === "connected";

  // Friends and party load once, when the lobby is up. Both are lobby-scoped:
  // presence comes from the same connection, and a party without lobby
  // presence would show members AGS already considers disconnected.
  useEffect(() => {
    if (!lobbyConnected) {
      return;
    }
    if (isGuestAccount) {
      // Device/headless identities may play, but they do not have access to
      // account-bound social features. Keep both surfaces absent and make no
      // Friends or Party requests with the guest token.
      friendsRequestRef.current += 1;
      partyRequestRef.current += 1;
      friendsMutationRef.current += 1;
      partyMutationRef.current += 1;
      setFriendsState({ status: "idle" });
      setPartyState({ status: "idle" });
      setPartyBusy(false);
      return;
    }
    void loadFriends();
    void loadParty();
    // Deliberately keyed on the connection and identity only. Re-running on
    // every render would poll AGS from a render loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyConnected, isGuestAccount]);

  const queueElapsedMs = queueStartedAt === null ? 0 : Math.max(0, nowTick - queueStartedAt);
  const currentQueueHealth = queueHealth(queueElapsedMs);

  useEffect(() => {
    if (matchmakingState.status !== "searching" || currentQueueHealth === "starting") {
      return;
    }
    const thresholdKey = `threshold:${currentQueueHealth}`;
    if (!queueTelemetryRef.current.has(thresholdKey)) {
      queueTelemetryRef.current.add(thresholdKey);
      gameTelemetry.track("queue_threshold_reached", {
        dimensions: {
          queue_health: currentQueueHealth,
          threshold: currentQueueHealth === "normal" ? "p50_30s" : "patience_90s",
        },
        measurements: { elapsed_ms: queueElapsedMs },
      });
    }
    if (currentQueueHealth === "slow" && !queueTelemetryRef.current.has("practice_offered")) {
      queueTelemetryRef.current.add("practice_offered");
      gameTelemetry.track("queue_alternative_offered", {
        dimensions: {
          alternative: "practice",
          queue_health: currentQueueHealth,
        },
        measurements: { elapsed_ms: queueElapsedMs },
      });
    }
  }, [currentQueueHealth, gameTelemetry, matchmakingState.status, queueElapsedMs]);

  const matchedSessionId =
    matchmakingState.status === "matched" ? matchmakingState.ticket.sessionId ?? null : null;

  // Match-found is a handoff, not a second player decision. The ref keeps a
  // render or development Strict Mode effect replay from issuing a duplicate
  // Session join while the first request is still in flight.
  useEffect(() => {
    if (!matchedSessionId || autoJoiningSessionIdRef.current === matchedSessionId) {
      return;
    }
    void joinMatchedTable();
    // joinMatchedTable deliberately reads the matched ticket that caused
    // this effect; unrelated render state must not retrigger the join.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedSessionId]);

  const loadedSessionMemberCount =
    sessionState.status === "loaded" ? sessionState.session.members.length : 0;

  // The deployed runtime resolves human seats from the AGS Session roster.
  // Wait for all four joins to propagate before opening it.
  useEffect(() => {
    if (
      sessionState.status !== "loaded" ||
      !shouldAutomaticallyEnterHumanMatch(
        onlineSessionEntryMode,
        sessionState.session.members.length,
        matchRuntimeState.status,
      )
    ) {
      return;
    }
    void connectMatchRuntime(sessionState.session);
    // connectMatchRuntime moves the runtime away from idle before its first
    // async boundary, making the automatic handoff idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loadedSessionId,
    loadedSessionMemberCount,
    onlineSessionEntryMode,
    matchRuntimeState.status,
  ]);

  const matchRuntimeJoined = matchRuntimeState.status === "joined";
  const joinedMatchId = matchRuntimeState.status === "joined" ? matchRuntimeState.matchId : null;
  const resultFriendsForCurrentMatch =
    matchRuntimeState.status === "joined" &&
    (matchRuntimeState.view.phase === "hand_complete" ||
      matchRuntimeState.view.phase === "exhaustive_draw") &&
    !isPracticeMatch(matchRuntimeState.view) &&
    onlineSessionEntryMode === "matchmaking" &&
    !isGuestAccount &&
    state.status === "signed_in" &&
    sessionState.status === "loaded" &&
    sessionState.session.sessionId === matchRuntimeState.matchId
      ? buildResultFriendsState(sessionState.session, friendsState, state.userId)
      : undefined;

  const rotationViewerUserId = state.status === "signed_in" ? state.userId : undefined;
  // Names come from the AGS Session roster, the same source the result screen's
  // Add Friend surface uses. Where a member has no display name the rotation
  // surfaces fall back to the seat rather than showing a raw AGS user ID.
  const rotationNameOf = useCallback(
    (userId: string): string | undefined => {
      if (sessionState.status !== "loaded") return undefined;
      const member = sessionState.session.members.find((entry) => entry.userId === userId);
      return member?.displayName?.trim() || undefined;
    },
    [sessionState],
  );

  useEffect(() => {
    if (!joinedMatchId || introducedMatchId === joinedMatchId) {
      return;
    }
    const timer = window.setTimeout(
      () => setIntroducedMatchId(joinedMatchId),
      // The loading screen is a presentation beat, not application state.
      // Skip its wall-clock pause in unit journeys so those tests continue
      // exercising the table interaction instead of waiting 2.4 seconds.
      import.meta.env.MODE === "test" ? 0 : MATCH_LOADING_SCREEN_MS,
    );
    return () => window.clearTimeout(timer);
  }, [introducedMatchId, joinedMatchId]);

  // The §5.10/§9.4 countdown is a pure function of (deadline, now); ticking
  // a render clock while a hand is live is enough to keep it accurate
  // without the server pushing per-second updates.
  useEffect(() => {
    // Also ticks while queueing: the wait is the one place the player has
    // nothing to look at, so its clock has to be the one thing that moves.
    if (!matchRuntimeJoined && queueStartedAt === null) {
      return;
    }
    const interval = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [matchRuntimeJoined, queueStartedAt]);

  // driveLocked (both match runtimes) is lazy — it only advances an overdue
  // deadline when some client's request touches the match. Polling keeps
  // this seat's own view fresh (an opponent's auto-discard, a takeover
  // move, a resolved claim window) even when this player is not otherwise
  // acting, matching what another seat's own polling would already do for
  // them.
  // Self-scheduling rather than a fixed interval: the gap between polls has to
  // widen while the network is failing (see poll-backoff), which a setInterval
  // cannot express. syncFailuresRef is updated by the runtime callbacks below.
  useEffect(() => {
    if (!matchRuntimeJoined) {
      return;
    }
    let cancelled = false;
    let timer = 0;
    const schedule = (): void => {
      if (cancelled) {
        return;
      }
      timer = window.setTimeout(() => {
        try {
          matchRuntimeRef.current?.sync();
        } catch {
          // onError already routes connection failures into matchRuntimeState.
        }
        schedule();
      }, pollDelayMs(syncFailuresRef.current));
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [matchRuntimeJoined]);

  // A phone that regains its link — leaving a tunnel, or the player returning
  // to a backgrounded tab — should show a current board immediately. Waiting
  // out a backed-off timer here is the difference between a table that looks
  // alive on return and one that looks abandoned. Mobile browsers also throttle
  // background timers to about once a minute, so the visibility case is not
  // merely an optimisation.
  useEffect(() => {
    if (!matchRuntimeJoined) {
      return;
    }
    const resync = (): void => {
      if (document.visibilityState === "hidden") {
        return;
      }
      // The backoff exists to spare a dead network, not a recovered one.
      syncFailuresRef.current = 0;
      try {
        matchRuntimeRef.current?.sync();
      } catch {
        // onError already routes connection failures into matchRuntimeState.
      }
    };
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [matchRuntimeJoined]);

  const autoDrawStateKey =
    matchRuntimeState.status === "joined"
      ? `${matchRuntimeState.matchId}:${matchRuntimeState.view.state_version}`
      : null;
  const autoDrawEligible =
    matchRuntimeState.status === "joined"
      ? shouldAutomaticallyDraw(matchRuntimeState.view, matchRuntimeState.commandPending)
      : false;

  // Drawing is routine game flow rather than a meaningful decision. Give the
  // turn change a short visual beat, then draw automatically. The state-version
  // key makes this idempotent across renders, command acknowledgements, and
  // React Strict Mode effect replay; "Draw now" remains in the table as a
  // visible fallback during the short delay.
  useEffect(() => {
    if (!autoDrawEligible || !autoDrawStateKey || autoDrawStateKeyRef.current === autoDrawStateKey) {
      return;
    }
    const timeout = window.setTimeout(drawTile, AUTO_DRAW_DELAY_MS);
    return () => window.clearTimeout(timeout);
    // drawTile deliberately acts on the joined state represented by
    // autoDrawStateKey; unrelated render changes must not restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDrawEligible, autoDrawStateKey]);

  // §8.7 "client displays Reconnecting immediately": a transient match-
  // runtime disconnect (closed/network/timeout — not a configuration or
  // protocol error, which retrying cannot fix) is retried automatically a
  // bounded number of times instead of dropping straight to the manual
  // error panel. reconnectAttempt also drives the "Reconnecting…" label
  // below (a fresh connect vs. a resumed one).
  useEffect(() => {
    if (
      matchRuntimeState.status !== "error" ||
      !shouldAutomaticallyRetryMatchRuntime(matchRuntimeState.code, reconnectAttempt)
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setReconnectAttempt((attempt) => attempt + 1);
      void connectMatchRuntime();
    }, reconnectDelayMs(reconnectAttempt));
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchRuntimeState, reconnectAttempt]);

  useEffect(() => {
    if (matchRuntimeState.status === "joined") {
      setReconnectAttempt(0);
    }
  }, [matchRuntimeState.status]);

  // A table whose polls never start succeeding again is genuinely lost, so
  // escalate to the manual error panel rather than leaving the player on a
  // board that will never move.
  useEffect(() => {
    if (matchRuntimeState.status !== "joined" || !matchRuntimeState.stalled) {
      return;
    }
    const { code, message, since } = matchRuntimeState.stalled;
    const remaining = STALLED_TABLE_GRACE_MS - (Date.now() - since);
    const timeout = window.setTimeout(
      () => setMatchRuntimeState({ status: "error", code, message, retry: "runtime" }),
      Math.max(remaining, 0),
    );
    return () => window.clearTimeout(timeout);
  }, [matchRuntimeState]);

  // §8.7 "control-restored toast": detects this seat's own taken_over flag
  // going true -> false (the runtime called RestoreControl at this seat's
  // next legal personal turn once it observed this client present again).
  useEffect(() => {
    if (matchRuntimeState.status !== "joined") {
      return;
    }
    const own = matchRuntimeState.view.players.find((player) => player.seat === matchRuntimeState.view.seat);
    const isTakenOver = own?.taken_over ?? false;
    if (wasTakenOverRef.current && !isTakenOver) {
      setControlRestoredNotice(true);
      const timeout = window.setTimeout(() => setControlRestoredNotice(false), 5000);
      wasTakenOverRef.current = isTakenOver;
      return () => window.clearTimeout(timeout);
    }
    wasTakenOverRef.current = isTakenOver;
  }, [matchRuntimeState]);

  // §P2.3 / AI Analytics: one event per completed hand.
  //
  // Keyed on match and state version so it fires once for the hand rather than
  // on every render or poll of a finished table. The statistics the dashboard
  // reads are written server-side and remain authoritative for a player's own
  // record; this is the same outcome as an event, because AI Analytics answers
  // questions from telemetry rather than from Statistics.
  useEffect(() => {
    if (matchRuntimeState.status !== "joined") {
      return;
    }
    const view = matchRuntimeState.view;
    if (view.phase !== "hand_complete" && view.phase !== "exhaustive_draw") {
      return;
    }
    const key = `${matchRuntimeState.matchId}:${view.state_version}`;
    if (handTelemetryKeyRef.current === key) {
      return;
    }
    handTelemetryKeyRef.current = key;

    const winner = view.hand_result?.winners?.find((entry) => entry.seat === view.seat);
    const dealtIn =
      view.hand_result?.kind === "discard" && view.hand_result?.payer === view.seat;
    gameTelemetry.track("hand_completed", {
      dimensions: {
        mode: isPracticeMatch(view)
          ? "practice"
          : view.rotation
            ? "full_rotation"
            : "quick_play",
        outcome: winner ? "won" : view.phase === "exhaustive_draw" ? "draw" : "lost",
        win_kind: view.hand_result?.kind ?? "none",
        dealt_in: String(Boolean(dealtIn)),
        ting: String((view.waits?.length ?? 0) > 0),
      },
      measurements: {
        raw_tai: winner?.score.raw_tai ?? 0,
        wall_remaining: view.wall?.remaining ?? 0,
      },
    });
  }, [matchRuntimeState]);

  // One completion event per rotation, separate from the final hand event.
  // Counts and ending reason are enough to measure time-limit asymmetry while
  // keeping player/opponent identities out of analytics.
  useEffect(() => {
    const rotation =
      matchRuntimeState.status === "joined" ? matchRuntimeState.view.rotation : undefined;
    if (matchRuntimeState.status !== "joined" || !rotation?.complete) {
      return;
    }
    const key = matchRuntimeState.matchId;
    if (rotationTelemetryKeyRef.current === key) {
      return;
    }
    rotationTelemetryKeyRef.current = key;
    gameTelemetry.track("rotation_completed", {
      dimensions: {
        completion_reason: rotation.reason ?? "unknown",
      },
      measurements: {
        hands_played: rotation.hands_played ?? 0,
        seats_dealt: rotation.seats_dealt ?? 0,
      },
    });
  }, [gameTelemetry, matchRuntimeState]);

  // P4.3 view telemetry contains counts only. Opponent IDs and display names
  // are intentionally excluded from product analytics.
  useEffect(() => {
    if (
      matchRuntimeState.status !== "joined" ||
      resultFriendsForCurrentMatch?.status !== "ready"
    ) {
      return;
    }
    const key = `${matchRuntimeState.matchId}:${matchRuntimeState.view.state_version}`;
    if (resultFriendsTelemetryKeyRef.current === key) {
      return;
    }
    resultFriendsTelemetryKeyRef.current = key;
    gameTelemetry.track("result_friend_options_shown", {
      dimensions: { source: "hand_result" },
      measurements: {
        opponent_count: resultFriendsForCurrentMatch.opponents.length,
        eligible_count: resultFriendsForCurrentMatch.opponents.filter(
          (opponent) => opponent.relationship === "available",
        ).length,
      },
    });
  }, [gameTelemetry, matchRuntimeState, resultFriendsForCurrentMatch]);

  // Persist a resume pointer while a guest match is live so a reload or
  // tab-crash mid-hand can silently re-authenticate and rejoin (§8.7,
  // abnormal termination) instead of dropping the player back at sign-in. Only
  // guest matches are stored — email sign-in has no credential to replay on
  // reload. Re-saving on each joined update keeps the pointer fresh through a
  // long hand, so its staleness window is measured from last activity.
  useEffect(() => {
    if (
      matchRuntimeState.status === "joined" &&
      authMethodRef.current === "guest" &&
      state.status === "signed_in"
    ) {
      browserMatchResumeStore.save({
        sessionId: matchRuntimeState.matchId,
        userId: state.userId,
      });
    }
  }, [matchRuntimeState, state]);

  function resetForNewSignIn() {
    // A new sign-in supersedes any match the previous identity was in, so its
    // resume pointer must not survive to be replayed under a different user.
    browserMatchResumeStore.clear();
    sessionRequestRef.current += 1;
    matchmakingRequestRef.current += 1;
    jadeRequestRef.current += 1;
    progressionRequestRef.current += 1;
    statisticsRequestRef.current += 1;
    achievementRequestRef.current += 1;
    friendsRequestRef.current += 1;
    partyRequestRef.current += 1;
    friendsMutationRef.current += 1;
    partyMutationRef.current += 1;
    matchmakingModeRef.current = "bamboo_quick_play";
    setSessionState({ status: "idle" });
    setMatchmakingState({ status: "idle" });
    setMatchRuntimeState({ status: "idle" });
    setJadeState({ status: "idle" });
    setJadeRecoveryState({ status: "idle" });
    setProgressionState({ status: "idle" });
    setProgressionOpen(false);
    setAchievementState({ status: "idle" });
    setAchievementsOpen(false);
    setStatisticsState({ status: "idle" });
    setStatisticsOpen(false);
    setFriendsState({ status: "idle" });
    setPartyState({ status: "idle" });
    setPartyBusy(false);
    setReconnectAttempt(0);
    setOnlineSessionEntryMode("manual");
    autoJoiningSessionIdRef.current = null;
    lobbyRef.current?.disconnect();
    lobbyRef.current = null;
    matchRuntimeRef.current?.close();
    matchRuntimeRef.current = null;
    matchRuntimeMatchIdRef.current = null;
  }

  // Shared by every sign-in method (Guest, email/password) once an AGS
  // identity has been established — the Lobby connection itself doesn't
  // care how the player authenticated.
  function connectLobbyAfterSignIn(userId: string) {
    setState({ status: "signed_in", userId, lobbyStatus: "connecting" });
    void loadJadeAccount();
    void loadProgression();

    try {
      const lobby = createLobbyConnection(stableIam.getAuthenticatedSdk(), {
        onOpen: () => {
          setState((current) =>
            current.status === "signed_in" ? { ...current, lobbyStatus: "connected" } : current,
          );
          // The first HTTP reads can race the freshly established IAM/lobby
          // session and legitimately return the account defaults. Refresh
          // once the lobby is authoritative so returning players see their
          // persisted history and XP on login, not only after playing a hand.
          void loadJadeAccount();
          void loadProgression({ retryEmpty: true });
          void loadStatistics({ retryEmpty: true });
          gameTelemetry.track("lobby_impression", {
            dimensions: {
              entry_point: "sign_in",
              account_type: authMethodRef.current === "guest" ? "guest" : "full",
            },
          });
        },
        onMessage: () => {
          // Lobby frames are intentionally not rendered or logged.
        },
        onClose: () => {
          if (lobbyRef.current) {
            setState((current) =>
              current.status === "signed_in"
                ? { ...current, lobbyStatus: "reconnecting" }
                : current,
            );
          }
        },
        onError: (error: LobbyConnectionError) => {
          if (lobbyRef.current) {
            setState({
              status: "error",
              phase: "lobby",
              code: `lobby_${error.code}`,
              message: error.message,
            });
          }
        },
      });
      lobbyRef.current = lobby;
    } catch (error) {
      const safeError =
        error instanceof LobbyConnectionError
          ? error
          : new LobbyConnectionError("unknown", "Lobby connection failed. Please retry.", {
              cause: error,
            });
      setState({
        status: "error",
        phase: "lobby",
        code: `lobby_${safeError.code}`,
        message: safeError.message,
      });
    }
  }

  async function signInAsGuest() {
    resetForNewSignIn();
    authMethodRef.current = "guest";
    setState({ status: "signing_in" });

    try {
      const identity = await stableIam.loginAsGuest();
      setIsGuestAccount(identity.isGuest);
      connectLobbyAfterSignIn(identity.userId);
    } catch (error) {
      const safeError = errorView(error);
      setState({ status: "error", phase: "iam", ...safeError });
    }
  }

  // Reload/tab-loss resume: re-establish the guest identity the pointer was
  // written for, confirm the match's session still exists and we are still a
  // member, then rejoin it — all behind a full-screen "Resuming…" overlay
  // (matchRuntimeState !== "idle" owns the screen). Any dead end (sign-in
  // fails, a different guest now owns the device, the session is gone) drops
  // the pointer and falls back to a normal signed-in lobby or the sign-in
  // screen, never an error panel the player cannot act on.
  async function resumeMatch(pointer: MatchResumePointer) {
    setMatchRuntimeState({ status: "preparing", message: "Resuming your match…" });
    setState({ status: "signing_in" });
    authMethodRef.current = "guest";

    let identity: GuestIdentity;
    try {
      identity = await stableIam.loginAsGuest();
      setIsGuestAccount(identity.isGuest);
    } catch (error) {
      browserMatchResumeStore.clear();
      setMatchRuntimeState({ status: "idle" });
      setState({ status: "error", phase: "iam", ...errorView(error) });
      return;
    }

    if (identity.userId !== pointer.userId) {
      // The device now maps to a different guest (e.g. storage partially
      // cleared). The stored match is not this user's — sign in normally.
      browserMatchResumeStore.clear();
      setMatchRuntimeState({ status: "idle" });
      connectLobbyAfterSignIn(identity.userId);
      return;
    }

    connectLobbyAfterSignIn(identity.userId);

    let session: GameSessionSummary;
    try {
      session = await createAuthenticatedSessionClient().getSession(pointer.sessionId);
    } catch {
      // Session gone, ended, or we are no longer a member: nothing to resume.
      // The lobby connect above already left the player signed in.
      browserMatchResumeStore.clear();
      setMatchRuntimeState({ status: "idle" });
      return;
    }

    setJoinSessionId(session.sessionId);
    setSessionState({ status: "loaded", session });
    await connectMatchRuntime(session);
  }

  function updateEmailForm(patch: Partial<typeof emailForm>) {
    setEmailForm((current) => ({ ...current, ...patch }));
  }

  async function signInWithEmail() {
    setEmailAuthState({ status: "working" });
    try {
      const identity = await stableIam.loginWithEmail(emailForm.email.trim(), emailForm.password);
      resetForNewSignIn();
      setIsGuestAccount(false);
      authMethodRef.current = "email";
      setEmailAuthState({ status: "idle" });
      connectLobbyAfterSignIn(identity.userId);
    } catch (error) {
      setEmailAuthState({ status: "error", message: emailAuthErrorMessage(error) });
    }
  }

  async function requestEmailVerificationCode() {
    setEmailAuthState({ status: "working" });
    try {
      await stableIam.requestEmailVerificationCode(emailForm.email.trim());
      setEmailCodeRequested(true);
      setEmailAuthState({ status: "idle" });
    } catch (error) {
      setEmailAuthState({ status: "error", message: emailAuthErrorMessage(error) });
    }
  }

  async function registerWithEmail() {
    const birthYear = Number(emailForm.birthYear);
    const birthMonth = Number(emailForm.birthMonth);

    if (!emailForm.ageConfirmed) {
      setEmailAuthState({ status: "error", message: "Confirm your age to continue." });
      return;
    }
    if (!Number.isInteger(birthYear) || !Number.isInteger(birthMonth)) {
      setEmailAuthState({ status: "error", message: "Enter your birth month and year." });
      return;
    }
    if (ageInYears(birthYear, birthMonth) < MINIMUM_ACCOUNT_AGE) {
      setEmailAuthState({
        status: "error",
        message: `You must be at least ${MINIMUM_ACCOUNT_AGE} years old to create an account.`,
      });
      return;
    }

    setEmailAuthState({ status: "working" });
    try {
      await stableIam.registerWithEmail({
        email: emailForm.email.trim(),
        username: emailForm.username.trim(),
        password: emailForm.password,
        country: emailForm.country,
        birthYear,
        birthMonth,
        code: emailForm.code.trim(),
      });
      const identity = await stableIam.loginWithEmail(emailForm.email.trim(), emailForm.password);
      resetForNewSignIn();
      setIsGuestAccount(false);
      authMethodRef.current = "email";
      setEmailAuthState({ status: "idle" });
      connectLobbyAfterSignIn(identity.userId);
    } catch (error) {
      setEmailAuthState({ status: "error", message: emailAuthErrorMessage(error) });
    }
  }

  async function viewMySessions() {
    const requestId = ++sessionRequestRef.current;
    setOnlineSessionEntryMode("manual");
    setSessionState({ status: "loading" });

    try {
      const client = createSessionClient(
        stableIam.getAuthenticatedSdk(),
        accelByteConfig.namespace,
      );
      const sessions = await client.listMySessions();
      if (requestId !== sessionRequestRef.current) {
        return;
      }

      const firstSession = sessions[0];
      if (!firstSession) {
        setSessionState({ status: "empty" });
        return;
      }

      const session = await client.getSession(firstSession.sessionId);
      if (requestId !== sessionRequestRef.current) {
        return;
      }

      setSessionState({ status: "loaded", session });
    } catch (error) {
      if (requestId !== sessionRequestRef.current) {
        return;
      }

      const safeError = sessionErrorView(error);
      setSessionState({ status: "error", ...safeError });
    }
  }

  function sessionCreateConfig(): SessionCreateConfig {
    if (!accelByteConfig.sessionTemplate || !accelByteConfig.sessionClientVersion) {
      throw new SessionLookupError(
        "configuration",
        "Session table configuration is incomplete. Restart the dev server after updating .env.",
      );
    }

    return {
      configurationName: accelByteConfig.sessionTemplate,
      clientVersion: accelByteConfig.sessionClientVersion,
      joinability: "OPEN",
      maxPlayers: 4,
      minPlayers: 1,
      type: "NONE",
    };
  }

  function createAuthenticatedSessionClient() {
    return createSessionClient(
      stableIam.getAuthenticatedSdk(),
      accelByteConfig.namespace,
      sessionCreateConfig(),
    );
  }

  function matchPoolForMode(mode: OnlineMatchmakingMode): string | undefined {
    return mode === "full_rotation"
      ? accelByteConfig.rotationMatchPool
      : accelByteConfig.matchPool;
  }

  // partySessionId turns a solo ticket into a party ticket: AGS seats every
  // member of that party at the same table. Passing an empty string — the
  // previous behaviour — queues the caller alone.
  function createAuthenticatedMatchmakingClient(partySessionId?: string, matchPool?: string) {
    const pool = matchPool ?? accelByteConfig.matchPool;
    if (!pool) {
      throw new MatchmakingError(
        "configuration",
        "Matchmaking pool configuration is incomplete. Restart the dev server after updating .env.",
      );
    }

    return createMatchmakingClient(stableIam.getAuthenticatedSdk(), accelByteConfig.namespace, {
      matchPool: pool,
      sessionId: partySessionId,
    });
  }

  function createAuthenticatedFriendsClient() {
    return createFriendsClient(stableIam.getAccessToken(), {
      url: accelByteConfig.baseURL,
      namespace: accelByteConfig.namespace,
    });
  }

  function createAuthenticatedPartyClient() {
    if (!accelByteConfig.partyTemplate) {
      throw new PartyError("configuration", "Party template is not configured.");
    }
    return createPartyClient(stableIam.getAccessToken(), {
      url: accelByteConfig.baseURL,
      namespace: accelByteConfig.namespace,
      configurationName: accelByteConfig.partyTemplate,
    });
  }

  function createAuthenticatedJadeClient() {
    if (!accelByteConfig.matchServiceURL) {
      throw new JadeError("configuration", "Jade service URL is not configured.");
    }
    return createJadeClient(stableIam.getAccessToken(), {
      url: accelByteConfig.matchServiceURL,
      namespace: accelByteConfig.namespace,
    });
  }

  // Returns the account so callers deciding whether to commit Jade can act on
  // the value they just fetched instead of the render closure's stale state.
  async function loadStatistics(options?: { retryEmpty?: boolean }) {
    const requestId = ++statisticsRequestRef.current;
    setStatisticsState({ status: "loading" });
    try {
      if (!accelByteConfig.matchServiceURL) {
        throw new PlayerStatsError("configuration", "Match service URL is not configured.");
      }
      const clientOptions = {
        url: accelByteConfig.matchServiceURL,
        namespace: accelByteConfig.namespace,
      };
      const fetchStatistics = () => {
        const accessToken = stableIam.getAccessToken();
        return Promise.all([
          createPlayerStatsClient(accessToken, clientOptions).get(),
          getMatchHistory(accessToken, clientOptions),
        ]);
      };
      let result;
      try {
        result = await fetchStatistics();
      } catch (error) {
        const unauthenticated =
          (error instanceof PlayerStatsError && error.code === "unauthenticated") ||
          (error instanceof MatchHistoryError && error.code === "unauthenticated");
        if (!unauthenticated || !(await stableIam.refreshAccessToken())) {
          throw error;
        }
        result = await fetchStatistics();
      }
      let [summary, history] = result;
      if (options?.retryEmpty) {
        for (const delayMs of [500, 1_000]) {
          if (summary.handsPlayed > 0 || history.length > 0) break;
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          if (requestId !== statisticsRequestRef.current) return;
          [summary, history] = await fetchStatistics();
        }
      }
      if (requestId !== statisticsRequestRef.current) {
        return;
      }
      setStatisticsState({
        status: "ready",
        summary: reconcilePlayerStatsWithHistory(summary, history),
        history,
      });
    } catch (error) {
      if (requestId !== statisticsRequestRef.current) {
        return;
      }
      setStatisticsState({
        status: "error",
        message:
          error instanceof PlayerStatsError
            ? error.message
            : "Statistics could not be loaded.",
      });
    }
  }

  function createAuthenticatedProgressionClient() {
    if (!accelByteConfig.matchServiceURL) {
      throw new ProgressionError("configuration", "Match service URL is not configured.");
    }
    return createProgressionClient(stableIam.getAccessToken(), {
      url: accelByteConfig.matchServiceURL,
      namespace: accelByteConfig.namespace,
    });
  }

  async function loadProgression(options?: { retryEmpty?: boolean }) {
    const requestId = ++progressionRequestRef.current;
    setProgressionState({ status: "loading" });
    try {
      let snapshot;
      try {
        snapshot = await createAuthenticatedProgressionClient().get();
      } catch (error) {
        if (
          !(error instanceof ProgressionError) ||
          error.code !== "unauthenticated" ||
          !(await stableIam.refreshAccessToken())
        ) {
          throw error;
        }
        snapshot = await createAuthenticatedProgressionClient().get();
      }
      if (options?.retryEmpty) {
        for (const delayMs of [500, 1_000]) {
          if ((snapshot.progression.lifetime_xp ?? 0) > 0) break;
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          if (requestId !== progressionRequestRef.current) return;
          snapshot = await createAuthenticatedProgressionClient().get();
        }
      }
      if (requestId !== progressionRequestRef.current) {
        return;
      }
      setProgressionState({ status: "ready", snapshot });
    } catch (error) {
      if (requestId !== progressionRequestRef.current) {
        return;
      }
      const safeError =
        error instanceof ProgressionError
          ? { code: error.code, message: error.message }
          : { code: "unknown", message: "Progression could not be loaded." };
      setProgressionState({ status: "error", ...safeError });
    }
  }

  async function loadAchievements() {
    const requestId = ++achievementRequestRef.current;
    setAchievementState({ status: "loading" });
    try {
      const achievements = await createAuthenticatedProgressionClient().getAchievements();
      if (requestId !== achievementRequestRef.current) {
        return;
      }
      setAchievementState({ status: "ready", achievements });
    } catch (error) {
      if (requestId !== achievementRequestRef.current) {
        return;
      }
      const safeError =
        error instanceof ProgressionError
          ? { code: error.code, message: error.message }
          : { code: "unknown", message: "Achievements could not be loaded." };
      setAchievementState({ status: "error", ...safeError });
    }
  }

  // §10.4/§12.1: the onboarding XP is granted whether the player finished the
  // tutorial or intentionally skipped it, so both exits call this. The server
  // award ID makes it once-ever, which is also what stops a replay paying again.
  async function awardOnboardingXP(outcome: OnboardingOutcome) {
    const requestId = ++progressionRequestRef.current;
    try {
      const result = await createAuthenticatedProgressionClient().awardOnboarding(outcome);
      if (requestId !== progressionRequestRef.current) {
        return;
      }
      setProgressionState((current) => ({
        status: "ready",
        snapshot: {
          progression: result.progression,
          curve: current.status === "ready" ? current.snapshot.curve : [],
        },
      }));
    } catch {
      // A failed award must not block leaving the tutorial. It is idempotent,
      // so the next completion or skip retries it harmlessly.
    }
  }

  // --- §10.6 friends -------------------------------------------------------

  async function loadFriends() {
    const requestId = ++friendsRequestRef.current;
    if (isGuestAccount) {
      setFriendsState({ status: "idle" });
      return;
    }
    setFriendsState({ status: "loading" });
    try {
      const client = createAuthenticatedFriendsClient();
      const [friends, incoming, outgoing] = await Promise.all([
        client.list(),
        client.incoming(),
        client.outgoing(),
      ]);
      if (requestId !== friendsRequestRef.current) {
        return;
      }
      setFriendsState({ status: "ready", friends, incoming, outgoing });
    } catch (error) {
      if (requestId !== friendsRequestRef.current) {
        return;
      }
      setFriendsState({ status: "error", ...friendsErrorView(error) });
    }
  }

  // Every mutation re-reads the list rather than patching it locally: AGS owns
  // the relationship, and a local guess about what a request did to it is a
  // guess that can be wrong.
  async function mutateFriends(
    action: (client: ReturnType<typeof createAuthenticatedFriendsClient>) => Promise<void>,
  ): Promise<FriendRequestOutcome> {
    if (isGuestAccount) {
      return {
        ok: false,
        code: "full_account_required",
        message: "Friend requests require a full account.",
      };
    }
    const mutationId = ++friendsMutationRef.current;
    friendsRequestRef.current += 1;
    try {
      await action(createAuthenticatedFriendsClient());
    } catch (error) {
      const safeError = friendsErrorView(error);
      if (mutationId !== friendsMutationRef.current) {
        return { ok: false, ...safeError };
      }
      setFriendsState({ status: "error", ...safeError });
      return { ok: false, ...safeError };
    }
    if (mutationId !== friendsMutationRef.current) {
      // A newer friend action owns the refresh, but this request still
      // succeeded and its own result-screen row should say so.
      return { ok: true };
    }
    await loadFriends();
    return { ok: true };
  }

  async function addResultFriend(userId: string): Promise<FriendRequestOutcome> {
    const outcome = await mutateFriends((client) => client.sendRequest(userId));
    gameTelemetry.track("friend_request_result", {
      dimensions: {
        source: "hand_result",
        outcome: outcome.ok ? "sent" : "failed",
        ...(!outcome.ok ? { reason_code: outcome.code } : {}),
      },
    });
    return outcome;
  }

  // --- §8.6 party ----------------------------------------------------------

  async function loadParty() {
    const requestId = ++partyRequestRef.current;
    if (isGuestAccount) {
      setPartyState({ status: "idle" });
      return;
    }
    setPartyState({ status: "loading" });
    try {
      const party = await createAuthenticatedPartyClient().current();
      if (requestId !== partyRequestRef.current) {
        return;
      }
      setPartyState(party ? { status: "ready", party } : { status: "none" });
    } catch (error) {
      if (requestId !== partyRequestRef.current) {
        return;
      }
      setPartyState({ status: "error", ...partyErrorView(error) });
    }
  }

  async function mutateParty(
    action: (client: ReturnType<typeof createAuthenticatedPartyClient>) => Promise<void>,
  ) {
    if (isGuestAccount) {
      return;
    }
    const mutationId = ++partyMutationRef.current;
    partyRequestRef.current += 1;
    setPartyBusy(true);
    try {
      await action(createAuthenticatedPartyClient());
    } catch (error) {
      if (mutationId !== partyMutationRef.current) {
        return;
      }
      setPartyState({ status: "error", ...partyErrorView(error) });
      setPartyBusy(false);
      return;
    }
    if (mutationId !== partyMutationRef.current) {
      return;
    }
    setPartyBusy(false);
    await loadParty();
  }

  async function loadJadeAccount(
    { preserveReady = false }: { preserveReady?: boolean } = {},
  ): Promise<JadeAccount | null> {
    const requestId = ++jadeRequestRef.current;
    setJadeRecoveryState({ status: "idle" });
    setJadeState((current) =>
      preserveReady && current.status === "ready" ? current : { status: "loading" },
    );
    try {
      let account: JadeAccount;
      try {
        account = await createAuthenticatedJadeClient().getAccount();
      } catch (error) {
        // A hand can outlive the access token used to enter it. Match-runtime
        // requests already renew once on a 401; the lobby balance must do the
        // same or a valid Jade account becomes "Unavailable" on return.
        if (!(error instanceof JadeError) || error.code !== "unauthenticated") {
          throw error;
        }
        const refreshed = await stableIam.refreshAccessToken();
        if (!refreshed) {
          throw error;
        }
        account = await createAuthenticatedJadeClient().getAccount();
      }
      if (requestId !== jadeRequestRef.current) {
        return null;
      }
      setJadeState({ status: "ready", account });
      return account;
    } catch (error) {
      if (requestId !== jadeRequestRef.current) {
        return null;
      }
      setJadeState((current) =>
        preserveReady && current.status === "ready"
          ? current
          : { status: "error", ...jadeErrorView(error) },
      );
      return null;
    }
  }

  async function claimJadeWelfare() {
    if (jadeRecoveryState.status === "claiming") {
      return;
    }
    setJadeRecoveryState({ status: "claiming" });
    try {
      const claim = await createAuthenticatedJadeClient().claimWelfare();
      jadeRequestRef.current += 1;
      setJadeState({ status: "ready", account: claim.account });
      setJadeRecoveryState(
        claim.granted
          ? {
              status: "success",
              message:
                `Recovered ${claim.amount.toLocaleString()} Jade. ` +
                "You can enter Bamboo Courtyard again.",
            }
          : { status: "idle" },
      );
    } catch (error) {
      const safeError = jadeErrorView(error);
      setJadeRecoveryState({
        status: "error",
        message: `${safeError.message} Your balance was not changed.`,
      });
    }
  }

  async function releaseJadeReservation(): Promise<
    { released: true } | { released: false; code: string; message: string }
  > {
    try {
      const account = await createAuthenticatedJadeClient().release();
      jadeRequestRef.current += 1;
      setJadeState({ status: "ready", account });
      return { released: true };
    } catch (error) {
      const safeError = jadeErrorView(error);
      setJadeState({ status: "error", ...safeError });
      return { released: false, ...safeError };
    }
  }

  function reservationReleaseError(
    release: { released: false; code: string; message: string },
  ): MatchmakingState {
    return {
      status: "error",
      code: `jade_release_${release.code}`,
      message:
        `You left the queue, but your Jade reservation may still be held. ${release.message} ` +
        "Retry the release before playing or joining another table.",
      recovery: "release_reservation",
    };
  }

  async function retryJadeReservationRelease() {
    const requestId = ++matchmakingRequestRef.current;
    setMatchmakingState({ status: "releasing" });
    const release = await releaseJadeReservation();
    if (requestId !== matchmakingRequestRef.current) {
      return;
    }
    if (!release.released) {
      setMatchmakingState(reservationReleaseError(release));
      return;
    }
    setOnlineSessionEntryMode("manual");
    setMatchmakingState({ status: "idle" });
  }

  function adoptJadeAccount(view: SeatView) {
    if (view.jade_account) {
      jadeRequestRef.current += 1;
      setJadeState({ status: "ready", account: view.jade_account });
    }
  }

  function adoptProgression(view: SeatView) {
    const progression = view.progression;
    if (!progression) {
      return;
    }
    // A completed-hand projection is newer than any in-flight lobby read.
    progressionRequestRef.current += 1;
    setProgressionState((current) => ({
      status: "ready",
      snapshot: {
        progression,
        curve: current.status === "ready" ? current.snapshot.curve : [],
      },
    }));
  }

  async function findTable() {
    matchmakingModeRef.current = "bamboo_quick_play";
    const requestId = ++matchmakingRequestRef.current;
    const startedAt = Date.now();
    setOnlineSessionEntryMode("matchmaking");
    autoJoiningSessionIdRef.current = null;
    setMatchmakingState({ status: "loading" });
    setQueueStartedAt(startedAt);
    setNowTick(startedAt);
    queueTelemetryRef.current.clear();
    gameTelemetry.track("mode_selected", {
      dimensions: {
        entry_point: "lobby_quick_play",
        mode: "bamboo_quick_play",
        tier: playableTier().id,
      },
    });

    // §8.6 + §7.1: a party queues as one ticket, so AGS seats its members at
    // the same table. Only the leader submits it — every member submitting
    // would create competing tickets for the same people.
    const ownUserId = state.status === "signed_in" ? state.userId : undefined;
    const party = partyState.status === "ready" ? partyState.party : null;
    const partySessionId = party && party.leaderId === ownUserId ? party.partyId : undefined;

    if (party && party.leaderId !== ownUserId) {
      setMatchmakingState({
        status: "error",
        code: "party_member",
        message: "Your party leader starts the queue for everyone.",
      });
      return;
    }

    try {
      const ticket = await createStakedMatchmakingTicket(
        createAuthenticatedJadeClient(),
        createAuthenticatedMatchmakingClient(partySessionId),
        (account) => setJadeState({ status: "ready", account }),
        (account) => setJadeState({ status: "ready", account }),
      );
      if (requestId !== matchmakingRequestRef.current) {
        return;
      }

      if (ticket.matchFound || ticket.sessionId) {
        setMatchmakingState({ status: "matched", ticket });
      } else {
        setMatchmakingState({ status: "searching", ticket });
      }
      gameTelemetry.track("queue_entry_result", {
        dimensions: {
          mode: "bamboo_quick_play",
          outcome: ticket.matchFound || ticket.sessionId ? "matched_immediately" : "queued",
          tier: playableTier().id,
        },
        measurements: { elapsed_ms: Math.max(0, Date.now() - startedAt) },
      });
    } catch (error) {
      if (requestId !== matchmakingRequestRef.current) {
        return;
      }

      const safeError =
        error instanceof JadeError
          ? { code: `jade_${error.code}`, message: error.message }
          : matchmakingErrorView(error);
      setMatchmakingState({ status: "error", ...safeError });
      gameTelemetry.track("queue_entry_result", {
        dimensions: {
          mode: "bamboo_quick_play",
          outcome: "failed",
          reason_code: safeError.code,
          tier: playableTier().id,
        },
        measurements: { elapsed_ms: Math.max(0, Date.now() - startedAt) },
      });
    }
  }

  // §8.4 Full Rotation queue. Deliberately not findTable with a different
  // pool: the mode has its own session template, but shares the selected
  // table tier and its Jade reservation with Quick Play.
  async function findRotationTable() {
    matchmakingModeRef.current = "full_rotation";
    const pool = accelByteConfig.rotationMatchPool;
    if (!pool) return;
    // Ranked play belongs to a durable account. The lobby hides this action
    // for guests, but the guard also protects programmatic/replayed clicks.
    if (isGuestAccount) {
      setMatchmakingState({
        status: "error",
        code: "linked_account_required",
        message: "Create or sign in to a full account before entering Full Rotation.",
      });
      return;
    }
    const requestId = ++matchmakingRequestRef.current;
    const startedAt = Date.now();
    setOnlineSessionEntryMode("matchmaking");
    autoJoiningSessionIdRef.current = null;
    setMatchmakingState({ status: "loading" });
    setQueueStartedAt(startedAt);
    setNowTick(startedAt);
    queueTelemetryRef.current.clear();
    gameTelemetry.track("mode_selected", {
      dimensions: { entry_point: "lobby_full_rotation", mode: "full_rotation" },
    });

    const ownUserId = state.status === "signed_in" ? state.userId : undefined;
    const party = partyState.status === "ready" ? partyState.party : null;
    const partySessionId = party && party.leaderId === ownUserId ? party.partyId : undefined;
    if (party && party.leaderId !== ownUserId) {
      setMatchmakingState({
        status: "error",
        code: "party_member",
        message: "Your party leader starts the queue for everyone.",
      });
      return;
    }

    try {
      const ticket = await createAuthenticatedMatchmakingClient(
        partySessionId,
        pool,
      ).createTicket();
      if (requestId !== matchmakingRequestRef.current) {
        return;
      }
      if (ticket.matchFound || ticket.sessionId) {
        setMatchmakingState({ status: "matched", ticket });
      } else {
        setMatchmakingState({ status: "searching", ticket });
      }
      gameTelemetry.track("queue_entry_result", {
        dimensions: {
          mode: "full_rotation",
          outcome: ticket.matchFound || ticket.sessionId ? "matched_immediately" : "queued",
        },
        measurements: { elapsed_ms: Math.max(0, Date.now() - startedAt) },
      });
    } catch (error) {
      if (requestId !== matchmakingRequestRef.current) {
        return;
      }
      const safeError = matchmakingErrorView(error);
      setMatchmakingState({ status: "error", ...safeError });
      gameTelemetry.track("queue_entry_result", {
        dimensions: {
          mode: "full_rotation",
          outcome: "failed",
          reason_code: safeError.code,
        },
        measurements: { elapsed_ms: Math.max(0, Date.now() - startedAt) },
      });
    }
  }

  async function cancelMatchmaking(ticketOverride?: MatchmakingTicket): Promise<boolean> {
    const ticket =
      ticketOverride ??
      (matchmakingState.status === "searching" ? matchmakingState.ticket : undefined);
    if (!ticket) {
      return false;
    }

    const elapsedMs = Math.max(0, Date.now() - (queueStartedAt ?? Date.now()));
    const matchmakingMode = matchmakingModeRef.current;
    const requestId = ++matchmakingRequestRef.current;
    setMatchmakingState({ status: "canceling", ticket });

    try {
      await createAuthenticatedMatchmakingClient(
        undefined,
        matchPoolForMode(matchmakingMode),
      ).cancelTicket(ticket.ticketId);
      const release =
        matchmakingMode === "bamboo_quick_play"
          ? await releaseJadeReservation()
          : ({ released: true } as const);
      if (requestId !== matchmakingRequestRef.current) {
        return false;
      }
      setOnlineSessionEntryMode("manual");
      if (!release.released) {
        setMatchmakingState(reservationReleaseError(release));
        gameTelemetry.track("queue_cancel_result", {
          dimensions: {
            mode: matchmakingMode,
            outcome: "failed",
            reason_code: `jade_release_${release.code}`,
          },
          measurements: { elapsed_ms: elapsedMs },
        });
        return false;
      }

      setMatchmakingState({ status: "idle" });
      gameTelemetry.track("queue_cancel_result", {
        dimensions: { mode: matchmakingMode, outcome: "canceled" },
        measurements: { elapsed_ms: elapsedMs },
      });
      return true;
    } catch (error) {
      if (requestId !== matchmakingRequestRef.current) {
        return false;
      }

      const safeError = matchmakingErrorView(error);
      setMatchmakingState({
        status: "error",
        code: `cancel_${safeError.code}`,
        message:
          `We could not confirm that you left the queue. ${safeError.message} ` +
          "Retry leaving this queue before playing or joining another table.",
        recovery: "cancel_ticket",
        ticket,
      });
      gameTelemetry.track("queue_cancel_result", {
        dimensions: {
          mode: matchmakingMode,
          outcome: "failed",
          reason_code: `cancel_${safeError.code}`,
        },
        measurements: { elapsed_ms: elapsedMs },
      });
      return false;
    }
  }

  async function retryMatchmakingCancellation() {
    if (
      matchmakingState.status !== "error" ||
      matchmakingState.recovery !== "cancel_ticket" ||
      !matchmakingState.ticket
    ) {
      return;
    }
    await cancelMatchmaking(matchmakingState.ticket);
  }

  // §8.7's alternative to an open-ended wait. The ticket is canceled before a
  // free Practice hand starts. Quick Play also releases its Jade reservation;
  // Full Rotation has no reservation to release.
  async function leaveQueueForPractice() {
    gameTelemetry.track("queue_alternative_selected", {
      dimensions: { alternative: "practice" },
      measurements: {
        elapsed_ms: Math.max(0, Date.now() - (queueStartedAt ?? Date.now())),
      },
    });
    const canceled = await cancelMatchmaking();
    if (!canceled) {
      return;
    }
    await startPracticeHand();
  }

  async function joinMatchedTable() {
    if (matchmakingState.status !== "matched" || !matchmakingState.ticket.sessionId) {
      return;
    }

    const sessionId = matchmakingState.ticket.sessionId;
    const matchmakingMode = matchmakingModeRef.current;
    if (autoJoiningSessionIdRef.current === sessionId) {
      return;
    }
    autoJoiningSessionIdRef.current = sessionId;
    const startedAt = Date.now();
    const matchmakingRequestId = ++matchmakingRequestRef.current;
    const sessionRequestId = ++sessionRequestRef.current;
    setOnlineSessionEntryMode("matchmaking");
    setSessionState({ status: "loading" });

    try {
      const client = createAuthenticatedSessionClient();
      await client.joinSession(sessionId);
      const session = await client.getSession(sessionId);
      if (
        matchmakingRequestId !== matchmakingRequestRef.current ||
        sessionRequestId !== sessionRequestRef.current
      ) {
        if (autoJoiningSessionIdRef.current === sessionId) {
          autoJoiningSessionIdRef.current = null;
        }
        return;
      }

      setSessionState({ status: "loaded", session });
      setJoinSessionId(sessionId);
      setMatchmakingState({ status: "idle" });
      autoJoiningSessionIdRef.current = null;
      gameTelemetry.track("session_join_result", {
        dimensions: {
          entry_point: "matchmaking",
          mode: matchmakingMode,
          outcome: "joined",
        },
        measurements: {
          elapsed_ms: Math.max(0, Date.now() - startedAt),
          member_count: session.members.length,
        },
      });
    } catch (error) {
      if (
        matchmakingRequestId !== matchmakingRequestRef.current ||
        sessionRequestId !== sessionRequestRef.current
      ) {
        if (autoJoiningSessionIdRef.current === sessionId) {
          autoJoiningSessionIdRef.current = null;
        }
        return;
      }

      autoJoiningSessionIdRef.current = null;
      const safeError = sessionErrorView(error);
      setSessionState({ status: "error", ...safeError });
      if (matchmakingMode === "bamboo_quick_play") {
        await releaseJadeReservation();
      }
      gameTelemetry.track("session_join_result", {
        dimensions: {
          entry_point: "matchmaking",
          mode: matchmakingMode,
          outcome: "failed",
          reason_code: safeError.code,
        },
        measurements: { elapsed_ms: Math.max(0, Date.now() - startedAt) },
      });
    }
  }

  async function createTable(
    attributes?: Record<string, unknown>,
  ): Promise<GameSessionSummary | null> {
    const requestId = ++sessionRequestRef.current;
    setOnlineSessionEntryMode("manual");
    setSessionState({ status: "loading" });

    try {
      const session = await createAuthenticatedSessionClient().createSession(attributes);
      if (requestId !== sessionRequestRef.current) {
        return null;
      }

      setJoinSessionId(session.sessionId);
      setSessionState({ status: "loaded", session });
      return session;
    } catch (error) {
      if (requestId !== sessionRequestRef.current) {
        return null;
      }

      const safeError = sessionErrorView(error);
      setSessionState({ status: "error", ...safeError });
      return null;
    }
  }

  function closeMatchRuntime() {
    matchRuntimeRef.current?.close();
    matchRuntimeRef.current = null;
    matchRuntimeMatchIdRef.current = null;
  }

  async function joinTable() {
    const sessionId = joinSessionId.trim();
    if (!sessionId) {
      setSessionState({
        status: "error",
        code: "invalid_input",
        message: "Enter a session ID before joining.",
      });
      return;
    }

    const requestId = ++sessionRequestRef.current;
    setOnlineSessionEntryMode("manual");
    setSessionState({ status: "loading" });

    try {
      const client = createAuthenticatedSessionClient();
      await client.joinSession(sessionId);
      const session = await client.getSession(sessionId);
      if (requestId !== sessionRequestRef.current) {
        return;
      }

      setSessionState({ status: "loaded", session });
    } catch (error) {
      if (requestId !== sessionRequestRef.current) {
        return;
      }

      const safeError = sessionErrorView(error);
      setSessionState({ status: "error", ...safeError });
    }
  }

  async function refreshRoster() {
    if (sessionState.status !== "loaded") {
      return;
    }

    const sessionId = sessionState.session.sessionId;
    const requestId = ++sessionRequestRef.current;
    setSessionState({ status: "loading" });

    try {
      const session = await createAuthenticatedSessionClient().getSession(sessionId);
      if (requestId !== sessionRequestRef.current) {
        return;
      }

      setSessionState({ status: "loaded", session });
    } catch (error) {
      if (requestId !== sessionRequestRef.current) {
        return;
      }

      const safeError = sessionErrorView(error);
      setSessionState({ status: "error", ...safeError });
    }
  }

  // Resolves true when the seat was released cleanly. Play Again reads that:
  // queueing for a new table while the previous seat is still held would
  // strand the old Session (and, for Quick Play, its Jade reservation).
  async function leaveTable(
    sessionIdOverride?: string,
    refreshJade = true,
  ): Promise<boolean> {
    // Leaving the table ends the match for this player: drop the resume pointer
    // so a later reload does not try to rejoin a match they left.
    browserMatchResumeStore.clear();
    const sessionId =
      sessionIdOverride ??
      (sessionState.status === "loaded"
        ? sessionState.session.sessionId
        : sessionState.status === "error"
          ? sessionState.retryLeaveSessionId
          : undefined);
    if (!sessionId) {
      closeMatchRuntime();
      setMatchRuntimeState({ status: "idle" });
      setReconnectAttempt(0);
      setSessionState({ status: "idle" });
      setJoinSessionId("");
      if (refreshJade) {
        await loadJadeAccount({ preserveReady: true });
      }
      void loadProgression();
      void loadStatistics();
      return true;
    }

    const requestId = ++sessionRequestRef.current;
    setSessionState({ status: "loading" });
    closeMatchRuntime();
    setMatchRuntimeState({ status: "idle" });
    setReconnectAttempt(0);
    setOnlineSessionEntryMode("manual");
    autoJoiningSessionIdRef.current = null;

    try {
      await leaveSessionIfPresent(createAuthenticatedSessionClient(), sessionId);
      if (requestId !== sessionRequestRef.current) {
        return false;
      }

      setSessionState({ status: "empty" });
      setJoinSessionId("");
      if (refreshJade) {
        await loadJadeAccount({ preserveReady: true });
      }
      void loadProgression();
      void loadStatistics();
      return true;
    } catch (error) {
      if (requestId !== sessionRequestRef.current) {
        return false;
      }

      const safeError = sessionErrorView(error);
      setSessionState({ status: "error", ...safeError, retryLeaveSessionId: sessionId });
      return false;
    }
  }

  async function connectMatchRuntime(sessionOverride?: GameSessionSummary) {
    const session =
      sessionOverride ?? (sessionState.status === "loaded" ? sessionState.session : null);
    if (!session) {
      return;
    }
    if (!accelByteConfig.matchServiceURL) {
      setMatchRuntimeState({
        status: "error",
        code: "configuration",
        message: "Match service URL is not configured. Restart after updating .env.",
        retry: "runtime",
      });
      return;
    }

    const matchId = session.sessionId;
    closeMatchRuntime();
    setMatchRuntimeState({ status: "connecting", matchId });

    let connection: MatchRuntimeConnection;
    try {
      connection = createMatchRuntimeConnection(matchRuntimeCredentials, {
        url: accelByteConfig.matchServiceURL,
        namespace: accelByteConfig.namespace,
        onJoined: (payload) => {
          if (payload.match_id === matchId && matchRuntimeRef.current === connection) {
            syncFailuresRef.current = 0;
            adoptJadeAccount(payload.view);
            adoptProgression(payload.view);
            setMatchRuntimeState((current) => ({
              status: "joined",
              matchId,
              view: retainAchievementAwards(
                current.status === "joined" ? current.view : undefined,
                payload.view,
              ),
              commandPending: false,
            }));
          }
        },
        onState: (payload) => {
          if (payload.match_id === matchId && matchRuntimeRef.current === connection) {
            // One good response means the link is back; drop straight to the
            // healthy cadence rather than decaying towards it.
            syncFailuresRef.current = 0;
            adoptJadeAccount(payload.view);
            adoptProgression(payload.view);
            setMatchRuntimeState((current) => ({
              status: "joined",
              matchId,
              view: retainAchievementAwards(
                current.status === "joined" ? current.view : undefined,
                payload.view,
              ),
              commandPending: false,
            }));
          }
        },
        // A 304 is a healthy poll with nothing to show: the board is already
        // right, so only the backoff and the stall notice care about it.
        onUnchanged: () => {
          if (matchRuntimeRef.current !== connection) {
            return;
          }
          syncFailuresRef.current = 0;
          setMatchRuntimeState((current) =>
            current.status === "joined" && current.stalled ? { ...current, stalled: undefined } : current,
          );
        },
        onCommandAccepted: () => {
          if (matchRuntimeRef.current === connection) {
            setMatchRuntimeState((current) =>
              current.status === "joined" ? { ...current, commandPending: false } : current,
            );
          }
        },
        onError: (error) => {
          if (matchRuntimeRef.current !== connection) {
            return;
          }
          syncFailuresRef.current += 1;
          const view = matchRuntimeErrorView(error);
          setMatchRuntimeState((current) =>
            // Once the table is up it stays up. Tearing it down on a single
            // failed poll is what made an ordinary server-side error
            // unrecoverable: every seat lost the hand at once with no way
            // back. Hold the last good view and let polling retry.
            current.status === "joined"
              ? {
                  ...current,
                  commandPending: false,
                  stalled: current.stalled ?? { ...view, since: Date.now() },
                }
              : { status: "error", ...view, retry: "runtime" },
          );
        },
      });
      matchRuntimeRef.current = connection;
      matchRuntimeMatchIdRef.current = matchId;
      await connection.ready;
      if (matchRuntimeRef.current === connection) {
        connection.join(matchId);
      }
    } catch (error) {
      if (matchRuntimeRef.current === connection!) {
        closeMatchRuntime();
      }
      setMatchRuntimeState({
        status: "error",
        ...matchRuntimeErrorView(error),
        retry: "runtime",
      });
    }
  }

  // AI Practice is a complete one-hand product flow: create a bot-padded AGS
  // Session, then join its authoritative match immediately. Play Again first
  // leaves the completed Session so every hand gets a fresh identity and wall.
  async function startPracticeHand(previousSessionId?: string) {
    const requestId = ++sessionRequestRef.current;
    let previousSessionLeft = false;
    setOnlineSessionEntryMode("manual");
    autoJoiningSessionIdRef.current = null;
    closeMatchRuntime();
    setReconnectAttempt(0);
    setSessionState({ status: "loading" });
    setMatchRuntimeState({
      status: "preparing",
      message: previousSessionId
        ? "Preparing another Practice hand…"
        : "Preparing your Practice hand…",
    });

    try {
      const client = createAuthenticatedSessionClient();
      const session = await createFreshPracticeSession(client, previousSessionId, () => {
        previousSessionLeft = true;
      });
      if (requestId !== sessionRequestRef.current) {
        // A newer action or unmount won the race after AGS created this
        // Session. Best-effort cleanup prevents the superseded request from
        // leaving an invisible Practice table behind.
        await leaveSessionIfPresent(client, session.sessionId).catch(() => undefined);
        return;
      }

      setJoinSessionId(session.sessionId);
      setSessionState({ status: "loaded", session });
      await connectMatchRuntime(session);
    } catch (error) {
      if (requestId !== sessionRequestRef.current) {
        return;
      }

      const safeError = sessionErrorView(error);
      const retryLeaveSessionId = previousSessionLeft ? undefined : previousSessionId;
      setSessionState({ status: "error", ...safeError, retryLeaveSessionId });
      setMatchRuntimeState({
        status: "error",
        code: `practice_${safeError.code}`,
        message: safeError.message,
        retry: "practice",
        retryPreviousSessionId: retryLeaveSessionId,
      });
    }
  }

  function practiceVsBots() {
    gameTelemetry.track("mode_selected", {
      dimensions: {
        entry_point: "lobby_practice",
        mode: "practice",
      },
    });
    return startPracticeHand();
  }

  function playPracticeAgain() {
    gameTelemetry.track("mode_selected", {
      dimensions: {
        entry_point: "post_hand",
        mode: "practice",
      },
    });
    const previousSessionId =
      sessionState.status === "loaded" ? sessionState.session.sessionId : undefined;
    return startPracticeHand(previousSessionId);
  }

  // §P1.3 session closure. Practice's Play Again only has to deal a new wall.
  // A staked table also has to release the seat, re-check entry eligibility
  // against the balance the hand just changed, and queue a fresh ticket. The
  // eligibility check runs before queueing so a player whose loss dropped them
  // below the threshold learns it here, instead of watching a reservation fail
  // from inside the queue.
  async function playOnlineAgain() {
    if (matchmakingState.status === "loading" || matchmakingState.status === "searching") {
      return;
    }

    const previousSessionId =
      sessionState.status === "loaded" ? sessionState.session.sessionId : undefined;

    setMatchmakingState({ status: "loading" });
    const released = await leaveTable(previousSessionId);
    if (!released) {
      // leaveTable has already surfaced the failure and kept the retry pointer
      // for the stranded seat. Queueing on top of that would strand it further.
      setMatchmakingState({ status: "idle" });
      return;
    }

    // Re-read immediately before committing Jade: settlement for the hand just
    // played may still have been landing when leaveTable refreshed.
    const account = await loadJadeAccount();
    if (!account) {
      setMatchmakingState({ status: "idle" });
      return;
    }

    if (!account.eligible) {
      setMatchmakingState({
        status: "error",
        code: "jade_ineligible",
        message: jadeEntryRequirementMessage(account),
      });
      return;
    }

    await findTable();
  }

  // A completed Full Rotation queues another Full Rotation. It shares the
  // finished-seat cleanup with Quick Play, but deliberately skips every Jade
  // read/reservation/release path because table points are not a currency.
  async function playRotationAgain() {
    if (
      isGuestAccount ||
      matchmakingState.status === "loading" ||
      matchmakingState.status === "searching"
    ) {
      return;
    }

    const previousSessionId =
      sessionState.status === "loaded" ? sessionState.session.sessionId : undefined;

    matchmakingModeRef.current = "full_rotation";
    setMatchmakingState({ status: "loading" });
    const released = await leaveTable(previousSessionId, false);
    if (!released) {
      setMatchmakingState({ status: "idle" });
      return;
    }

    await findRotationTable();
  }

  function sendMatchCommand(command: Omit<MatchCommandRequest, "match_id">) {
    if (matchRuntimeState.status !== "joined" || !matchRuntimeRef.current) {
      return;
    }
    try {
      setMatchRuntimeState({ ...matchRuntimeState, commandPending: true });
      matchRuntimeRef.current.command({
        match_id: matchRuntimeState.matchId,
        ...command,
      });
    } catch (error) {
      setMatchRuntimeState({
        status: "error",
        ...matchRuntimeErrorView(error),
        retry: "runtime",
      });
    }
  }

  function drawTile() {
    if (matchRuntimeState.status !== "joined") {
      return;
    }
    autoDrawStateKeyRef.current =
      `${matchRuntimeState.matchId}:${matchRuntimeState.view.state_version}`;
    sendMatchCommand({
      type: "draw",
      expected_version: matchRuntimeState.view.state_version,
    });
  }

  // Discarding is the player's primary repeated action. The table handles the
  // inspect-first, activate-again interaction and sends only the deliberate
  // second activation here as an authoritative discard command.
  function discardHandTile(tileId: string) {
    if (
      matchRuntimeState.status !== "joined" ||
      matchRuntimeState.commandPending ||
      matchRuntimeState.view.active_seat !== matchRuntimeState.view.seat ||
      matchRuntimeState.view.phase !== "awaiting_discard"
    ) {
      return;
    }
    sendMatchCommand({
      type: "discard",
      expected_version: matchRuntimeState.view.state_version,
      tile_id: tileId,
    });
  }

  // dispatchClaimAction sends whichever legal claim response the match
  // table's action row was clicked for. Every id it can be called with
  // traces back to a ClaimOptionsView the server computed (E8.F3: "no
  // legality computed client-side") via matchTableAdapter's
  // claimLegalActions, not anything guessed here.
  function dispatchClaimAction(actionId: string, tileIds?: [string, string]) {
    if (matchRuntimeState.status !== "joined" || !matchRuntimeState.view.claim) {
      return;
    }
    const claim = matchRuntimeState.view.claim;
    const typeByAction: Record<string, ClaimType> = {
      win: "win",
      pong: "pong",
      kong: "kong",
      pass: "pass",
    };
    const type: ClaimType = actionId.startsWith("chow") ? "chow" : (typeByAction[actionId] ?? "pass");
    if (type === "pass") {
      // Passing a Chow opportunity can immediately advance the same player
      // into awaiting_draw. Clear any prior draw guard so that transition
      // always schedules the routine automatic draw instead of looking like
      // Pass ended the player's turn.
      autoDrawStateKeyRef.current = null;
    }
    sendMatchCommand({
      type: "submit_claim",
      expected_version: matchRuntimeState.view.state_version,
      claim: {
        action_id: claim.action_id,
        type,
        tile_ids: tileIds,
        state_version: matchRuntimeState.view.state_version,
        response_revision: claim.own_response ? claim.own_response.response_revision + 1 : 0,
        // deliberate only matters for Pass — a genuine human Pass on a
        // legal Win is what creates the §5.8 discard-Win lock; it has no
        // meaning for Win/Pong/Kong/Chow itself.
        deliberate: type === "pass",
      },
    });
  }

  function dispatchSelfTurnAction(actionId: string, tileIds?: string[]) {
    if (
      matchRuntimeState.status !== "joined" ||
      matchRuntimeState.commandPending ||
      matchRuntimeState.view.phase !== "awaiting_discard" ||
      matchRuntimeState.view.active_seat !== matchRuntimeState.view.seat
    ) {
      return;
    }
    if (actionId === "win-self") {
      sendMatchCommand({
        type: "declare_zimo",
        expected_version: matchRuntimeState.view.state_version,
      });
      return;
    }
    if (actionId === "kong-concealed" && tileIds?.length === 4) {
      sendMatchCommand({
        type: "declare_concealed_kong",
        expected_version: matchRuntimeState.view.state_version,
        tile_ids: tileIds,
      });
      return;
    }
    if (actionId === "kong-added" && tileIds?.length === 1) {
      sendMatchCommand({
        type: "declare_added_kong",
        expected_version: matchRuntimeState.view.state_version,
        tile_id: tileIds[0],
      });
    }
  }

  async function enterGameFullscreen() {
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    try {
      if (document.fullscreenElement) {
        return;
      }
      if (root.requestFullscreen) {
        await root.requestFullscreen();
        return;
      }
      if (root.webkitRequestFullscreen) {
        await root.webkitRequestFullscreen();
        return;
      }
    } catch {
      // iPhone Safari may expose the API but reject it outside installed
      // web-app mode. Fall through to the Add to Home Screen instruction.
    }
    window.scrollTo({ top: 1, behavior: "smooth" });
    setFullscreenHelp(true);
    window.setTimeout(() => setFullscreenHelp(false), 8_000);
  }

  const birthYearOptions = Array.from({ length: 100 }, (_, index) => new Date().getFullYear() - index);
  const hasActiveOrStrandedSession =
    sessionState.status === "loaded" ||
    (sessionState.status === "error" && Boolean(sessionState.retryLeaveSessionId));
  const onboardingOutcome =
    progressionState.status === "ready"
      ? progressionState.snapshot.progression.onboarding?.outcome
      : undefined;

  if (achievementsOpen) {
    return (
      <div className="game-screen">
        {achievementState.status === "ready" ? (
          <AchievementScreen
            achievements={achievementState.achievements}
            onClose={() => setAchievementsOpen(false)}
          />
        ) : (
          <section className="achievement-screen" aria-labelledby="achievement-title">
            <header className="achievement-header">
              <div>
                <p className="status-label">{t("progression.label")}</p>
                <h2 id="achievement-title">{t("progression.achievements")}</h2>
              </div>
              <button
                type="button"
                className="secondary-action"
                onClick={() => setAchievementsOpen(false)}
              >
                Back to Progress
              </button>
            </header>
            {achievementState.status === "error" ? (
              <div className="session-error" role="alert">
                <p>{achievementState.message}</p>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => void loadAchievements()}
                >
                  {t("achievement.retry")}
                </button>
              </div>
            ) : (
              <p className="status-message" role="status" aria-live="polite">
                {t("achievement.loading")}
              </p>
            )}
          </section>
        )}
      </div>
    );
  }

  // The tutorial owns the screen for the same reason a live match does, and
  // takes precedence over the lobby beneath it. It cannot open over a live
  // match: the lobby is the only place it can be started from.
  if (progressionOpen && progressionState.status === "ready") {
    return (
      <div className="game-screen">
        <ProgressionScreen
          progression={progressionState.snapshot.progression}
          curve={progressionState.snapshot.curve}
          onClose={() => {
            setAchievementsOpen(false);
            setProgressionOpen(false);
          }}
          onOpenAchievements={() => {
            setAchievementsOpen(true);
            if (achievementState.status !== "ready") {
              void loadAchievements();
            }
          }}
        />
      </div>
    );
  }

  if (statisticsOpen) {
    return (
      <div className="game-screen">
        {statisticsState.status === "ready" ? (
          <StatisticsScreen
            summary={statisticsState.summary}
            history={statisticsState.history}
            onClose={() => setStatisticsOpen(false)}
            onPlay={() => {
              setStatisticsOpen(false);
              void findTable();
            }}
          />
        ) : (
          <section className="statistics-screen" aria-labelledby="statistics-title">
            <header className="statistics-header">
              <div>
                <p className="status-label">{t("statistics.label")}</p>
                <h2 id="statistics-title">{t("statistics.quickPlay")}</h2>
              </div>
              <button type="button" className="statistics-close" onClick={() => setStatisticsOpen(false)}>
                {t("common.close")}
              </button>
            </header>
            {statisticsState.status === "error" ? (
              <div className="session-error" role="alert">
                <p>{statisticsState.message}</p>
                <button type="button" className="secondary-action" onClick={() => void loadStatistics()}>
                  {t("common.retry")}
                </button>
              </div>
            ) : (
              <p className="status-message" role="status" aria-live="polite">
                {t("statistics.loading")}
              </p>
            )}
          </section>
        )}
      </div>
    );
  }

  if (settingsOpen) {
    return (
      <div className="game-screen">
        <SettingsScreen
          settings={playerSettings}
          syncStatus={settingsSyncStatus === "idle" ? "loading" : settingsSyncStatus}
          onSettingsChange={(settings) => void updatePlayerSettings(settings)}
          onClose={() => setSettingsOpen(false)}
          onRetry={() => void loadPlayerSettings()}
        />
      </div>
    );
  }

  if (storeOpen) {
    return (
      <div className="game-screen">
        <section className="placeholder-screen" aria-labelledby="store-title">
          <p className="status-label">{t("header.store")}</p>
          <h1 id="store-title">{t("store.comingSoon")}</h1>
          <p>{t("store.placeholder")}</p>
          <button type="button" className="secondary-action" onClick={() => setStoreOpen(false)}>
            {t("common.backToLobby")}
          </button>
        </section>
      </div>
    );
  }

  if (feedbackSessionId !== undefined) {
    return (
      <div className="game-screen">
        <FeedbackScreen
          sessionId={feedbackSessionId ?? undefined}
          onSubmit={submitFeedback}
          onClose={() => setFeedbackSessionId(undefined)}
        />
      </div>
    );
  }

  if (tutorialOpen) {
    return (
      <div className="game-screen">
        <TutorialScreen
          analytics={recordTutorialEvent}
          onExit={(outcome) => {
            setTutorialOpen(false);
            // §10.4 pays the same XP either way, but the server records which
            // exit was taken, so the two are not collapsed here.
            void awardOnboardingXP(
              outcome === "completed"
                ? "ONBOARDING_OUTCOME_COMPLETED"
                : "ONBOARDING_OUTCOME_SKIPPED",
            );
          }}
        />
      </div>
    );
  }

  // Once a player has started joining a match, the whole screen belongs to
  // the game — no session ID, roster, or lobby chrome competing for
  // attention. This covers the join/reconnect wait, the live table, the
  // hand result, and a runtime error, all the way back to "idle" (leaving
  // the table resets matchRuntimeState to idle, returning to the lobby).
  if (matchRuntimeState.status !== "idle") {
    return (
      <div className="game-screen">
        {matchRuntimeState.status === "preparing" && (
          <div className="game-screen-status" role="status" aria-live="assertive">
            <p className="game-screen-status-text">{translateSource(matchRuntimeState.message)}</p>
          </div>
        )}

        {matchRuntimeState.status === "connecting" && (
          <div className="game-screen-status" role="status" aria-live="assertive">
            <p className="game-screen-status-text">
              {reconnectAttempt > 0
                ? t("game.reconnectingAttempt", {
                    attempt: reconnectAttempt,
                    maximum: MAX_RECONNECT_ATTEMPTS,
                  })
                : t("game.joiningTable")}
            </p>
          </div>
        )}

        {matchRuntimeState.status === "joined" && matchRuntimeState.stalled && (
          <div className="game-screen-stalled" role="status" aria-live="polite" data-testid="table-stalled-notice">
            <p className="game-screen-stalled-text">
              {t("game.reconnectingStalled")}
            </p>
          </div>
        )}

        {matchRuntimeState.status === "joined" &&
          (matchRuntimeState.view.phase === "hand_complete" ||
          matchRuntimeState.view.phase === "exhaustive_draw" ? (
            <div className="game-screen-result">
              <CompletedHandFlow
                view={matchRuntimeState.view}
                practice={isPracticeMatch(matchRuntimeState.view)}
                revealTable={
                  <div
                    className="match-table-frame"
                    data-testid="winning-table-reveal"
                    data-match-id={matchRuntimeState.matchId}
                    data-local-seat={matchRuntimeState.view.seat}
                  >
                    <MatchTable
                      state={seatViewToMatchTableState(matchRuntimeState.view, {
                        now: nowTick,
                        onClaimAction: dispatchClaimAction,
                        onSelfTurnAction: dispatchSelfTurnAction,
                        claimActionPending: true,
                        revealWinningHands: true,
                      })}
                      playerProfile={playerProfile}
                    />
                  </div>
                }
                onPlayAgain={
                  isPracticeMatch(matchRuntimeState.view)
                    ? playPracticeAgain
                    : matchRuntimeState.view.rotation
                      ? matchRuntimeState.view.rotation.complete &&
                        onlineSessionEntryMode === "matchmaking" &&
                        accelByteConfig.rotationMatchPool &&
                        !isGuestAccount
                        ? () => void playRotationAgain()
                        : undefined
                    : // Online Play Again requeues through matchmaking, so it
                      // is only honest to offer it where a pool exists to queue
                      // into. Manually joined dev tables fall through to Return.
                      onlineSessionEntryMode === "matchmaking" && accelByteConfig.matchPool
                      ? () => void playOnlineAgain()
                      : undefined
                }
                playAgainNote={
                  isPracticeMatch(matchRuntimeState.view) || matchRuntimeState.view.rotation
                    ? undefined
                    : stakeSummary(matchRuntimeState.view.jade_account)
                }
                onReturn={() => void leaveTable()}
                accountUpgrade={
                  isGuestAccount ? (
                    <AccountUpgradeCard
                      onRequestCode={(email) => stableIam.requestGuestUpgradeCode(email)}
                      onUpgrade={(input) => stableIam.upgradeGuestAccount(input)}
                      onUpgraded={() => setIsGuestAccount(false)}
                    />
                  ) : undefined
                }
                resultFriends={resultFriendsForCurrentMatch}
                onAddResultFriend={
                  resultFriendsForCurrentMatch ? addResultFriend : undefined
                }
                onRetryResultFriends={
                  resultFriendsForCurrentMatch ? () => void loadFriends() : undefined
                }
                onReportIssue={() => setFeedbackSessionId(matchRuntimeState.matchId)}
                viewerUserId={rotationViewerUserId}
                nameOf={rotationNameOf}
              />
            </div>
          ) : introducedMatchId !== matchRuntimeState.matchId ? (
            <MatchLoadingScreen
              view={matchRuntimeState.view}
              playerProfile={playerProfile}
            />
          ) : (
            <>
              <div className="game-screen-fullscreen">
                {fullscreenHelp ? (
                  <p className="fullscreen-help" role="status">
                    {t("game.fullscreenHelp")}
                  </p>
                ) : null}
                <button
                  className="fullscreen-match-button"
                  type="button"
                  onClick={() => void enterGameFullscreen()}
                  aria-label={t("game.enterFullscreen")}
                >
                  <span aria-hidden="true">⛶</span>
                  <span>{t("game.fullscreen")}</span>
                </button>
              </div>
              <div className="game-screen-topbar">
                {controlRestoredNotice && (
                  <p className="control-restored-toast" role="status" aria-live="polite">
                    {t("game.controlRestored")}
                  </p>
                )}
                <button
                  className="leave-match-button"
                  type="button"
                  onClick={() => void leaveTable()}
                >
                  {t("game.leaveMatch")}
                </button>
              </div>
              {videoHumanSeats.length > 0 && (
                <div className="video-call-dock">
                  <VideoCallPanel
                    controller={videoController}
                    humanSeats={videoHumanSeats}
                    seatName={() => t("game.player")}
                  />
                </div>
              )}
              {matchRuntimeState.view.rotation ? (
                <RotationPanel
                  rotation={matchRuntimeState.view.rotation}
                  viewerUserId={rotationViewerUserId}
                  nameOf={rotationNameOf}
                />
              ) : null}
              <div
                className="match-table-frame"
                data-testid="live-match"
                data-match-id={matchRuntimeState.matchId}
                data-local-seat={matchRuntimeState.view.seat}
              >
                <MatchTable
                  state={seatViewToMatchTableState(matchRuntimeState.view, {
                    now: nowTick,
                    onClaimAction: dispatchClaimAction,
                    onSelfTurnAction: dispatchSelfTurnAction,
                    claimActionPending: matchRuntimeState.commandPending,
                  })}
                  playerProfile={playerProfile}
                  interaction={{
                    canDraw:
                      matchRuntimeState.view.active_seat === matchRuntimeState.view.seat &&
                      matchRuntimeState.view.phase === "awaiting_draw",
                    onDraw: drawTile,
                    drawPending: matchRuntimeState.commandPending,
                    canDiscard:
                      matchRuntimeState.view.active_seat === matchRuntimeState.view.seat &&
                      matchRuntimeState.view.phase === "awaiting_discard",
                    onDiscardTile: discardHandTile,
                    discardPending: matchRuntimeState.commandPending,
                  }}
                />
              </div>
            </>
          ))}

        {matchRuntimeState.status === "error" && (
          <div className="game-screen-status" role="alert">
            <p className="game-screen-status-text">{translateSource(matchRuntimeState.message)}</p>
            <p className="error-code">
              {t("common.errorCode", {
                code: matchRuntimeState.retry === "practice"
                  ? matchRuntimeState.code
                  : `match_runtime_${matchRuntimeState.code}`,
              })}
            </p>
            <div className="game-screen-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={() => {
                  if (matchRuntimeState.retry === "practice") {
                    void startPracticeHand(matchRuntimeState.retryPreviousSessionId);
                  } else {
                    void connectMatchRuntime();
                  }
                }}
              >
                {matchRuntimeState.retry === "practice" ? t("game.retryPractice") : t("game.reconnect")}
              </button>
              <button
                className="leave-match-button"
                type="button"
                onClick={() => void leaveTable()}
              >
                {t("game.leaveMatch")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="bootstrap-shell">
      <section className="bootstrap-card" aria-labelledby="bootstrap-title">
        <h1 id="bootstrap-title" className="mahjong-online-title">
          {t("auth.title")} <small>{t("auth.alpha")}</small>
        </h1>
        {state.status === "idle" && (
          <>
            <button className="primary-action" type="button" onClick={signInAsGuest}>
              {t("auth.continueGuest")}
            </button>

            <div className="analytics-consent">
              <label className="email-auth-checkbox-label">
                <input
                  type="checkbox"
                  checked={optionalAnalyticsConsent}
                  onChange={(event) => updateOptionalAnalyticsConsent(event.target.checked)}
                />
                {t("auth.analyticsConsent")}
              </label>
              <p>{t("auth.analyticsDetail")}</p>
            </div>

            <div className="email-auth-panel">
              <div className="email-auth-tabs" role="tablist" aria-label={t("auth.methodLabel")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={emailAuthTab === "signin"}
                  className={`email-auth-tab${emailAuthTab === "signin" ? " email-auth-tab-active" : ""}`}
                  onClick={() => {
                    setEmailAuthTab("signin");
                    setEmailAuthState({ status: "idle" });
                    setEmailCodeRequested(false);
                  }}
                >
                  {t("auth.signIn")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={emailAuthTab === "register"}
                  className={`email-auth-tab${emailAuthTab === "register" ? " email-auth-tab-active" : ""}`}
                  onClick={() => {
                    setEmailAuthTab("register");
                    setEmailAuthState({ status: "idle" });
                    setEmailCodeRequested(false);
                  }}
                >
                  {t("auth.createAccount")}
                </button>
              </div>

              {emailAuthTab === "signin" && (
                <form
                  className="email-auth-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void signInWithEmail();
                  }}
                >
                  <label className="session-input-label" htmlFor="signin-email">
                    {t("auth.email")}
                  </label>
                  <input
                    id="signin-email"
                    className="session-input"
                    type="email"
                    autoComplete="email"
                    required
                    value={emailForm.email}
                    onChange={(event) => updateEmailForm({ email: event.target.value })}
                  />
                  <label className="session-input-label" htmlFor="signin-password">
                    {t("auth.password")}
                  </label>
                  <input
                    id="signin-password"
                    className="session-input"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={emailForm.password}
                    onChange={(event) => updateEmailForm({ password: event.target.value })}
                  />
                  <button
                    type="submit"
                    className="secondary-action session-action"
                    disabled={emailAuthState.status === "working"}
                  >
                    {emailAuthState.status === "working" ? t("auth.signingIn") : t("auth.signInEmail")}
                  </button>
                </form>
              )}

              {emailAuthTab === "register" && (
                <form
                  className="email-auth-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (emailCodeRequested) {
                      void registerWithEmail();
                    } else {
                      void requestEmailVerificationCode();
                    }
                  }}
                >
                  <label className="session-input-label" htmlFor="register-email">
                    {t("auth.email")}
                  </label>
                  <input
                    id="register-email"
                    className="session-input"
                    type="email"
                    autoComplete="email"
                    required
                    disabled={emailCodeRequested}
                    value={emailForm.email}
                    onChange={(event) => updateEmailForm({ email: event.target.value })}
                  />

                  {!emailCodeRequested ? (
                    <button
                      type="submit"
                      className="secondary-action session-action"
                      disabled={emailAuthState.status === "working" || !emailForm.email}
                    >
                      {emailAuthState.status === "working" ? t("auth.sendingCode") : t("auth.sendCode")}
                    </button>
                  ) : (
                    <>
                      <label className="session-input-label" htmlFor="register-code">
                        {t("auth.verificationCode")}
                      </label>
                      <input
                        id="register-code"
                        className="session-input"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                        value={emailForm.code}
                        onChange={(event) => updateEmailForm({ code: event.target.value })}
                      />

                      <label className="session-input-label" htmlFor="register-username">
                        {t("auth.username")}
                      </label>
                      <input
                        id="register-username"
                        className="session-input"
                        type="text"
                        autoComplete="username"
                        required
                        value={emailForm.username}
                        onChange={(event) => updateEmailForm({ username: event.target.value })}
                      />

                      <label className="session-input-label" htmlFor="register-password">
                        {t("auth.password")}
                      </label>
                      <input
                        id="register-password"
                        className="session-input"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={emailForm.password}
                        onChange={(event) => updateEmailForm({ password: event.target.value })}
                      />

                      <label className="session-input-label" htmlFor="register-country">
                        {t("auth.country")}
                      </label>
                      <select
                        id="register-country"
                        className="session-input"
                        value={emailForm.country}
                        onChange={(event) => updateEmailForm({ country: event.target.value })}
                      >
                        {CLOSED_BETA_COUNTRIES.map((country) => (
                          <option key={country.code} value={country.code}>
                            {displayCountryName(country.code, country.name)}
                          </option>
                        ))}
                      </select>

                      <span className="session-input-label">{t("auth.birthMonthYear")}</span>
                      <div className="email-auth-row">
                        <select
                          aria-label={t("auth.birthMonthLabel")}
                          className="session-input"
                          required
                          value={emailForm.birthMonth}
                          onChange={(event) => updateEmailForm({ birthMonth: event.target.value })}
                        >
                          <option value="" disabled>
                            {t("auth.month")}
                          </option>
                          {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                            <option key={month} value={month}>
                              {month}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={t("auth.birthYearLabel")}
                          className="session-input"
                          required
                          value={emailForm.birthYear}
                          onChange={(event) => updateEmailForm({ birthYear: event.target.value })}
                        >
                          <option value="" disabled>
                            {t("auth.year")}
                          </option>
                          {birthYearOptions.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </div>

                      <label className="email-auth-checkbox-label">
                        <input
                          type="checkbox"
                          checked={emailForm.ageConfirmed}
                          onChange={(event) => updateEmailForm({ ageConfirmed: event.target.checked })}
                        />
                        {t("auth.ageConfirm")}
                      </label>

                      <button
                        type="submit"
                        className="secondary-action session-action"
                        disabled={emailAuthState.status === "working"}
                      >
                        {emailAuthState.status === "working" ? t("auth.creatingAccount") : t("auth.createAccount")}
                      </button>
                    </>
                  )}
                </form>
              )}

              {emailAuthState.status === "error" && (
                <div className="session-error" role="alert">
                  <p>{emailAuthState.message}</p>
                </div>
              )}
            </div>
          </>
        )}

        {state.status === "signing_in" && (
          <p className="status-message" role="status" aria-live="polite">
            {t("auth.signingIn")}
          </p>
        )}

        {state.status === "signed_in" && (
          <div className="success-panel">
            <LobbyHeader
              guest={isGuestAccount}
              account={jadeState.status === "ready" ? jadeState.account : undefined}
              jadeStatus={jadeState.status}
              connection={state.lobbyStatus}
              progression={
                progressionState.status === "ready"
                  ? progressionState.snapshot.progression
                  : undefined
              }
              progressionStatus={progressionState.status}
              statistics={
                statisticsState.status === "ready" ? statisticsState.summary : undefined
              }
              onOpenProgress={() => {
                setAchievementsOpen(false);
                setProgressionOpen(true);
                if (
                  progressionState.status !== "ready" ||
                  progressionState.snapshot.curve.length === 0
                ) {
                  void loadProgression();
                }
              }}
              onOpenStatistics={() => {
                setStatisticsOpen(true);
                if (statisticsState.status !== "ready") {
                  void loadStatistics();
                }
              }}
              profile={playerProfile}
              onProfileChange={updatePlayerProfile}
              onOpenStore={() => setStoreOpen(true)}
              onCreateAccount={() => setAccountUpgradeOpen(true)}
            />

            {isGuestAccount && accountUpgradeOpen ? (
              <div className="lobby-account-upgrade">
                <AccountUpgradeCard
                  onRequestCode={(email) => stableIam.requestGuestUpgradeCode(email)}
                  onUpgrade={(input) => stableIam.upgradeGuestAccount(input)}
                  onUpgraded={() => {
                    setIsGuestAccount(false);
                    setAccountUpgradeOpen(false);
                  }}
                />
              </div>
            ) : null}

            {progressionOpen && progressionState.status === "error" && (
              <div className="session-error progression-load-error" role="alert">
                <p>{progressionState.message}</p>
                <div className="progression-load-actions">
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => void loadProgression()}
                  >
                    {t("progression.retry")}
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => setProgressionOpen(false)}
                  >
                    {t("common.dismiss")}
                  </button>
                </div>
              </div>
            )}

            {state.lobbyStatus === "connected" && (
              <div className="session-panel">
                {playerSettings.showTutorial && (
                <section className="tutorial-card" aria-labelledby="tutorial-title">
                  <h2 id="tutorial-title" className="tutorial-heading">{t("lobby.learnTitle")}</h2>
                  <p className="practice-description">
                    {onboardingOutcome === "ONBOARDING_OUTCOME_COMPLETED"
                      ? t("lobby.learnReplay")
                      : onboardingOutcome === "ONBOARDING_OUTCOME_SKIPPED"
                        ? t("lobby.learnResume")
                        : t("lobby.learnNew")}
                  </p>
                  <button
                    className="secondary-action session-action"
                    type="button"
                    onClick={() => {
                      gameTelemetry.track("mode_selected", {
                        dimensions: {
                          entry_point: "lobby_tutorial",
                          mode: "tutorial",
                        },
                      });
                      setTutorialOpen(true);
                    }}
                  >
                    {onboardingOutcome === "ONBOARDING_OUTCOME_COMPLETED"
                      ? t("lobby.replayTutorial")
                      : onboardingOutcome === "ONBOARDING_OUTCOME_SKIPPED"
                        ? t("lobby.continueTutorial")
                        : t("lobby.startTutorial")}
                  </button>
                  <button
                    className="text-action tutorial-hide-action"
                    type="button"
                    aria-label={t("common.hide")}
                    onClick={() =>
                      void updatePlayerSettings({
                        ...playerSettings,
                        showTutorial: false,
                      })
                    }
                  >
                    {t("common.hide")}
                  </button>
                </section>
                )}

                <PracticeLaunchCard
                  busy={
                    sessionState.status === "loading" || matchmakingBlocksSessionActions
                  }
                  hasSelectedSession={hasActiveOrStrandedSession}
                  cleanupRequired={
                    sessionState.status === "error" &&
                    Boolean(sessionState.retryLeaveSessionId)
                  }
                  matchServiceAvailable={Boolean(accelByteConfig.matchServiceURL)}
                  onStart={() => void practiceVsBots()}
                  onLeaveSelectedSession={() => void leaveTable()}
                />

                <section className="practice-card online-play-card" aria-labelledby="online-title">
                  <p className="status-label">{t("lobby.playOnline")}</p>
                  <h2 id="online-title">
                    {t("lobby.playAtTier", { tier: tierName(playableTier()) })}
                  </h2>
                  <p className="practice-description">{t("lobby.onlineDescription")}</p>
                  <p className="practice-description">{tierSummary(playableTier())}</p>

                  {jadeState.status === "loading" && (
                    <p className="matchmaking-result" aria-live="polite">
                      {t("lobby.loadingJade")}
                    </p>
                  )}

                  {jadeState.status === "error" && (
                    <div className="matchmaking-result" role="alert">
                      <p>{jadeState.message}</p>
                      <button
                        className="secondary-action session-action"
                        type="button"
                        onClick={() => void loadJadeAccount()}
                      >
                        {t("lobby.retryBalance")}
                      </button>
                    </div>
                  )}

                  {jadeState.status === "ready" && (
                    <div className="jade-balance" data-testid="jade-balance">
                      <p>{t("lobby.jadeAvailable", { count: formatNumber(jadeState.account.available) })}</p>
                      {jadeState.account.reserved > 0 && (
                        <p className="session-detail">
                          {t("lobby.jadeReserved", { count: formatNumber(jadeState.account.reserved) })}
                        </p>
                      )}
                      {!jadeState.account.eligible && (
                        <p className="session-detail">
                          {jadeEntryRequirementMessage(jadeState.account)}
                        </p>
                      )}
                    </div>
                  )}

                  {jadeState.status === "ready" && (
                    <JadeRecoveryCard
                      account={jadeState.account}
                      state={jadeRecoveryState}
                      onClaim={() => void claimJadeWelfare()}
                    />
                  )}

                  {!accelByteConfig.matchPool && matchmakingState.status === "idle" && (
                    <p className="matchmaking-result" role="status" aria-live="polite">
                      {t("lobby.poolUnavailable")}
                    </p>
                  )}

                  {accelByteConfig.matchPool && matchmakingState.status === "idle" && (
                    <button
                      className="primary-action session-action"
                      type="button"
                      onClick={findTable}
                      disabled={
                        sessionState.status === "loading" ||
                        hasActiveOrStrandedSession ||
                        jadeState.status !== "ready" ||
                        !jadeState.account.eligible
                      }
                    >
                      {t("lobby.findTable")}
                    </button>
                  )}
                </section>

                {matchmakingState.status !== "idle" && (
                  <section
                    className="matchmaking-panel online-card"
                    aria-label={t("lobby.matchmakingLabel", {
                      mode:
                        matchmakingModeRef.current === "full_rotation"
                          ? t("lobby.fullRotation")
                          : t("lobby.quickPlay"),
                    })}
                  >
                    <p className="status-label">
                      {matchmakingModeRef.current === "full_rotation"
                        ? t("lobby.fullRotationQueue")
                        : t("lobby.quickPlayQueue")}
                    </p>

                    {matchmakingState.status === "loading" && (
                      <p className="matchmaking-result" role="status" aria-live="polite">
                        {t("lobby.joiningQueue")}
                      </p>
                    )}

                    {matchmakingState.status === "releasing" && (
                      <p className="matchmaking-result" role="status" aria-live="polite">
                        {t("lobby.releasingJade")}
                      </p>
                    )}

                    {(matchmakingState.status === "searching" ||
                      matchmakingState.status === "canceling") && (
                      <div
                        className={`matchmaking-result queue-panel queue-${currentQueueHealth}`}
                        role="status"
                        aria-live="polite"
                      >
                        <p className="queue-message">{queueHealthMessage(currentQueueHealth)}</p>
                        <p className="queue-elapsed">{queueElapsedLabel(queueElapsedMs)}</p>

                        {/* §8.7: at 90 seconds the player gets a way out of an
                            open-ended wait rather than a spinner and a guess. */}
                        {currentQueueHealth === "slow" &&
                          matchmakingState.status === "searching" && (
                            <div className="queue-alternatives">
                              <p className="session-detail">
                                {t("lobby.queueAlternative")}
                              </p>
                              <button
                                className="secondary-action session-action"
                                type="button"
                                onClick={() => void leaveQueueForPractice()}
                              >
                                {t("lobby.practiceInstead")}
                              </button>
                            </div>
                          )}

                        <button
                          className="secondary-action session-action"
                          type="button"
                          onClick={() => void cancelMatchmaking()}
                          disabled={matchmakingState.status === "canceling"}
                        >
                          {matchmakingState.status === "canceling" ? t("lobby.leavingQueue") : t("common.cancel")}
                        </button>

                        <p className="session-detail queue-ticket">
                          {t("lobby.ticket", { id: sessionIdFragment(matchmakingState.ticket.ticketId) })}
                        </p>
                      </div>
                    )}

                    {matchmakingState.status === "matched" && (
                      <div className="matchmaking-result" role="status" aria-live="polite">
                        <p className="status-label">{t("lobby.matchFound")}</p>
                        {matchmakingState.ticket.sessionId ? (
                          <>
                            <p className="session-detail">
                              {t("lobby.joiningTable")}
                            </p>
                            {sessionState.status === "error" && (
                              <button
                                className="secondary-action session-action"
                                type="button"
                                onClick={joinMatchedTable}
                              >
                                {t("lobby.retryJoin")}
                              </button>
                            )}
                          </>
                        ) : (
                          <p>{t("lobby.agsNoSession")}</p>
                        )}
                      </div>
                    )}

                    {matchmakingState.status === "error" && (
                      <div className="session-error" role="alert">
                        <p>{matchmakingState.message}</p>
                        <p className="error-code">
                          {t("common.errorCode", { code: `matchmaking_${matchmakingState.code}` })}
                        </p>
                        {/* Ineligible Jade and a guest identity are durable
                            eligibility failures; retrying cannot change them. */}
                        {matchmakingState.recovery === "cancel_ticket" ? (
                          <button
                            className="secondary-action session-action"
                            type="button"
                            onClick={() => void retryMatchmakingCancellation()}
                          >
                            {t("lobby.retryLeaveQueue")}
                          </button>
                        ) : matchmakingState.recovery === "release_reservation" ? (
                          <button
                            className="secondary-action session-action"
                            type="button"
                            onClick={() => void retryJadeReservationRelease()}
                          >
                            {t("lobby.retryReleaseJade")}
                          </button>
                        ) : matchmakingState.code !== "jade_ineligible" &&
                          matchmakingState.code !== "linked_account_required" ? (
                          <button
                            className="secondary-action session-action"
                            type="button"
                            onClick={() =>
                              void (matchmakingModeRef.current === "full_rotation"
                                ? findRotationTable()
                                : findTable())
                            }
                          >
                            {t("lobby.retryMatchmaking")}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </section>
                )}

                <LockedTiers />

                {!isGuestAccount && (
                  <>
                    <PartyPanel
                      state={partyState}
                      ownUserId={state.userId}
                      busy={partyBusy}
                      onCreate={() => void mutateParty(async (c) => { await c.create(); })}
                      onLeave={() =>
                        void mutateParty(async (c) => {
                          if (partyState.status === "ready") {
                            await c.leave(partyState.party.partyId);
                          }
                        })
                      }
                      onJoinByCode={(code) =>
                        void mutateParty(async (c) => { await c.joinByCode(code); })
                      }
                      onGenerateCode={() =>
                        void mutateParty(async (c) => {
                          if (partyState.status === "ready") {
                            await c.generateCode(partyState.party.partyId);
                          }
                        })
                      }
                      onKick={(userId) =>
                        void mutateParty(async (c) => {
                          if (partyState.status === "ready") {
                            await c.kick(partyState.party.partyId, userId);
                          }
                        })
                      }
                      onRetry={() => void loadParty()}
                    />

                    <FriendsPanel
                      state={friendsState}
                      ownUserId={state.userId}
                      canInviteToParty={
                        partyState.status === "ready" && !partyIsFull(partyState.party)
                      }
                      onInviteToParty={
                        partyState.status === "ready"
                          ? (userId) =>
                              void mutateParty(async (c) => {
                                if (partyState.status === "ready") {
                                  await c.invite(partyState.party.partyId, userId);
                                }
                              })
                          : undefined
                      }
                      onAdd={(userId) => void mutateFriends((c) => c.sendRequest(userId))}
                      onAccept={(userId) => void mutateFriends((c) => c.accept(userId))}
                      onReject={(userId) => void mutateFriends((c) => c.reject(userId))}
                      onCancel={(userId) => void mutateFriends((c) => c.cancel(userId))}
                      onUnfriend={(userId) => void mutateFriends((c) => c.unfriend(userId))}
                      onRetry={() => void loadFriends()}
                    />
                  </>
                )}

                <button
                  type="button"
                  className="settings-link"
                  onClick={() => setFeedbackSessionId(null)}
                >
                  {t("lobby.submitFeedback")}
                  <span>{t("lobby.feedbackHelp")}</span>
                </button>

                <button
                  type="button"
                  className="settings-link"
                  onClick={() => setSettingsOpen(true)}
                >
                  {t("settings.title")}
                  <span>{t("lobby.settingsHelp")}</span>
                </button>

                <details className="developer-tools">
                  <summary>Developer session tools</summary>
                  <div className="developer-tools-body">
                    {/* The raw account ID is support and debugging data, not
                        lobby furniture. It stays reachable, one click down. */}
                    <p className="session-detail session-id-value">
                      {isGuestAccount ? "Guest ID" : "Player ID"}: {state.userId}
                    </p>
                <button
                  className="secondary-action session-action"
                  type="button"
                  onClick={viewMySessions}
                  disabled={sessionState.status === "loading"}
                >
                  {sessionState.status === "loading"
                    ? "Loading sessions…"
                    : sessionState.status === "error"
                      ? "Retry session lookup"
                      : "View my sessions"}
                </button>

                <div className="session-actions">
                  <button
                    className="secondary-action session-action"
                    type="button"
                    onClick={() => void createTable()}
                    disabled={
                      sessionState.status === "loading" ||
                      hasActiveOrStrandedSession ||
                      matchmakingBlocksSessionActions
                    }
                  >
                    Create test table
                  </button>
                  <label className="session-input-label" htmlFor="join-session-id">
                    Join by session ID
                  </label>
                  <div className="session-join-row">
                    <input
                      id="join-session-id"
                      className="session-input"
                      type="text"
                      value={joinSessionId}
                      onChange={(event) => setJoinSessionId(event.target.value)}
                      disabled={
                        sessionState.status === "loading" ||
                        hasActiveOrStrandedSession ||
                        matchmakingBlocksSessionActions
                      }
                      placeholder="Paste session ID"
                      autoComplete="off"
                    />
                    <button
                      className="secondary-action session-join-action"
                      type="button"
                      onClick={joinTable}
                      disabled={
                        sessionState.status === "loading" ||
                        hasActiveOrStrandedSession ||
                        matchmakingBlocksSessionActions
                      }
                    >
                      Join
                    </button>
                  </div>
                </div>

                {sessionState.status === "empty" && (
                  <p className="session-result" role="status" aria-live="polite">
                    No active sessions
                  </p>
                )}

                {sessionState.status === "loaded" && (
                  <div className="session-result" role="status" aria-live="polite">
                    <p className="status-label">Session found</p>
                    <p className="session-detail session-id-value">
                      Session ID: {sessionState.session.sessionId}
                    </p>
                    {sessionState.session.status && (
                      <p className="session-detail">Status: {sessionState.session.status}</p>
                    )}
                    <p className="session-detail">
                      Roster: {sessionState.session.members.length} member
                      {sessionState.session.members.length === 1 ? "" : "s"}
                    </p>
                    {sessionState.session.members.length > 0 && (
                      <ul className="roster-list">
                        {sessionState.session.members.map((member) => (
                          <li key={member.userId}>
                            {member.displayName ?? sessionIdFragment(member.userId)}
                            {member.status ? ` · ${member.status}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      className="secondary-action session-refresh-action"
                      type="button"
                      onClick={refreshRoster}
                    >
                      Refresh roster
                    </button>
                    <div className="match-runtime-panel">
                      <p className="status-label">Match runtime</p>

                      {/* Every other matchRuntimeState status (connecting,
                          joined, error) takes over the whole screen — see
                          the game-screen early return above. */}
                      {!accelByteConfig.matchServiceURL && (
                        <p className="runtime-message">
                          Configure ACCELBYTE_MATCH_SERVICE_URL and restart the dev server.
                        </p>
                      )}

                      {accelByteConfig.matchServiceURL &&
                        onlineSessionEntryMode === "matchmaking" && (
                          <p className="runtime-message" aria-live="polite">
                            {sessionState.session.members.length < HUMAN_MATCH_SIZE
                              ? `Waiting for players… ${sessionState.session.members.length}/${HUMAN_MATCH_SIZE}`
                              : "Opening the table…"}
                          </p>
                        )}

                      {accelByteConfig.matchServiceURL &&
                        onlineSessionEntryMode === "manual" && (
                        <button
                          className="secondary-action session-action"
                          type="button"
                          onClick={() => void connectMatchRuntime()}
                        >
                          Enter table
                        </button>
                        )}
                    </div>
                    <button
                      className="secondary-action session-leave-action"
                      type="button"
                      onClick={() => void leaveTable()}
                    >
                      Leave table
                    </button>
                  </div>
                )}

                {sessionState.status === "error" && (
                  <div className="session-error" role="alert">
                    <p>{sessionState.message}</p>
                    <p className="error-code">Error code: session_{sessionState.code}</p>
                    {sessionState.retryLeaveSessionId && (
                      <button
                        className="secondary-action session-action"
                        type="button"
                        onClick={() => void leaveTable()}
                      >
                        Retry leaving table
                      </button>
                    )}
                  </div>
                )}
                  </div>
                </details>
              </div>
            )}
          </div>
        )}

        {state.status === "error" && (
          <div className="error-panel" role="alert">
            <p className="status-label">
              {state.phase === "iam" ? t("auth.signInFailed") : t("lobby.connectionFailed")}
            </p>
            <p>{translateSource(state.message)}</p>
            <p className="error-code">{t("common.errorCode", { code: state.code })}</p>
            <button className="secondary-action" type="button" onClick={signInAsGuest}>
              {t("common.retry")}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
