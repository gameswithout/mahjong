import { describe, expect, it, vi } from "vitest";

import type { SeatView } from "../protocol/envelope";
import { seatViewToMatchTableState } from "./matchTableAdapter";

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
      { seat: "E", hand_count: 1 },
      { seat: "S", hand_count: 16 },
      { seat: "W", hand_count: 16 },
      { seat: "N", hand_count: 16 },
    ],
    wall: { remaining: 79, drawable_remaining: 63, reserve_remaining: 16 },
    ...overrides,
  };
}

describe("seatViewToMatchTableState", () => {
  it("maps own hand, seat metadata, and wall counts", () => {
    const state = seatViewToMatchTableState(seatView(), { now: Date.now(), onClaimAction: vi.fn() });
    expect(state.localSeat).toBe("E");
    expect(state.seats.E.hand?.map((t) => t.id)).toEqual(["characters-1-1"]);
    expect(state.seats.E.handCount).toBe(1);
    expect(state.seats.S.hand).toBeUndefined();
    expect(state.seats.S.handCount).toBe(16);
    expect(state.wall.drawableRemaining).toBe(63);
    expect(state.wall.reserveRemaining).toBe(16);
  });

  it("maps takenOver from each player's public taken_over flag, defaulting to false", () => {
    const state = seatViewToMatchTableState(
      seatView({
        players: [
          { seat: "E", hand_count: 1 },
          { seat: "S", hand_count: 16, taken_over: true },
          { seat: "W", hand_count: 16 },
          { seat: "N", hand_count: 16 },
        ],
      }),
      { now: Date.now(), onClaimAction: vi.fn() },
    );
    expect(state.seats.S.takenOver).toBe(true);
    expect(state.seats.E.takenOver).toBe(false);
    expect(state.seats.W.takenOver).toBe(false);
  });

  it("groups the public discard pile by seat", () => {
    const state = seatViewToMatchTableState(
      seatView({
        discards: [
          { seat: "E", tile: { id: "dots-1-1", kind: "dots", rank: 1, copy: 1 }, sequence: 1 },
          { seat: "S", tile: { id: "bamboo-2-1", kind: "bamboo", rank: 2, copy: 1 }, sequence: 2 },
          { seat: "E", tile: { id: "dots-3-1", kind: "dots", rank: 3, copy: 1 }, sequence: 3 },
        ],
      }),
      { now: Date.now(), onClaimAction: vi.fn() },
    );
    expect(state.seats.E.discards.map((t) => t.id)).toEqual(["dots-1-1", "dots-3-1"]);
    expect(state.seats.S.discards.map((t) => t.id)).toEqual(["bamboo-2-1"]);
    expect(state.seats.W.discards).toEqual([]);
  });

  it("renders another seat's concealed meld as a redacted placeholder", () => {
    const state = seatViewToMatchTableState(
      seatView({
        players: [
          { seat: "E", hand_count: 1 },
          { seat: "S", hand_count: 10, melds: [{ type: "kong", concealed: true }] },
          { seat: "W", hand_count: 16 },
          { seat: "N", hand_count: 16 },
        ],
      }),
      { now: Date.now(), onClaimAction: vi.fn() },
    );
    const meld = state.seats.S.melds[0];
    expect(meld.type).toBe("kong");
    expect(meld.concealed).toBe(true);
    expect(meld.tiles).toEqual([]);
    expect(meld.tileCount).toBe(4);
  });

  it("renders an exposed meld's real tiles for every seat", () => {
    const state = seatViewToMatchTableState(
      seatView({
        players: [
          { seat: "E", hand_count: 1 },
          {
            seat: "S",
            hand_count: 10,
            melds: [
              {
                type: "pong",
                concealed: false,
                tiles: [
                  { id: "wind-east-1", kind: "wind" },
                  { id: "wind-east-2", kind: "wind" },
                  { id: "wind-east-3", kind: "wind" },
                ],
              },
            ],
          },
          { seat: "W", hand_count: 16 },
          { seat: "N", hand_count: 16 },
        ],
      }),
      { now: Date.now(), onClaimAction: vi.fn() },
    );
    const meld = state.seats.S.melds[0];
    expect(meld.concealed).toBe(false);
    expect(meld.tiles.map((t) => t.id)).toEqual(["wind-east-1", "wind-east-2", "wind-east-3"]);
    expect(meld.tileCount).toBeUndefined();
  });

  it("maps the local seat's own concealed melds from own_melds, not the redacted players entry", () => {
    const state = seatViewToMatchTableState(
      seatView({
        own_melds: [{ type: "kong", concealed: true, tiles: [
          { id: "dots-5-1", kind: "dots", rank: 5, copy: 1 },
          { id: "dots-5-2", kind: "dots", rank: 5, copy: 2 },
          { id: "dots-5-3", kind: "dots", rank: 5, copy: 3 },
          { id: "dots-5-4", kind: "dots", rank: 5, copy: 4 },
        ] }],
      }),
      { now: Date.now(), onClaimAction: vi.fn() },
    );
    expect(state.seats.E.melds[0].tiles.map((t) => t.id)).toEqual([
      "dots-5-1",
      "dots-5-2",
      "dots-5-3",
      "dots-5-4",
    ]);
    expect(state.seats.E.melds[0].tileCount).toBeUndefined();
  });

  it("computes the claim countdown from claim.deadline, capped at the claim total", () => {
    const now = Date.parse("2026-07-19T10:00:00.000Z");
    const state = seatViewToMatchTableState(
      seatView({
        phase: "claim_window",
        claim: {
          action_id: "action-1",
          state_version: 2,
          discard: { seat: "S", tile: { id: "dots-1-1", kind: "dots", rank: 1, copy: 1 }, sequence: 1 },
          deadline: "2026-07-19T10:00:04.000Z",
          eligible: ["E"],
          options: {},
        },
      }),
      { now, onClaimAction: vi.fn() },
    );
    expect(state.countdownSeconds).toBe(4);
    expect(state.countdownTotalSeconds).toBe(7);
    expect(state.claimSource).toBe("S");
  });

  it("computes the turn countdown from turn_deadline only while awaiting draw/discard", () => {
    const now = Date.parse("2026-07-19T10:00:00.000Z");
    const state = seatViewToMatchTableState(
      seatView({ phase: "awaiting_discard", turn_deadline: "2026-07-19T10:00:09.000Z" }),
      { now, onClaimAction: vi.fn() },
    );
    expect(state.countdownSeconds).toBe(9);
    expect(state.countdownTotalSeconds).toBe(15);
  });

  it("floors an expired deadline's countdown at zero rather than going negative", () => {
    const now = Date.parse("2026-07-19T10:00:10.000Z");
    const state = seatViewToMatchTableState(
      seatView({ phase: "awaiting_discard", turn_deadline: "2026-07-19T10:00:00.000Z" }),
      { now, onClaimAction: vi.fn() },
    );
    expect(state.countdownSeconds).toBe(0);
  });

  describe("legalActions (claim window)", () => {
    function claimView(options: Partial<SeatView["claim"]> = {}) {
      return seatView({
        phase: "claim_window",
        claim: {
          action_id: "action-1",
          state_version: 2,
          discard: { seat: "S", tile: { id: "dots-1-1", kind: "dots", rank: 1, copy: 1 }, sequence: 1 },
          deadline: "2026-07-19T10:00:04.000Z",
          eligible: ["E"],
          options: {},
          ...options,
        },
      });
    }

    it("is empty when the seat is not eligible", () => {
      const view = seatView({
        phase: "claim_window",
        claim: {
          action_id: "action-1",
          state_version: 2,
          discard: { seat: "S", tile: { id: "dots-1-1", kind: "dots", rank: 1, copy: 1 }, sequence: 1 },
          deadline: "2026-07-19T10:00:04.000Z",
          eligible: ["W"],
          options: {},
        },
      });
      const state = seatViewToMatchTableState(view, { now: Date.now(), onClaimAction: vi.fn() });
      expect(state.legalActions).toEqual([]);
    });

    it("keeps offering actions after an initial response, marking the chosen one (revision-until-deadline)", () => {
      const view = claimView({
        options: { can_pong: true },
        own_response: { seat: "E", type: "pass", state_version: 2, response_revision: 0 },
      });
      const dispatch = vi.fn();
      const state = seatViewToMatchTableState(view, { now: Date.now(), onClaimAction: dispatch });
      expect(state.legalActions.map((a) => a.id)).toEqual(["pong", "pass"]);
      expect(state.legalActions.find((a) => a.id === "pass")!.label).toBe("Pass ✓");
      expect(state.legalActions.find((a) => a.id === "pong")!.label).toBe("Pong");
      // Revising is still a real dispatch — the caller submits the new
      // choice with an incremented response_revision, which SubmitClaim
      // accepts right up to the deadline.
      state.legalActions.find((a) => a.id === "pong")!.onClick!();
      expect(dispatch).toHaveBeenCalledWith("pong");
    });

    it("marks the chosen chow set specifically, not just any chow button", () => {
      const view = claimView({
        options: {
          chow_sets: [
            ["characters-2-1", "characters-3-1"],
            ["characters-3-1", "characters-4-1"],
          ],
        },
        own_response: {
          seat: "E",
          type: "chow",
          tile_ids: ["characters-3-1", "characters-4-1"],
          state_version: 2,
          response_revision: 0,
        },
      });
      const state = seatViewToMatchTableState(view, { now: Date.now(), onClaimAction: vi.fn() });
      const chowActions = state.legalActions.filter((a) => a.id.startsWith("chow"));
      expect(chowActions.map((a) => a.label)).toEqual(["Chow 1", "Chow 2 ✓"]);
    });

    it("disables every claim action while a previous one is still pending", () => {
      const view = claimView({ options: { can_pong: true } });
      const state = seatViewToMatchTableState(view, {
        now: Date.now(),
        onClaimAction: vi.fn(),
        claimActionPending: true,
      });
      expect(state.legalActions.every((a) => a.disabled)).toBe(true);
    });

    it("always offers Pass alongside whatever the server marked legal", () => {
      const view = claimView({ options: { can_pong: true } });
      const dispatch = vi.fn();
      const state = seatViewToMatchTableState(view, { now: Date.now(), onClaimAction: dispatch });
      expect(state.legalActions.map((a) => a.id)).toEqual(["pong", "pass"]);
      state.legalActions.find((a) => a.id === "pong")!.onClick!();
      expect(dispatch).toHaveBeenCalledWith("pong");
    });

    it("never offers an action the server did not mark legal", () => {
      const view = claimView({ options: {} });
      const state = seatViewToMatchTableState(view, { now: Date.now(), onClaimAction: vi.fn() });
      expect(state.legalActions.map((a) => a.id)).toEqual(["pass"]);
    });

    it("offers one button per chow_sets entry and passes the right tile pair through", () => {
      const view = claimView({
        options: {
          chow_sets: [
            ["characters-2-1", "characters-3-1"],
            ["characters-3-1", "characters-4-1"],
          ],
        },
      });
      const dispatch = vi.fn();
      const state = seatViewToMatchTableState(view, { now: Date.now(), onClaimAction: dispatch });
      const chowActions = state.legalActions.filter((a) => a.id.startsWith("chow"));
      expect(chowActions).toHaveLength(2);
      chowActions[1].onClick!();
      expect(dispatch).toHaveBeenCalledWith("chow", ["characters-3-1", "characters-4-1"]);
    });
  });
});
