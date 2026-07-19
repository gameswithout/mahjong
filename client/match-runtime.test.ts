import { describe, expect, it } from "vitest";

import type { MatchRuntimeSocket } from "./match-runtime";
import { MatchRuntimeError, createMatchRuntimeConnection } from "./match-runtime";
import type { SeatView } from "../protocol/envelope";

class FakeSocket implements MatchRuntimeSocket {
  onopen: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  readonly sent: string[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }
}

function seatView(overrides: Partial<SeatView> = {}): SeatView {
  return {
    match_id: "session-1",
    seat: "E",
    state_version: 2,
    phase: "awaiting_draw",
    active_seat: "E",
    own_hand: [{ id: "characters-1-1", kind: "characters", rank: 1, copy: 1 }],
    own_exposed: [],
    players: [
      { seat: "E", hand_count: 17 },
      { seat: "S", hand_count: 16 },
      { seat: "W", hand_count: 16 },
      { seat: "N", hand_count: 16 },
    ],
    wall: { remaining: 79, drawable_remaining: 63, reserve_remaining: 16 },
    ...overrides,
  };
}

describe("createMatchRuntimeConnection", () => {
  it("uses the bearer subprotocol and resolves only after server.ready", async () => {
    const socket = new FakeSocket();
    let url = "";
    let protocols: string[] = [];
    const envelopes: unknown[] = [];
    const connection = createMatchRuntimeConnection("player-token", {
      url: "ws://127.0.0.1:8081/ws",
      socketFactory: (nextURL, nextProtocols) => {
        url = nextURL;
        protocols = nextProtocols;
        return socket;
      },
      onEnvelope: (envelope) => envelopes.push(envelope),
    });

    expect(url).toBe("ws://127.0.0.1:8081/ws");
    expect(protocols).toEqual(["ags.bearer", "ags.token.cGxheWVyLXRva2Vu"]);
    socket.emitMessage(JSON.stringify({
      v: 1,
      type: "server.ready",
      payload: { user_id: "guest-123", server_time: "2026-07-18T01:02:03Z" },
    }));
    await expect(connection.ready).resolves.toEqual({
      user_id: "guest-123",
      server_time: "2026-07-18T01:02:03Z",
    });

    const requestID = connection.send("ping", { client_time: "now" });
    expect(requestID).toBe("match-runtime-1");
    expect(JSON.parse(socket.sent[0])).toEqual({
      v: 1,
      type: "ping",
      request_id: "match-runtime-1",
      payload: { client_time: "now" },
    });
    expect(envelopes).toHaveLength(1);
    connection.close();
    expect(socket.closed).toBe(true);
  });

  it("sends typed join/commands and dispatches redacted match views", async () => {
    const socket = new FakeSocket();
    const joined: unknown[] = [];
    const states: unknown[] = [];
    const accepted: unknown[] = [];
    const connection = createMatchRuntimeConnection("player-token", {
      url: "ws://127.0.0.1:8081/ws",
      socketFactory: () => socket,
      onJoined: (payload) => joined.push(payload),
      onState: (payload) => states.push(payload),
      onCommandAccepted: (payload) => accepted.push(payload),
    });
    socket.emitMessage(JSON.stringify({
      v: 1,
      type: "server.ready",
      payload: { user_id: "guest-123", server_time: "2026-07-18T01:02:03Z" },
    }));
    await connection.ready;

    expect(connection.join(" session-1 ", "join-1")).toBe("join-1");
    expect(JSON.parse(socket.sent[0])).toEqual({
      v: 1,
      type: "match.join",
      request_id: "join-1",
      payload: { match_id: "session-1" },
    });
    const view = seatView();
    socket.emitMessage(JSON.stringify({
      v: 1,
      type: "match.joined",
      request_id: "join-1",
      payload: { match_id: "session-1", seat: "E", view },
    }));
    expect(joined).toEqual([{ match_id: "session-1", seat: "E", view }]);

    connection.command({
      match_id: "session-1",
      type: "draw",
      expected_version: 2,
    }, "draw-1");
    expect(JSON.parse(socket.sent[1])).toEqual({
      v: 1,
      type: "match.command",
      request_id: "draw-1",
      payload: {
        match_id: "session-1",
        type: "draw",
        expected_version: 2,
      },
    });
    socket.emitMessage(JSON.stringify({
      v: 1,
      type: "match.command.accepted",
      request_id: "draw-1",
      payload: {
        match_id: "session-1",
        seat: "E",
        state_version: 3,
        phase: "awaiting_discard",
      },
    }));
    socket.emitMessage(JSON.stringify({
      v: 1,
      type: "match.state",
      request_id: "draw-1",
      payload: {
        match_id: "session-1",
        seat: "E",
        view: seatView({ state_version: 3, phase: "awaiting_discard" }),
      },
    }));
    expect(accepted).toHaveLength(1);
    expect(states).toHaveLength(1);
  });

  it("rejects inconsistent match projections", async () => {
    const socket = new FakeSocket();
    const errors: MatchRuntimeError[] = [];
    const connection = createMatchRuntimeConnection("player-token", {
      url: "ws://127.0.0.1:8081/ws",
      socketFactory: () => socket,
      onError: (error) => errors.push(error),
    });
    socket.emitMessage(JSON.stringify({
      v: 1,
      type: "server.ready",
      payload: { user_id: "guest-123", server_time: "2026-07-18T01:02:03Z" },
    }));
    await connection.ready;
    socket.emitMessage(JSON.stringify({
      v: 1,
      type: "match.state",
      payload: {
        match_id: "session-1",
        seat: "S",
        view: seatView({ seat: "E" }),
      },
    }));
    expect(errors.at(-1)).toMatchObject({ code: "protocol" });
  });

  it("rejects stale protocol envelopes and server errors without logging credentials", async () => {
    const socket = new FakeSocket();
    const connection = createMatchRuntimeConnection("secret-token", {
      url: "ws://runtime.test/ws",
      socketFactory: () => socket,
    });
    socket.emitMessage(JSON.stringify({ v: 99, type: "server.ready", payload: {} }));
    await expect(connection.ready).rejects.toMatchObject({ code: "protocol" });
    expect(socket.sent).toEqual([]);

    const errorSocket = new FakeSocket();
    const errorConnection = createMatchRuntimeConnection("secret-token", {
      url: "ws://runtime.test/ws",
      socketFactory: () => errorSocket,
    });
    errorSocket.emitMessage(JSON.stringify({
      v: 1,
      type: "error",
      payload: { code: "auth.invalid", message: "unauthorized" },
    }));
    await expect(errorConnection.ready).rejects.toEqual(
      expect.objectContaining({
        code: "protocol",
        message: "auth.invalid: unauthorized",
      }),
    );
    expect(String(errorConnection.ready)).not.toContain("secret-token");
  });

  it("rejects missing configuration and a connection that closes before ready", async () => {
    expect(() => createMatchRuntimeConnection("", { url: "ws://runtime.test/ws" })).toThrow(
      "Guest sign-in is required",
    );
    expect(() => createMatchRuntimeConnection("token", { url: "" })).toThrow(
      "Match runtime URL is not configured",
    );

    const socket = new FakeSocket();
    const connection = createMatchRuntimeConnection("token", {
      url: "ws://runtime.test/ws",
      socketFactory: () => socket,
    });
    socket.onclose?.({ code: 1006 });
    await expect(connection.ready).rejects.toMatchObject({ code: "closed" });
  });

  it("times out when the server does not send ready", async () => {
    const connection = createMatchRuntimeConnection("token", {
      url: "ws://runtime.test/ws",
      timeoutMs: 1,
      socketFactory: () => new FakeSocket(),
    });
    await expect(connection.ready).rejects.toBeInstanceOf(MatchRuntimeError);
    await expect(connection.ready).rejects.toMatchObject({ code: "timeout" });
  });
});
