import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MatchRuntimeFetch } from "./match-runtime";
import { MatchRuntimeError, createMatchRuntimeConnection } from "./match-runtime";

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

// FakeFetch mirrors the real fetch/AbortController contract our
// implementation relies on: queued responses are returned in call order, and
// a "hang" queued entry only settles (with an AbortError, like real fetch)
// once the caller's AbortSignal actually fires — this is what lets the
// timeout test drive a real abort through match-runtime.ts's own logic
// rather than asserting on a mock's internals.
class FakeFetch {
  readonly calls: RecordedCall[] = [];
  private readonly queue: Array<{ status: number; body: unknown } | "hang" | { reject: unknown }> = [];

  enqueue(status: number, body: unknown): void {
    this.queue.push({ status, body });
  }

  enqueueRejection(error: unknown): void {
    this.queue.push({ reject: error });
  }

  enqueueHang(): void {
    this.queue.push("hang");
  }

  readonly fetchImpl: MatchRuntimeFetch = (async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    this.calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });

    const next = this.queue.shift();
    if (!next) {
      throw new Error("FakeFetch: no queued response for call " + this.calls.length);
    }
    if (next === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }
    if ("reject" in next) {
      throw next.reject;
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as MatchRuntimeFetch;
}

function wireMatchState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    match_id: "session-1",
    seat: "E",
    state_version: "2",
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
  it("resolves ready immediately (no server handshake exists over REST)", async () => {
    const fake = new FakeFetch();
    const connection = createMatchRuntimeConnection("player-token", {
      url: "https://match.test/mahjong",
      namespace: "gameswithout-mahjong",
      fetchImpl: fake.fetchImpl,
    });
    await expect(connection.ready).resolves.toMatchObject({ user_id: "" });
    expect(fake.calls).toHaveLength(0);
  });

  it("joins with the bearer header, namespace, and session/match path segments", async () => {
    const fake = new FakeFetch();
    const joined: unknown[] = [];
    const connection = createMatchRuntimeConnection("player-token", {
      url: "https://match.test/mahjong",
      namespace: "gameswithout-mahjong",
      fetchImpl: fake.fetchImpl,
      onJoined: (payload) => joined.push(payload),
    });
    await connection.ready;

    expect(connection.join(" session-1 ", "join-1")).toBe("join-1");
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));

    const call = fake.calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toBe(
      "https://match.test/mahjong/v1/namespaces/gameswithout-mahjong/sessions/session-1/matches/session-1/join",
    );
    // Headers iteration lowercases names per the Fetch spec.
    expect(call.headers.authorization).toBe("Bearer player-token");
    expect(call.body).toEqual({});
  });

  it("normalizes wire int64 strings to numbers and dispatches onJoined", async () => {
    const fake = new FakeFetch();
    fake.enqueue(200, { state: wireMatchState() });
    const joined: unknown[] = [];
    const connection = createMatchRuntimeConnection("player-token", {
      url: "https://match.test/mahjong",
      namespace: "gameswithout-mahjong",
      fetchImpl: fake.fetchImpl,
      onJoined: (payload) => joined.push(payload),
    });
    await connection.ready;
    connection.join("session-1", "join-1");
    await vi.waitFor(() => expect(joined).toHaveLength(1));

    const payload = joined[0] as { match_id: string; seat: string; view: { state_version: number } };
    expect(payload.match_id).toBe("session-1");
    expect(payload.seat).toBe("E");
    expect(payload.view.state_version).toBe(2);
    expect(typeof payload.view.state_version).toBe("number");
  });

  it("reshapes wire chow_sets objects into tuples and normalizes settlement/claim int64 fields", async () => {
    const fake = new FakeFetch();
    const states: unknown[] = [];
    const connection = createMatchRuntimeConnection("player-token", {
      url: "https://match.test/mahjong",
      namespace: "gameswithout-mahjong",
      fetchImpl: fake.fetchImpl,
      onState: (payload) => states.push(payload),
    });
    await connection.ready;
    connection.sync();
    // sync() before join() reports a configuration error and makes no
    // request — join first so currentMatchId is set.
    expect(fake.calls).toHaveLength(0);
    fake.enqueue(200, { state: wireMatchState() });
    connection.join("session-1");
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));

    fake.enqueue(200, {
      state: wireMatchState({
        phase: "claim_window",
        claim: {
          action_id: "claim-6",
          state_version: "6",
          discard: { seat: "E", tile: { id: "dots-9-1", kind: "dots", rank: 9, copy: 1 }, sequence: "6" },
          deadline: "2026-07-18T12:00:10Z",
          eligible: ["S"],
          own_response: { action_id: "claim-6", seat: "S", type: "pass", state_version: "6", response_revision: "1" },
          options: {
            can_win: true,
            can_pong: false,
            can_kong: false,
            chow_sets: [{ tile_ids: ["dots-3-1", "dots-5-1"] }],
          },
        },
        settlement: {
          transfers: [{ from: "S", to: "E", effective_tai: "4", raw_amount: "40", amount: "40" }],
          net: { E: "40", S: "-40" },
          total_credits: "40",
          total_debits: "40",
        },
      }),
    });
    connection.sync("sync-1");
    await vi.waitFor(() => expect(states).toHaveLength(1));
    const view = (states[0] as { view: Record<string, any> }).view;
    expect(view.claim.state_version).toBe(6);
    expect(view.claim.discard.sequence).toBe(6);
    expect(view.claim.own_response.response_revision).toBe(1);
    expect(view.claim.options.chow_sets).toEqual([["dots-3-1", "dots-5-1"]]);
    expect(view.settlement.net).toEqual({ E: 40, S: -40 });
    expect(view.settlement.transfers[0].amount).toBe(40);
  });

  it("defaults omitted int64 fields to 0 instead of throwing (protojson zero-value omission)", async () => {
    // Caught live against the deployed service: protojson omits int64/
    // uint64 fields entirely when their value is exactly 0 — a discard's
    // sequence 0, a claim response's revision 0, a settlement transfer of
    // 0 are all legitimate and common, not malformed responses.
    const fake = new FakeFetch();
    fake.enqueue(200, {
      state: {
        ...wireMatchState(),
        state_version: "0",
        last_discard: { seat: "E", tile: { id: "dots-1-1", kind: "dots", rank: 1, copy: 1 } }, // sequence omitted
        claim: {
          action_id: "claim-0",
          // state_version omitted
          discard: { seat: "E", tile: { id: "dots-1-1", kind: "dots", rank: 1, copy: 1 } }, // sequence omitted
          deadline: "2026-07-18T12:00:10Z",
          eligible: ["S"],
          own_response: { action_id: "claim-0", seat: "S", type: "pass" }, // state_version, response_revision omitted
          options: {},
        },
        settlement: {
          net: {},
          transfers: [{ from: "S", to: "E" }], // effective_tai, raw_amount, amount omitted
          // total_credits, total_debits omitted
        },
      },
    });
    const joined: unknown[] = [];
    const errors: MatchRuntimeError[] = [];
    const connection = createMatchRuntimeConnection("player-token", {
      url: "https://match.test/mahjong",
      namespace: "gameswithout-mahjong",
      fetchImpl: fake.fetchImpl,
      onJoined: (payload) => joined.push(payload),
      onError: (error) => errors.push(error),
    });
    await connection.ready;
    connection.join("session-1");
    await vi.waitFor(() => expect(joined.length + errors.length).toBeGreaterThan(0));

    expect(errors).toEqual([]);
    const view = (joined[0] as { view: Record<string, any> }).view;
    expect(view.state_version).toBe(0);
    expect(view.last_discard.sequence).toBe(0);
    expect(view.claim.state_version).toBe(0);
    expect(view.claim.discard.sequence).toBe(0);
    expect(view.claim.own_response.state_version).toBe(0);
    expect(view.claim.own_response.response_revision).toBe(0);
    expect(view.settlement.transfers[0].effective_tai).toBe(0);
    expect(view.settlement.total_credits).toBe(0);
    expect(view.settlement.total_debits).toBe(0);
  });

  it("submits typed commands, mapping the client command type to the proto enum name", async () => {
    const fake = new FakeFetch();
    const accepted: unknown[] = [];
    const states: unknown[] = [];
    const connection = createMatchRuntimeConnection("player-token", {
      url: "https://match.test/mahjong",
      namespace: "gameswithout-mahjong",
      fetchImpl: fake.fetchImpl,
      onCommandAccepted: (payload) => accepted.push(payload),
      onState: (payload) => states.push(payload),
    });
    await connection.ready;

    fake.enqueue(200, {
      request_id: "draw-1",
      state_version: "3",
      phase: "awaiting_discard",
      state: wireMatchState({ state_version: "3", phase: "awaiting_discard" }),
    });
    connection.command({ match_id: "session-1", type: "draw", expected_version: 2 }, "draw-1");
    await vi.waitFor(() => expect(accepted).toHaveLength(1));

    const call = fake.calls.at(-1)!;
    expect(call.url).toBe(
      "https://match.test/mahjong/v1/namespaces/gameswithout-mahjong/sessions/session-1/matches/session-1/commands",
    );
    expect(call.body).toMatchObject({
      request_id: "draw-1",
      type: "MATCH_COMMAND_TYPE_DRAW",
      expected_version: 2,
    });
    // A single REST round trip carries both the ack and the fresh view,
    // where the old WS protocol needed two separate server frames.
    expect(accepted[0]).toMatchObject({ match_id: "session-1", seat: "E", state_version: 3, phase: "awaiting_discard" });
    expect(states).toHaveLength(1);
  });

  it("sends only the ClaimCommand proto fields, dropping seat/state_version the parser rejects", async () => {
    const fake = new FakeFetch();
    const connection = createMatchRuntimeConnection("player-token", {
      url: "https://match.test/mahjong",
      namespace: "gameswithout-mahjong",
      fetchImpl: fake.fetchImpl,
    });
    await connection.ready;

    fake.enqueue(200, { state: wireMatchState({ state_version: "7", phase: "awaiting_draw" }) });
    connection.command(
      {
        match_id: "session-1",
        type: "submit_claim",
        expected_version: 6,
        // The client holds a full ClaimResponse (seat + state_version drive
        // the UI), but the service's ClaimCommand proto defines only five
        // fields and its JSON parser rejects unknown ones — so seat and
        // state_version must not be sent on the wire.
        claim: {
          action_id: "claim-6",
          seat: "S",
          type: "pass",
          tile_ids: [],
          state_version: 6,
          response_revision: 0,
          deliberate: true,
        },
      },
      "claim-1",
    );
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));

    const body = fake.calls.at(-1)!.body as { claim: Record<string, unknown> };
    expect(body.claim).toEqual({
      action_id: "claim-6",
      type: "pass",
      tile_ids: [],
      response_revision: 0,
      deliberate: true,
    });
    expect(body.claim).not.toHaveProperty("seat");
    expect(body.claim).not.toHaveProperty("state_version");
  });

  it("rejects a response whose match_id does not match the requested match", async () => {
    const fake = new FakeFetch();
    fake.enqueue(200, { state: wireMatchState({ match_id: "wrong-match" }) });
    const errors: MatchRuntimeError[] = [];
    const connection = createMatchRuntimeConnection("player-token", {
      url: "https://match.test/mahjong",
      namespace: "gameswithout-mahjong",
      fetchImpl: fake.fetchImpl,
      onError: (error) => errors.push(error),
    });
    await connection.ready;
    connection.join("session-1");
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toMatchObject({ code: "protocol" });
  });

  it("maps HTTP status codes to typed runtime failures", async () => {
    const cases: Array<{ status: number; code: string }> = [
      { status: 401, code: "configuration" },
      { status: 500, code: "network" },
      { status: 429, code: "network" },
      { status: 400, code: "protocol" },
      { status: 404, code: "not_found" },
    ];
    for (const { status, code } of cases) {
      const fake = new FakeFetch();
      fake.enqueue(status, { message: `boom-${status}` });
      const errors: MatchRuntimeError[] = [];
      const connection = createMatchRuntimeConnection("secret-token", {
        url: "https://match.test/mahjong",
        namespace: "gameswithout-mahjong",
        fetchImpl: fake.fetchImpl,
        onError: (error) => errors.push(error),
      });
      await connection.ready;
      connection.join("session-1");
      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(errors[0]).toMatchObject({ code });
      expect(errors[0].message).toContain(`boom-${status}`);
      expect(String(errors[0])).not.toContain("secret-token");
    }
  });

  it("reports a network error when fetch itself throws (offline)", async () => {
    const fake = new FakeFetch();
    fake.enqueueRejection(new TypeError("Failed to fetch"));
    const errors: MatchRuntimeError[] = [];
    const connection = createMatchRuntimeConnection("player-token", {
      url: "https://match.test/mahjong",
      namespace: "gameswithout-mahjong",
      fetchImpl: fake.fetchImpl,
      onError: (error) => errors.push(error),
    });
    await connection.ready;
    connection.join("session-1");
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toMatchObject({ code: "network" });
  });

  it("rejects missing configuration synchronously", () => {
    expect(() =>
      createMatchRuntimeConnection("", { url: "https://match.test/mahjong", namespace: "gameswithout-mahjong" }),
    ).toThrow("Guest sign-in is required");
    expect(() => createMatchRuntimeConnection("token", { url: "", namespace: "gameswithout-mahjong" })).toThrow(
      "Match runtime URL is not configured",
    );
    expect(() => createMatchRuntimeConnection("token", { url: "https://match.test/mahjong", namespace: "" })).toThrow(
      "AGS namespace is not configured",
    );
  });

  describe("timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("aborts and reports a timeout when the match service does not respond in time", async () => {
      const fake = new FakeFetch();
      fake.enqueueHang();
      const errors: MatchRuntimeError[] = [];
      const connection = createMatchRuntimeConnection("player-token", {
        url: "https://match.test/mahjong",
        namespace: "gameswithout-mahjong",
        timeoutMs: 1_000,
        fetchImpl: fake.fetchImpl,
        onError: (error) => errors.push(error),
      });
      await connection.ready;
      connection.join("session-1");

      await vi.advanceTimersByTimeAsync(1_000);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: "timeout" });
    });
  });
});
