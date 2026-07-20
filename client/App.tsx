import { useEffect, useRef, useState } from "react";

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
import type { ClaimType, MatchCommandRequest, SeatView } from "../protocol/envelope";
import { MatchTable } from "./MatchTable";
import { HandResultScreen } from "./HandResultScreen";
import { seatViewToMatchTableState } from "./matchTableAdapter";
import "./styles.css";
import "./match-table.css";

// §8.7 auto-reconnect tuning: which MatchRuntimeErrorCode values are worth
// retrying automatically (a dropped/stalled connection) versus surfacing
// immediately (configuration/protocol errors that retrying cannot fix).
const MATCH_RUNTIME_RETRYABLE_CODES = new Set(["closed", "network", "timeout"]);
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

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
  | { status: "error"; code: string; message: string };

type MatchmakingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "searching"; ticket: MatchmakingTicket }
  | { status: "canceling"; ticket: MatchmakingTicket }
  | { status: "matched"; ticket: MatchmakingTicket }
  | { status: "error"; code: string; message: string };

type MatchRuntimeState =
  | { status: "idle" }
  | { status: "connecting"; matchId: string }
  | { status: "joined"; matchId: string; view: SeatView; commandPending: boolean }
  | { status: "error"; code: string; message: string };

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
  const [joinSessionId, setJoinSessionId] = useState("");
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
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
  const lobbyRef = useRef<LobbyConnection | null>(null);
  const matchRuntimeRef = useRef<MatchRuntimeConnection | null>(null);
  const matchRuntimeMatchIdRef = useRef<string | null>(null);
  const sessionRequestRef = useRef(0);
  const matchmakingRequestRef = useRef(0);

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
    };
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

  // A tile selected for discard stops being valid the moment the turn
  // moves on (our own confirmed discard, a claim stealing it, a timeout).
  useEffect(() => {
    if (matchRuntimeState.status !== "joined") {
      setSelectedTileId(null);
      return;
    }
    const canDiscard =
      matchRuntimeState.view.active_seat === matchRuntimeState.view.seat &&
      matchRuntimeState.view.phase === "awaiting_discard";
    if (!canDiscard) {
      setSelectedTileId(null);
      return;
    }
    setSelectedTileId((current) =>
      current && matchRuntimeState.view.own_hand.some((item) => item.id === current) ? current : null,
    );
  }, [matchRuntimeState]);

  // §8.7 "client displays Reconnecting immediately": a transient match-
  // runtime disconnect (closed/network/timeout — not a configuration or
  // protocol error, which retrying cannot fix) is retried automatically a
  // bounded number of times instead of dropping straight to the manual
  // error panel. reconnectAttempt also drives the "Reconnecting…" label
  // below (a fresh connect vs. a resumed one).
  useEffect(() => {
    if (
      matchRuntimeState.status !== "error" ||
      !MATCH_RUNTIME_RETRYABLE_CODES.has(matchRuntimeState.code) ||
      reconnectAttempt >= MAX_RECONNECT_ATTEMPTS
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

  function resetForNewSignIn() {
    sessionRequestRef.current += 1;
    matchmakingRequestRef.current += 1;
    setSessionState({ status: "idle" });
    setMatchmakingState({ status: "idle" });
    setMatchRuntimeState({ status: "idle" });
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
    setState({ status: "signing_in" });

    try {
      const identity = await stableIam.loginAsGuest();
      connectLobbyAfterSignIn(identity.userId);
    } catch (error) {
      const safeError = errorView(error);
      setState({ status: "error", phase: "iam", ...safeError });
    }
  }

  function updateEmailForm(patch: Partial<typeof emailForm>) {
    setEmailForm((current) => ({ ...current, ...patch }));
  }

  async function signInWithEmail() {
    setEmailAuthState({ status: "working" });
    try {
      const identity = await stableIam.loginWithEmail(emailForm.email.trim(), emailForm.password);
      resetForNewSignIn();
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
      setEmailAuthState({ status: "idle" });
      connectLobbyAfterSignIn(identity.userId);
    } catch (error) {
      setEmailAuthState({ status: "error", message: emailAuthErrorMessage(error) });
    }
  }

  async function viewMySessions() {
    const requestId = ++sessionRequestRef.current;
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
    const matchmakingRequestId = ++matchmakingRequestRef.current;
    const sessionRequestId = ++sessionRequestRef.current;
    setSessionState({ status: "loading" });

    try {
      const client = createAuthenticatedSessionClient();
      await client.joinSession(sessionId);
      const session = await client.getSession(sessionId);
      if (
        matchmakingRequestId !== matchmakingRequestRef.current ||
        sessionRequestId !== sessionRequestRef.current
      ) {
        return;
      }

      setSessionState({ status: "loaded", session });
      setJoinSessionId(sessionId);
      setMatchmakingState({ status: "idle" });
    } catch (error) {
      if (
        matchmakingRequestId !== matchmakingRequestRef.current ||
        sessionRequestId !== sessionRequestRef.current
      ) {
        return;
      }

      const safeError = sessionErrorView(error);
      setSessionState({ status: "error", ...safeError });
    }
  }

  async function createTable() {
    const requestId = ++sessionRequestRef.current;
    setSessionState({ status: "loading" });

    try {
      const session = await createAuthenticatedSessionClient().createSession();
      if (requestId !== sessionRequestRef.current) {
        return;
      }

      setJoinSessionId(session.sessionId);
      setSessionState({ status: "loaded", session });
    } catch (error) {
      if (requestId !== sessionRequestRef.current) {
        return;
      }

      const safeError = sessionErrorView(error);
      setSessionState({ status: "error", ...safeError });
    }
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

  async function leaveTable() {
    if (sessionState.status !== "loaded") {
      return;
    }

    const requestId = ++sessionRequestRef.current;
    setSessionState({ status: "loading" });
    matchRuntimeRef.current?.close();
    matchRuntimeRef.current = null;
    matchRuntimeMatchIdRef.current = null;
    setMatchRuntimeState({ status: "idle" });

    try {
      await createAuthenticatedSessionClient().leaveSession(sessionState.session.sessionId);
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
      setSessionState({ status: "error", ...safeError });
    }
  }

  async function connectMatchRuntime() {
    if (sessionState.status !== "loaded") {
      return;
    }
    if (!accelByteConfig.matchRuntimeURL) {
      setMatchRuntimeState({
        status: "error",
        code: "configuration",
        message: "Match runtime URL is not configured. Restart after updating .env.",
      });
      return;
    }

    const matchId = sessionState.session.sessionId;
    matchRuntimeRef.current?.close();
    matchRuntimeRef.current = null;
    setMatchRuntimeState({ status: "connecting", matchId });

    let connection: MatchRuntimeConnection;
    try {
      connection = createMatchRuntimeConnection(stableIam.getAccessToken(), {
        url: accelByteConfig.matchRuntimeURL,
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
            setMatchRuntimeState({ status: "error", ...matchRuntimeErrorView(error) });
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
        matchRuntimeRef.current?.close();
        matchRuntimeRef.current = null;
        matchRuntimeMatchIdRef.current = null;
      }
      setMatchRuntimeState({ status: "error", ...matchRuntimeErrorView(error) });
    }
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
      setMatchRuntimeState({ status: "error", ...matchRuntimeErrorView(error) });
    }
  }

  function drawTile() {
    if (matchRuntimeState.status !== "joined") {
      return;
    }
    sendMatchCommand({
      type: "draw",
      expected_version: matchRuntimeState.view.state_version,
    });
  }

  // Select/confirm discard (E8.F2, §9.3/§9.6): clicking a hand tile only
  // selects it; discarding is a separate, explicit confirm so a misclick
  // is free to undo (select a different tile, or the same one again to
  // deselect) any time before the confirm button is actually pressed.
  function selectHandTile(tileId: string) {
    setSelectedTileId((current) => (current === tileId ? null : tileId));
  }

  function confirmDiscard() {
    if (matchRuntimeState.status !== "joined" || !selectedTileId) {
      return;
    }
    sendMatchCommand({
      type: "discard",
      expected_version: matchRuntimeState.view.state_version,
      tile_id: selectedTileId,
    });
    setSelectedTileId(null);
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

  function syncMatchRuntime() {
    if (!matchRuntimeRef.current || matchRuntimeState.status !== "joined") {
      return;
    }
    try {
      matchRuntimeRef.current.sync();
    } catch (error) {
      setMatchRuntimeState({ status: "error", ...matchRuntimeErrorView(error) });
    }
  }

  const birthYearOptions = Array.from({ length: 100 }, (_, index) => new Date().getFullYear() - index);

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
                    onClick={createTable}
                    disabled={sessionState.status === "loading" || sessionState.status === "loaded"}
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
                      disabled={sessionState.status === "loading" || sessionState.status === "loaded"}
                      placeholder="Paste session ID"
                      autoComplete="off"
                    />
                    <button
                      className="secondary-action session-join-action"
                      type="button"
                      onClick={joinTable}
                      disabled={sessionState.status === "loading" || sessionState.status === "loaded"}
                    >
                      Join
                    </button>
                  </div>
                </div>

                <div className="matchmaking-panel">
                  <p className="status-label">Matchmaking</p>
                  {!accelByteConfig.matchPool && matchmakingState.status === "idle" && (
                    <p className="matchmaking-result" role="status" aria-live="polite">
                      Queue unavailable. Configure ACCELBYTE_MATCH_POOL and restart the dev server.
                    </p>
                  )}

                  {accelByteConfig.matchPool && matchmakingState.status === "idle" && (
                    <button
                      className="secondary-action session-action"
                      type="button"
                      onClick={findTable}
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
                        <p className="session-detail session-id-value">
                          Session ID: {matchmakingState.ticket.sessionId}
                        </p>
                      ) : (
                        <p>AGS returned a match without a session ID yet.</p>
                      )}
                      {matchmakingState.ticket.sessionId && (
                        <button
                          className="secondary-action session-action"
                          type="button"
                          onClick={joinMatchedTable}
                          disabled={sessionState.status === "loading"}
                        >
                          {sessionState.status === "loading" ? "Joining table…" : "Join table"}
                        </button>
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
                      <p className="status-label">Local match runtime</p>

                      {!accelByteConfig.matchRuntimeURL &&
                        matchRuntimeState.status === "idle" && (
                          <p className="runtime-message">
                            Configure ACCELBYTE_MATCH_RUNTIME_URL and restart the dev server.
                          </p>
                        )}

                      {accelByteConfig.matchRuntimeURL &&
                        matchRuntimeState.status === "idle" && (
                          <button
                            className="secondary-action session-action"
                            type="button"
                            onClick={connectMatchRuntime}
                          >
                            Connect test hand
                          </button>
                        )}

                      {matchRuntimeState.status === "connecting" && (
                        <p className="runtime-message reconnect-overlay" role="status" aria-live="assertive">
                          {reconnectAttempt > 0
                            ? `Reconnecting… (attempt ${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`
                            : "Authenticating and joining the test hand…"}
                        </p>
                      )}

                      {matchRuntimeState.status === "joined" &&
                        (matchRuntimeState.view.phase === "hand_complete" ||
                        matchRuntimeState.view.phase === "exhaustive_draw" ? (
                          <HandResultScreen view={matchRuntimeState.view} onReturn={leaveTable} />
                        ) : (
                          <div className="runtime-state" role="status" aria-live="polite">
                            {controlRestoredNotice && (
                              <p className="control-restored-toast" role="status" aria-live="polite">
                                Control restored — it's you again.
                              </p>
                            )}
                            <div className="match-table-frame">
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
                                  selectedTileId,
                                  onSelectTile: selectHandTile,
                                  onConfirmDiscard: confirmDiscard,
                                  discardPending: matchRuntimeState.commandPending,
                                }}
                              />
                            </div>

                            {matchRuntimeState.view.active_seat !== matchRuntimeState.view.seat && (
                              <p className="runtime-message">
                                Waiting for seat {matchRuntimeState.view.active_seat}.
                              </p>
                            )}

                            <button
                              className="secondary-action session-action"
                              type="button"
                              onClick={syncMatchRuntime}
                            >
                              Refresh match state
                            </button>
                          </div>
                        ))}

                      {matchRuntimeState.status === "error" && (
                        <div className="session-error" role="alert">
                          <p>{matchRuntimeState.message}</p>
                          <p className="error-code">
                            Error code: match_runtime_{matchRuntimeState.code}
                          </p>
                          <button
                            className="secondary-action session-action"
                            type="button"
                            onClick={connectMatchRuntime}
                          >
                            Reconnect runtime
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      className="secondary-action session-leave-action"
                      type="button"
                      onClick={leaveTable}
                    >
                      Leave table
                    </button>
                  </div>
                )}

                {sessionState.status === "error" && (
                  <div className="session-error" role="alert">
                    <p>{sessionState.message}</p>
                    <p className="error-code">Error code: session_{sessionState.code}</p>
                  </div>
                )}
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
