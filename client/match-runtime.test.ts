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
  private readonly queue: Array<
    { status: number; body: unknown } | "hang" | { reject: unknown } | { response: Response }
  > = [];

  enqueue(status: number, body: unknown): void {
    this.queue.push({ status, body });
  }

  // For the cases where the headers are the point — an ETag, a bodiless 304 —
  // rather than just the status and payload.
  enqueueResponse(response: Response): void {
    this.queue.push({ response });
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
    if ("response" in next) {
      return next.response;
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

  it("normalizes welfare amounts embedded in a completed match projection", async () => {
    const fake = new FakeFetch();
    fake.enqueue(200, {
      state: wireMatchState({
        jade_account: {
          currency_code: "JADE",
          balance: "400",
          reserved: "0",
          available: "400",
          eligible: false,
          minimum_balance: "1000",
          stake_per_tai: "10",
          debit_cap: "300",
          welfare_eligible: true,
          welfare_amount: "600",
          welfare_reason: "available",
        },
      }),
    });
    const joined: unknown[] = [];
    const connection = createMatchRuntimeConnection("player-token", {
      url: "https://match.test/mahjong",
      namespace: "gameswithout-mahjong",
      fetchImpl: fake.fetchImpl,
      onJoined: (payload) => joined.push(payload),
    });
    await connection.ready;
    connection.join("session-1");
    await vi.waitFor(() => expect(joined).toHaveLength(1));

    const account = (joined[0] as { view: { jade_account: Record<string, unknown> } }).view
      .jade_account;
    expect(account.welfare_eligible).toBe(true);
    expect(account.welfare_amount).toBe(600);
    expect(account.welfare_reason).toBe("available");
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

  // Most polls land while somebody is still deciding, so the view has not
  // moved and resending it is pure cost on a metered link.
  describe("conditional polling", () => {
    function jsonWithETag(body: unknown, etag: string): Response {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: etag },
      });
    }

    it("replays the last tag and reports an unchanged view without re-rendering", async () => {
      const fake = new FakeFetch();
      const states: unknown[] = [];
      let unchanged = 0;
      const connection = createMatchRuntimeConnection("player-token", {
        url: "https://match.test/mahjong",
        namespace: "gameswithout-mahjong",
        fetchImpl: fake.fetchImpl,
        onState: (payload) => states.push(payload),
        onUnchanged: () => {
          unchanged += 1;
        },
      });
      await connection.ready;

      fake.enqueue(200, { state: wireMatchState() });
      connection.join("session-1");
      await vi.waitFor(() => expect(fake.calls).toHaveLength(1));

      // The first poll has no tag to offer yet.
      fake.enqueueResponse(jsonWithETag({ state: wireMatchState() }, 'W/"v2"'));
      connection.sync();
      await vi.waitFor(() => expect(states).toHaveLength(1));
      expect(fake.calls[1].headers["if-none-match"]).toBeUndefined();

      fake.enqueueResponse(new Response(null, { status: 304 }));
      connection.sync();
      await vi.waitFor(() => expect(unchanged).toBe(1));
      expect(fake.calls[2].headers["if-none-match"]).toBe('W/"v2"');
      // Nothing changed, so nothing was re-rendered.
      expect(states).toHaveLength(1);
    });

    it("adopts the new tag when the view does move", async () => {
      const fake = new FakeFetch();
      const states: unknown[] = [];
      const connection = createMatchRuntimeConnection("player-token", {
        url: "https://match.test/mahjong",
        namespace: "gameswithout-mahjong",
        fetchImpl: fake.fetchImpl,
        onState: (payload) => states.push(payload),
      });
      await connection.ready;
      fake.enqueue(200, { state: wireMatchState() });
      connection.join("session-1");
      await vi.waitFor(() => expect(fake.calls).toHaveLength(1));

      fake.enqueueResponse(jsonWithETag({ state: wireMatchState() }, 'W/"v2"'));
      connection.sync();
      await vi.waitFor(() => expect(states).toHaveLength(1));

      fake.enqueueResponse(jsonWithETag({ state: wireMatchState({ state_version: "3" }) }, 'W/"v3"'));
      connection.sync();
      await vi.waitFor(() => expect(states).toHaveLength(2));

      fake.enqueueResponse(new Response(null, { status: 304 }));
      connection.sync();
      await vi.waitFor(() => expect(fake.calls).toHaveLength(4));
      expect(fake.calls[3].headers["if-none-match"]).toBe('W/"v3"');
    });

    // A command's response is newer than any tag a poll collected, so offering
    // the old tag afterwards could have the service confirm a superseded view.
    it("drops the tag after a command supplies a fresher view", async () => {
      const fake = new FakeFetch();
      const states: unknown[] = [];
      const connection = createMatchRuntimeConnection("player-token", {
        url: "https://match.test/mahjong",
        namespace: "gameswithout-mahjong",
        fetchImpl: fake.fetchImpl,
        onState: (payload) => states.push(payload),
      });
      await connection.ready;
      fake.enqueue(200, { state: wireMatchState() });
      connection.join("session-1");
      await vi.waitFor(() => expect(fake.calls).toHaveLength(1));

      fake.enqueueResponse(jsonWithETag({ state: wireMatchState() }, 'W/"v2"'));
      connection.sync();
      await vi.waitFor(() => expect(states).toHaveLength(1));

      fake.enqueue(200, { state: wireMatchState({ state_version: "3" }) });
      connection.command({ match_id: "session-1", type: "draw", expected_version: 2 });
      await vi.waitFor(() => expect(states).toHaveLength(2));

      fake.enqueue(200, { state: wireMatchState({ state_version: "3" }) });
      connection.sync();
      await vi.waitFor(() => expect(fake.calls).toHaveLength(4));
      expect(fake.calls[3].headers["if-none-match"]).toBeUndefined();
    });
  });

  // A hand can outlast the token it started with, and a 401 is reported as a
  // configuration error the player cannot act on. Renewing and replaying turns
  // an unrecoverable mid-hand failure into something they never see.
  describe("expired access tokens", () => {
    function connectionWith(
      auth: { getAccessToken: () => string; refreshAccessToken?: () => Promise<boolean> },
      fake: FakeFetch,
      onState?: (payload: unknown) => void,
    ) {
      return createMatchRuntimeConnection(auth, {
        url: "https://match.test/mahjong",
        namespace: "gameswithout-mahjong",
        fetchImpl: fake.fetchImpl,
        onState,
      });
    }

    it("renews the token and replays the request, using the new token", async () => {
      const fake = new FakeFetch();
      const states: unknown[] = [];
      let token = "expired-token";
      let refreshes = 0;
      const connection = connectionWith(
        {
          getAccessToken: () => token,
          refreshAccessToken: async () => {
            refreshes += 1;
            token = "fresh-token";
            return true;
          },
        },
        fake,
        (payload) => states.push(payload),
      );
      await connection.ready;
      fake.enqueue(200, { state: wireMatchState() });
      connection.join("session-1");
      await vi.waitFor(() => expect(fake.calls).toHaveLength(1));

      fake.enqueue(401, { message: "token expired" });
      fake.enqueue(200, { state: wireMatchState({ state_version: "5" }) });
      connection.sync();

      await vi.waitFor(() => expect(states).toHaveLength(1));
      expect(refreshes).toBe(1);
      expect(fake.calls).toHaveLength(3);
      expect(fake.calls[1].headers.authorization).toBe("Bearer expired-token");
      expect(fake.calls[2].headers.authorization).toBe("Bearer fresh-token");
    });

    // Auth that is genuinely gone must still surface, not retry forever.
    it("reports the 401 when renewal does not produce a new token", async () => {
      const fake = new FakeFetch();
      const errors: MatchRuntimeError[] = [];
      const connection = createMatchRuntimeConnection(
        { getAccessToken: () => "expired-token", refreshAccessToken: async () => false },
        {
          url: "https://match.test/mahjong",
          namespace: "gameswithout-mahjong",
          fetchImpl: fake.fetchImpl,
          onError: (error) => errors.push(error),
        },
      );
      await connection.ready;
      fake.enqueue(200, { state: wireMatchState() });
      connection.join("session-1");
      await vi.waitFor(() => expect(fake.calls).toHaveLength(1));

      fake.enqueue(401, { message: "token expired" });
      connection.sync();

      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(errors[0].code).toBe("configuration");
      expect(fake.calls).toHaveLength(2);
    });

    it("does not replay a 401 when the caller cannot renew", async () => {
      const fake = new FakeFetch();
      const errors: MatchRuntimeError[] = [];
      const connection = createMatchRuntimeConnection("static-token", {
        url: "https://match.test/mahjong",
        namespace: "gameswithout-mahjong",
        fetchImpl: fake.fetchImpl,
        onError: (error) => errors.push(error),
      });
      await connection.ready;
      fake.enqueue(200, { state: wireMatchState() });
      connection.join("session-1");
      await vi.waitFor(() => expect(fake.calls).toHaveLength(1));

      fake.enqueue(401, { message: "token expired" });
      connection.sync();

      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(fake.calls).toHaveLength(2);
    });

    // The token is read per request, so a renewal that happened for some other
    // reason is picked up without tearing the connection down and rejoining.
    it("reads the current token on every request rather than the one it opened with", async () => {
      const fake = new FakeFetch();
      let token = "token-1";
      const connection = connectionWith({ getAccessToken: () => token }, fake);
      await connection.ready;
      fake.enqueue(200, { state: wireMatchState() });
      connection.join("session-1");
      await vi.waitFor(() => expect(fake.calls).toHaveLength(1));

      token = "token-2";
      fake.enqueue(200, { state: wireMatchState() });
      connection.sync();
      await vi.waitFor(() => expect(fake.calls).toHaveLength(2));

      expect(fake.calls[0].headers.authorization).toBe("Bearer token-1");
      expect(fake.calls[1].headers.authorization).toBe("Bearer token-2");
    });
  });

  // A cellular round trip regularly outlasts the 4s poll interval, so the loop
  // asks for another sync while one is still outstanding. Issuing it would put
  // two requests on the same connection competing to answer the same question.
  it("drops a sync issued while one is still in flight, and resumes once it settles", async () => {
    const fake = new FakeFetch();
    const states: unknown[] = [];
    const errors: MatchRuntimeError[] = [];
    const connection = createMatchRuntimeConnection("player-token", {
      url: "https://match.test/mahjong",
      namespace: "gameswithout-mahjong",
      fetchImpl: fake.fetchImpl,
      // Short enough that the hung poll below times out promptly under the
      // real timers this suite runs on.
      timeoutMs: 20,
      onState: (payload) => states.push(payload),
      onError: (error) => errors.push(error),
    });
    await connection.ready;

    fake.enqueue(200, { state: wireMatchState() });
    connection.join("session-1");
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));

    // A slow poll that has not come back yet.
    fake.enqueueHang();
    connection.sync();
    await vi.waitFor(() => expect(fake.calls).toHaveLength(2));

    connection.sync();
    connection.sync();
    expect(fake.calls).toHaveLength(2);

    // Once the slow poll settles — here by timing out, as it would on a link
    // that went away — the loop is free to try again.
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0].code).toBe("timeout");

    fake.enqueue(200, { state: wireMatchState({ state_version: "3" }) });
    connection.sync();
    await vi.waitFor(() => expect(states).toHaveLength(1));
    expect(fake.calls).toHaveLength(3);
  });

  // The service replays a committed result for a repeated request_id, and
  // rebuilds that map from the event log, so ids must not restart at 1 when a
  // dropped mobile connection is re-established: the resumed connection's
  // first command would otherwise be answered with the dropped connection's
  // first command's result, silently discarding the player's actual move.
  it("generates request ids that do not repeat across reconnections", async () => {
    const requestIdFor = async (): Promise<string> => {
      const fake = new FakeFetch();
      const connection = createMatchRuntimeConnection("player-token", {
        url: "https://match.test/mahjong",
        namespace: "gameswithout-mahjong",
        fetchImpl: fake.fetchImpl,
      });
      await connection.ready;
      fake.enqueue(200, { state: wireMatchState() });
      connection.command({ match_id: "session-1", type: "draw", expected_version: 2 });
      await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
      return (fake.calls[0].body as { request_id: string }).request_id;
    };

    expect(await requestIdFor()).not.toBe(await requestIdFor());
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

  it("sends self-turn Win and concealed Gang commands through the authoritative API", async () => {
    const fake = new FakeFetch();
    const connection = createMatchRuntimeConnection("player-token", {
      url: "https://match.test/mahjong",
      namespace: "gameswithout-mahjong",
      fetchImpl: fake.fetchImpl,
    });
    await connection.ready;

    fake.enqueue(200, { state: wireMatchState({ state_version: "8", phase: "hand_complete" }) });
    connection.command({
      match_id: "session-1",
      type: "declare_zimo",
      expected_version: 7,
    }, "zimo-1");
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    expect(fake.calls[0].body).toMatchObject({
      type: "MATCH_COMMAND_TYPE_DECLARE_ZIMO",
      expected_version: 7,
    });

    fake.enqueue(200, { state: wireMatchState({ state_version: "9", phase: "awaiting_discard" }) });
    connection.command({
      match_id: "session-1",
      type: "declare_concealed_kong",
      expected_version: 8,
      tile_ids: ["dots-4-1", "dots-4-2", "dots-4-3", "dots-4-4"],
    }, "kong-1");
    await vi.waitFor(() => expect(fake.calls).toHaveLength(2));
    expect(fake.calls[1].body).toMatchObject({
      type: "MATCH_COMMAND_TYPE_DECLARE_CONCEALED_KONG",
      tile_ids: ["dots-4-1", "dots-4-2", "dots-4-3", "dots-4-4"],
    });
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
