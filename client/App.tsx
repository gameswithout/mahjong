import { useEffect, useRef, useState } from "react";

import { BrowserIam, IamAuthError, createBrowserIam } from "./iam";
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
import type { MatchCommandRequest, MahjongTile, SeatView } from "../protocol/envelope";
import "./styles.css";

type LobbyStatus = "connecting" | "connected" | "reconnecting";

type ViewState =
  | { status: "idle" }
  | { status: "signing_in" }
  | { status: "signed_in"; userId: string; lobbyStatus: LobbyStatus }
  | { status: "error"; phase: "iam" | "lobby"; code: string; message: string };

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

  async function signInAsGuest() {
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
    setState({ status: "signing_in" });

    try {
      const identity = await stableIam.loginAsGuest();
      setState({ status: "signed_in", userId: identity.userId, lobbyStatus: "connecting" });

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
    } catch (error) {
      const safeError = errorView(error);
      setState({ status: "error", phase: "iam", ...safeError });
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

  function discardTile(tile: MahjongTile) {
    if (matchRuntimeState.status !== "joined") {
      return;
    }
    sendMatchCommand({
      type: "discard",
      expected_version: matchRuntimeState.view.state_version,
      tile_id: tile.id,
    });
  }

  function passClaim() {
    if (matchRuntimeState.status !== "joined" || !matchRuntimeState.view.claim) {
      return;
    }
    const claim = matchRuntimeState.view.claim;
    sendMatchCommand({
      type: "submit_claim",
      expected_version: matchRuntimeState.view.state_version,
      claim: {
        action_id: claim.action_id,
        type: "pass",
        state_version: matchRuntimeState.view.state_version,
        response_revision: claim.own_response
          ? claim.own_response.response_revision + 1
          : 0,
        deliberate: true,
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
          <button className="primary-action" type="button" onClick={signInAsGuest}>
            Continue as Guest
          </button>
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
                        <p className="runtime-message" role="status" aria-live="polite">
                          Authenticating and joining the test hand…
                        </p>
                      )}

                      {matchRuntimeState.status === "joined" && (
                        <div className="runtime-state" role="status" aria-live="polite">
                          <p className="session-detail">
                            Seat: {matchRuntimeState.view.seat} · Phase:{" "}
                            {matchRuntimeState.view.phase}
                          </p>
                          <p className="session-detail">
                            State version: {matchRuntimeState.view.state_version} · Active:{" "}
                            {matchRuntimeState.view.active_seat}
                          </p>
                          <p className="session-detail">
                            Drawable wall: {matchRuntimeState.view.wall.drawable_remaining} ·
                            Reserve: {matchRuntimeState.view.wall.reserve_remaining}
                          </p>

                          {matchRuntimeState.view.active_seat ===
                            matchRuntimeState.view.seat &&
                            matchRuntimeState.view.phase === "awaiting_draw" && (
                              <button
                                className="primary-action runtime-primary-action"
                                type="button"
                                onClick={drawTile}
                                disabled={matchRuntimeState.commandPending}
                              >
                                {matchRuntimeState.commandPending ? "Drawing…" : "Draw tile"}
                              </button>
                            )}

                          <p className="runtime-hand-label">
                            Your concealed hand ({matchRuntimeState.view.own_hand.length})
                          </p>
                          <div className="runtime-hand" aria-label="Your concealed hand">
                            {matchRuntimeState.view.own_hand.map((tile) => {
                              const canDiscard =
                                matchRuntimeState.view.active_seat ===
                                  matchRuntimeState.view.seat &&
                                matchRuntimeState.view.phase === "awaiting_discard";
                              return (
                                <button
                                  className="runtime-tile"
                                  type="button"
                                  key={tile.id}
                                  onClick={() => discardTile(tile)}
                                  disabled={!canDiscard || matchRuntimeState.commandPending}
                                  aria-label={
                                    canDiscard
                                      ? `Discard ${tile.id}`
                                      : `${tile.id}, not currently discardable`
                                  }
                                >
                                  {tile.id}
                                </button>
                              );
                            })}
                          </div>

                          {matchRuntimeState.view.phase === "claim_window" &&
                            matchRuntimeState.view.claim?.eligible.includes(
                              matchRuntimeState.view.seat,
                            ) &&
                            !matchRuntimeState.view.claim.own_response && (
                              <button
                                className="secondary-action session-action"
                                type="button"
                                onClick={passClaim}
                                disabled={matchRuntimeState.commandPending}
                              >
                                {matchRuntimeState.commandPending ? "Passing…" : "Pass claim"}
                              </button>
                            )}

                          {matchRuntimeState.view.active_seat !==
                            matchRuntimeState.view.seat && (
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
                      )}

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
