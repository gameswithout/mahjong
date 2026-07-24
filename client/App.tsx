import { useEffect, useMemo, useRef, useState } from "react";

import { BrowserIam, IamAuthError, createBrowserIam } from "./iam";
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
import {
  createFreshPracticeSession,
  isPracticeMatch,
  leaveSessionIfPresent,
} from "./practice-flow";
import { browserMatchResumeStore, type MatchResumePointer } from "./match-resume";
import type { ClaimType, MatchCommandRequest, SeatView } from "../protocol/envelope";
import { MatchTable } from "./MatchTable";
import { VideoCallPanel } from "./VideoCallPanel";
import { useVideoCall } from "./useVideoCall";
import type { SeatId } from "./matchTableTypes";
import { HandResultScreen } from "./HandResultScreen";
import { PracticeLaunchCard } from "./PracticeLaunchCard";
import { seatViewToMatchTableState } from "./matchTableAdapter";
import "./styles.css";
import "./match-table.css";

// §8.7 auto-reconnect tuning: which MatchRuntimeErrorCode values are worth
// retrying automatically (a dropped/stalled connection) versus surfacing
// immediately (configuration/protocol errors that retrying cannot fix).
// not_found covers the short AGS Session propagation window immediately
// after one-action Practice creation.
const MATCH_RUNTIME_RETRYABLE_CODES = new Set(["closed", "network", "not_found", "timeout"]);
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;
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

// §10.3: minimum stated age is 13; only month/year are collected (never a
// full birth date), so age is computed to the precision that data allows.
const MINIMUM_ACCOUNT_AGE = 13;

export function ageInYears(birthYear: number, birthMonth: number): number {
  const now = new Date();
  let age = now.getFullYear() - birthYear;
  if (now.getMonth() + 1 < birthMonth) {
    age -= 1;
  }
  return age;
}

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
  | { status: "searching"; ticket: MatchmakingTicket }
  | { status: "canceling"; ticket: MatchmakingTicket }
  | { status: "matched"; ticket: MatchmakingTicket }
  | { status: "error"; code: string; message: string };

type MatchRuntimeState =
  | { status: "idle" }
  | { status: "preparing"; message: string }
  | { status: "connecting"; matchId: string }
  | { status: "joined"; matchId: string; view: SeatView; commandPending: boolean }
  | {
      status: "error";
      code: string;
      message: string;
      retry?: "runtime" | "practice";
      retryPreviousSessionId?: string;
    };

type OnlineSessionEntryMode = "manual" | "matchmaking";

export function shouldAutomaticallyEnterHumanMatch(
  mode: OnlineSessionEntryMode,
  memberCount: number,
  runtimeStatus: MatchRuntimeState["status"],
): boolean {
  return mode === "matchmaking" && memberCount >= HUMAN_MATCH_SIZE && runtimeStatus === "idle";
}

export function shouldAutomaticallyDraw(view: SeatView, commandPending: boolean): boolean {
  return (
    !commandPending &&
    view.phase === "awaiting_draw" &&
    view.active_seat === view.seat
  );
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

function sessionIdFragment(sessionId: string): string {
  if (sessionId.length <= 16) {
    return sessionId;
  }

  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}

export function App({ iam: injectedIam }: { iam?: BrowserIam } = {}) {
  const [stableIam] = useState(() => injectedIam ?? createBrowserIam());
  const [state, setState] = useState<ViewState>({ status: "idle" });
  const [sessionState, setSessionState] = useState<SessionState>({ status: "idle" });
  const [matchmakingState, setMatchmakingState] = useState<MatchmakingState>({ status: "idle" });
  const [matchRuntimeState, setMatchRuntimeState] = useState<MatchRuntimeState>({ status: "idle" });
  const [onlineSessionEntryMode, setOnlineSessionEntryMode] =
    useState<OnlineSessionEntryMode>("manual");
  const [joinSessionId, setJoinSessionId] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [controlRestoredNotice, setControlRestoredNotice] = useState(false);
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
  const matchRuntimeRef = useRef<MatchRuntimeConnection | null>(null);
  const matchRuntimeMatchIdRef = useRef<string | null>(null);
  const sessionRequestRef = useRef(0);
  const matchmakingRequestRef = useRef(0);
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
  const videoController = useVideoCall({
    matchId: matchRuntimeState.status === "joined" ? matchRuntimeState.matchId : "",
    localSeat: (matchRuntimeState.status === "joined" ? matchRuntimeState.view.seat : "E") as SeatId,
    humanSeats: videoHumanSeats,
    iceConfigUrl: accelByteConfig.iceConfigURL ?? "",
    getAccessToken: () => stableIam.getAccessToken(),
  });

  const activeSessionId =
    state.status === "signed_in" &&
    state.lobbyStatus === "connected" &&
    sessionState.status === "loaded"
      ? sessionState.session.sessionId
      : null;

  useEffect(() => {
    return () => {
      sessionRequestRef.current += 1;
      matchmakingRequestRef.current += 1;
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

    async function refreshRosterInBackground() {
      try {
        const session = await createAuthenticatedSessionClient().getSession(sessionId);
        if (cancelled || requestId !== sessionRequestRef.current) {
          return;
        }

        setSessionState((current) =>
          current.status === "loaded" && current.session.sessionId === sessionId
            ? { status: "loaded", session }
            : current,
        );
      } catch {
        // Keep the last known roster visible during transient polling failures.
      }
    }

    const interval = window.setInterval(refreshRosterInBackground, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
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
    let cancelled = false;

    async function refreshTicketInBackground() {
      try {
        const ticket = createAuthenticatedMatchmakingClient().getTicket(ticketId);
        const nextTicket = await ticket;
        if (cancelled || requestId !== matchmakingRequestRef.current) {
          return;
        }

        if (nextTicket.matchFound || nextTicket.sessionId) {
          setMatchmakingState({ status: "matched", ticket: nextTicket });
          return;
        }

        if (nextTicket.isActive === false) {
          setMatchmakingState({
            status: "error",
            code: "inactive",
            message: "AGS closed this matchmaking ticket before a table was found.",
          });
          return;
        }

        setMatchmakingState({ status: "searching", ticket: nextTicket });
      } catch (error) {
        if (cancelled || requestId !== matchmakingRequestRef.current) {
          return;
        }

        const safeError = matchmakingErrorView(error);
        setMatchmakingState({ status: "error", ...safeError });
      }
    }

    const interval = window.setInterval(refreshTicketInBackground, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeTicketId, matchmakingState.status]);

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

  // The §5.10/§9.4 countdown is a pure function of (deadline, now); ticking
  // a render clock while a hand is live is enough to keep it accurate
  // without the server pushing per-second updates.
  useEffect(() => {
    if (!matchRuntimeJoined) {
      return;
    }
    const interval = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [matchRuntimeJoined]);

  // driveLocked (both match runtimes) is lazy — it only advances an overdue
  // deadline when some client's request touches the match. Polling keeps
  // this seat's own view fresh (an opponent's auto-discard, a takeover
  // move, a resolved claim window) even when this player is not otherwise
  // acting, matching what another seat's own polling would already do for
  // them.
  useEffect(() => {
    if (!matchRuntimeJoined) {
      return;
    }
    const interval = window.setInterval(() => {
      try {
        matchRuntimeRef.current?.sync();
      } catch {
        // onError already routes connection failures into matchRuntimeState.
      }
    }, 4000);
    return () => window.clearInterval(interval);
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
    }, RECONNECT_DELAY_MS);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchRuntimeState, reconnectAttempt]);

  useEffect(() => {
    if (matchRuntimeState.status === "joined") {
      setReconnectAttempt(0);
    }
  }, [matchRuntimeState.status]);

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
    setSessionState({ status: "idle" });
    setMatchmakingState({ status: "idle" });
    setMatchRuntimeState({ status: "idle" });
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

    try {
      const lobby = createLobbyConnection(stableIam.getAuthenticatedSdk(), {
        onOpen: () => {
          setState((current) =>
            current.status === "signed_in" ? { ...current, lobbyStatus: "connected" } : current,
          );
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

    let identity: { userId: string };
    try {
      identity = await stableIam.loginAsGuest();
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

  function createAuthenticatedMatchmakingClient() {
    if (!accelByteConfig.matchPool) {
      throw new MatchmakingError(
        "configuration",
        "Matchmaking pool configuration is incomplete. Restart the dev server after updating .env.",
      );
    }

    return createMatchmakingClient(stableIam.getAuthenticatedSdk(), accelByteConfig.namespace, {
      matchPool: accelByteConfig.matchPool,
    });
  }

  async function findTable() {
    const requestId = ++matchmakingRequestRef.current;
    setOnlineSessionEntryMode("matchmaking");
    autoJoiningSessionIdRef.current = null;
    setMatchmakingState({ status: "loading" });

    try {
      const ticket = await createAuthenticatedMatchmakingClient().createTicket();
      if (requestId !== matchmakingRequestRef.current) {
        return;
      }

      if (ticket.matchFound || ticket.sessionId) {
        setMatchmakingState({ status: "matched", ticket });
      } else {
        setMatchmakingState({ status: "searching", ticket });
      }
    } catch (error) {
      if (requestId !== matchmakingRequestRef.current) {
        return;
      }

      const safeError = matchmakingErrorView(error);
      setMatchmakingState({ status: "error", ...safeError });
    }
  }

  async function cancelMatchmaking() {
    if (matchmakingState.status !== "searching") {
      return;
    }

    const ticket = matchmakingState.ticket;
    const requestId = ++matchmakingRequestRef.current;
    setMatchmakingState({ status: "canceling", ticket });

    try {
      await createAuthenticatedMatchmakingClient().cancelTicket(ticket.ticketId);
      if (requestId !== matchmakingRequestRef.current) {
        return;
      }

      setMatchmakingState({ status: "idle" });
      setOnlineSessionEntryMode("manual");
    } catch (error) {
      if (requestId !== matchmakingRequestRef.current) {
        return;
      }

      const safeError = matchmakingErrorView(error);
      setMatchmakingState({ status: "error", ...safeError });
    }
  }

  async function joinMatchedTable() {
    if (matchmakingState.status !== "matched" || !matchmakingState.ticket.sessionId) {
      return;
    }

    const sessionId = matchmakingState.ticket.sessionId;
    if (autoJoiningSessionIdRef.current === sessionId) {
      return;
    }
    autoJoiningSessionIdRef.current = sessionId;
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

  async function leaveTable(sessionIdOverride?: string) {
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
      return;
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
        return;
      }

      setSessionState({ status: "empty" });
      setJoinSessionId("");
    } catch (error) {
      if (requestId !== sessionRequestRef.current) {
        return;
      }

      const safeError = sessionErrorView(error);
      setSessionState({ status: "error", ...safeError, retryLeaveSessionId: sessionId });
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
      connection = createMatchRuntimeConnection(stableIam.getAccessToken(), {
        url: accelByteConfig.matchServiceURL,
        namespace: accelByteConfig.namespace,
        onJoined: (payload) => {
          if (payload.match_id === matchId && matchRuntimeRef.current === connection) {
            setMatchRuntimeState({
              status: "joined",
              matchId,
              view: payload.view,
              commandPending: false,
            });
          }
        },
        onState: (payload) => {
          if (payload.match_id === matchId && matchRuntimeRef.current === connection) {
            setMatchRuntimeState({
              status: "joined",
              matchId,
              view: payload.view,
              commandPending: false,
            });
          }
        },
        onCommandAccepted: () => {
          if (matchRuntimeRef.current === connection) {
            setMatchRuntimeState((current) =>
              current.status === "joined" ? { ...current, commandPending: false } : current,
            );
          }
        },
        onError: (error) => {
          if (matchRuntimeRef.current === connection) {
            setMatchRuntimeState({
              status: "error",
              ...matchRuntimeErrorView(error),
              retry: "runtime",
            });
          }
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
    return startPracticeHand();
  }

  function playPracticeAgain() {
    const previousSessionId =
      sessionState.status === "loaded" ? sessionState.session.sessionId : undefined;
    return startPracticeHand(previousSessionId);
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

  // Discarding is the player's primary repeated action. A hand tile is now a
  // direct action target: one tap sends the authoritative discard command,
  // eliminating the previous select-then-confirm round trip.
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

  const birthYearOptions = Array.from({ length: 100 }, (_, index) => new Date().getFullYear() - index);
  const hasActiveOrStrandedSession =
    sessionState.status === "loaded" ||
    (sessionState.status === "error" && Boolean(sessionState.retryLeaveSessionId));

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
            <p className="game-screen-status-text">{matchRuntimeState.message}</p>
          </div>
        )}

        {matchRuntimeState.status === "connecting" && (
          <div className="game-screen-status" role="status" aria-live="assertive">
            <p className="game-screen-status-text">
              {reconnectAttempt > 0
                ? `Reconnecting… (attempt ${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`
                : "Joining the table…"}
            </p>
          </div>
        )}

        {matchRuntimeState.status === "joined" &&
          (matchRuntimeState.view.phase === "hand_complete" ||
          matchRuntimeState.view.phase === "exhaustive_draw" ? (
            <div className="game-screen-result">
              <HandResultScreen
                view={matchRuntimeState.view}
                practice={isPracticeMatch(matchRuntimeState.view)}
                onPlayAgain={
                  isPracticeMatch(matchRuntimeState.view) ? playPracticeAgain : undefined
                }
                onReturn={() => void leaveTable()}
              />
            </div>
          ) : (
            <>
              <div className="game-screen-topbar">
                {controlRestoredNotice && (
                  <p className="control-restored-toast" role="status" aria-live="polite">
                    Control restored — it's you again.
                  </p>
                )}
                <button
                  className="leave-match-button"
                  type="button"
                  onClick={() => void leaveTable()}
                >
                  Leave match
                </button>
              </div>
              {videoHumanSeats.length > 0 && (
                <div className="video-call-dock">
                  <VideoCallPanel
                    controller={videoController}
                    humanSeats={videoHumanSeats}
                    seatName={() => "Player"}
                  />
                </div>
              )}
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
                    claimActionPending: matchRuntimeState.commandPending,
                  })}
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
            <p className="game-screen-status-text">{matchRuntimeState.message}</p>
            <p className="error-code">
              Error code:{" "}
              {matchRuntimeState.retry === "practice"
                ? matchRuntimeState.code
                : `match_runtime_${matchRuntimeState.code}`}
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
                {matchRuntimeState.retry === "practice" ? "Retry Practice" : "Reconnect"}
              </button>
              <button
                className="leave-match-button"
                type="button"
                onClick={() => void leaveTable()}
              >
                Leave match
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
        <p className="eyebrow">Mahjong Online</p>
        <h1 id="bootstrap-title">Play a hand with friends.</h1>
        <p className="intro">
          Start with a guest identity. You can upgrade the account later when account recovery is
          available.
        </p>

        {state.status === "idle" && (
          <>
            <button className="primary-action" type="button" onClick={signInAsGuest}>
              Continue as Guest
            </button>

            <div className="email-auth-panel">
              <div className="email-auth-tabs" role="tablist" aria-label="Email sign-in method">
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
                  Sign in
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
                  Create account
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
                    Email
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
                    Password
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
                    {emailAuthState.status === "working" ? "Signing in…" : "Sign in with email"}
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
                    Email
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
                      {emailAuthState.status === "working" ? "Sending code…" : "Send verification code"}
                    </button>
                  ) : (
                    <>
                      <label className="session-input-label" htmlFor="register-code">
                        Verification code
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
                        Username
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
                        Password
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
                        Country
                      </label>
                      <select
                        id="register-country"
                        className="session-input"
                        value={emailForm.country}
                        onChange={(event) => updateEmailForm({ country: event.target.value })}
                      >
                        {CLOSED_BETA_COUNTRIES.map((country) => (
                          <option key={country.code} value={country.code}>
                            {country.name}
                          </option>
                        ))}
                      </select>

                      <span className="session-input-label">Birth month and year</span>
                      <div className="email-auth-row">
                        <select
                          aria-label="Birth month"
                          className="session-input"
                          required
                          value={emailForm.birthMonth}
                          onChange={(event) => updateEmailForm({ birthMonth: event.target.value })}
                        >
                          <option value="" disabled>
                            Month
                          </option>
                          {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                            <option key={month} value={month}>
                              {month}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Birth year"
                          className="session-input"
                          required
                          value={emailForm.birthYear}
                          onChange={(event) => updateEmailForm({ birthYear: event.target.value })}
                        >
                          <option value="" disabled>
                            Year
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
                        I confirm this birth month and year are accurate.
                      </label>

                      <button
                        type="submit"
                        className="secondary-action session-action"
                        disabled={emailAuthState.status === "working"}
                      >
                        {emailAuthState.status === "working" ? "Creating account…" : "Create account"}
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
            Signing in…
          </p>
        )}

        {state.status === "signed_in" && (
          <div className="success-panel" role="status" aria-live="polite">
            <p className="status-label">Signed in</p>
            <p className="user-id">Guest ID: {state.userId}</p>
            <p className="lobby-status">
              {state.lobbyStatus === "connecting" && "Connecting to Lobby…"}
              {state.lobbyStatus === "connected" && "Lobby connected"}
              {state.lobbyStatus === "reconnecting" && "Lobby disconnected. Reconnecting…"}
            </p>

            {state.lobbyStatus === "connected" && (
              <div className="session-panel">
                <PracticeLaunchCard
                  busy={sessionState.status === "loading"}
                  hasSelectedSession={hasActiveOrStrandedSession}
                  cleanupRequired={
                    sessionState.status === "error" &&
                    Boolean(sessionState.retryLeaveSessionId)
                  }
                  matchServiceAvailable={Boolean(accelByteConfig.matchServiceURL)}
                  onStart={() => void practiceVsBots()}
                  onLeaveSelectedSession={() => void leaveTable()}
                />

                <section className="matchmaking-panel online-card" aria-labelledby="online-title">
                  <p className="status-label">Play Online</p>
                  <h2 id="online-title">Find three players for a live hand</h2>
                  <p className="practice-description">
                    Queue as a guest, enter the shared table automatically, and play one full hand.
                  </p>

                  {!accelByteConfig.matchPool && matchmakingState.status === "idle" && (
                    <p className="matchmaking-result" role="status" aria-live="polite">
                      Online play is unavailable because the matchmaking pool is not configured.
                    </p>
                  )}

                  {accelByteConfig.matchPool && matchmakingState.status === "idle" && (
                    <button
                      className="primary-action session-action"
                      type="button"
                      onClick={findTable}
                      disabled={sessionState.status === "loading" || hasActiveOrStrandedSession}
                    >
                      Find a table
                    </button>
                  )}

                  {matchmakingState.status === "loading" && (
                    <p className="matchmaking-result" role="status" aria-live="polite">
                      Joining queue…
                    </p>
                  )}

                  {(matchmakingState.status === "searching" ||
                    matchmakingState.status === "canceling") && (
                    <div className="matchmaking-result" role="status" aria-live="polite">
                      <p>Searching for players</p>
                      <p className="session-detail">
                        Ticket: {sessionIdFragment(matchmakingState.ticket.ticketId)}
                      </p>
                      {matchmakingState.ticket.queueTime !== undefined && (
                        <p className="session-detail">
                          Queue time: {matchmakingState.ticket.queueTime}s
                        </p>
                      )}
                      <button
                        className="secondary-action session-action"
                        type="button"
                        onClick={cancelMatchmaking}
                        disabled={matchmakingState.status === "canceling"}
                      >
                        {matchmakingState.status === "canceling" ? "Leaving queue…" : "Cancel"}
                      </button>
                    </div>
                  )}

                  {matchmakingState.status === "matched" && (
                    <div className="matchmaking-result" role="status" aria-live="polite">
                      <p className="status-label">Match found</p>
                      {matchmakingState.ticket.sessionId ? (
                        <>
                          <p className="session-detail">Joining the shared table automatically…</p>
                          {sessionState.status === "error" && (
                            <button
                              className="secondary-action session-action"
                              type="button"
                              onClick={joinMatchedTable}
                            >
                              Retry joining table
                            </button>
                          )}
                        </>
                      ) : (
                        <p>AGS returned a match without a Session yet.</p>
                      )}
                    </div>
                  )}

                  {matchmakingState.status === "error" && (
                    <div className="session-error" role="alert">
                      <p>{matchmakingState.message}</p>
                      <p className="error-code">Error code: matchmaking_{matchmakingState.code}</p>
                      <button className="secondary-action session-action" type="button" onClick={findTable}>
                        Retry matchmaking
                      </button>
                    </div>
                  )}
                </section>

                <details className="developer-tools">
                  <summary>Developer session tools</summary>
                  <div className="developer-tools-body">
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
                    disabled={sessionState.status === "loading" || hasActiveOrStrandedSession}
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
                      disabled={sessionState.status === "loading" || hasActiveOrStrandedSession}
                      placeholder="Paste session ID"
                      autoComplete="off"
                    />
                    <button
                      className="secondary-action session-join-action"
                      type="button"
                      onClick={joinTable}
                      disabled={sessionState.status === "loading" || hasActiveOrStrandedSession}
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
              {state.phase === "iam" ? "Sign-in failed" : "Lobby connection failed"}
            </p>
            <p>{state.message}</p>
            <p className="error-code">Error code: {state.code}</p>
            <button className="secondary-action" type="button" onClick={signInAsGuest}>
              Retry
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
