import { describe, expect, it, vi } from "vitest";

import type { SeatView } from "../protocol/envelope";
import { createFreshPracticeSession, isPracticeMatch } from "./practice-flow";
import { SessionLookupError, type GameSessionSummary } from "./session";

const freshSession: GameSessionSummary = {
  sessionId: "practice-new",
  status: "JOINED",
  members: [{ userId: "player-1" }],
};

describe("createFreshPracticeSession", () => {
  it("creates a bot-padded Practice Session for the first hand", async () => {
    const client = {
      leaveSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(freshSession),
    };

    await expect(createFreshPracticeSession(client)).resolves.toEqual(freshSession);
    expect(client.leaveSession).not.toHaveBeenCalled();
    expect(client.createSession).toHaveBeenCalledWith({ ai_practice: "true" });
  });

  it("leaves the completed Session before creating a replay hand", async () => {
    const calls: string[] = [];
    const onPreviousSessionLeft = vi.fn();
    const client = {
      leaveSession: vi.fn(async (sessionId: string) => {
        calls.push(`leave:${sessionId}`);
      }),
      createSession: vi.fn(async () => {
        calls.push("create");
        return freshSession;
      }),
    };

    await expect(
      createFreshPracticeSession(client, "practice-old", onPreviousSessionLeft),
    ).resolves.toEqual(freshSession);

    expect(calls).toEqual(["leave:practice-old", "create"]);
    expect(onPreviousSessionLeft).toHaveBeenCalledOnce();
    expect(client.createSession).toHaveBeenCalledWith({ ai_practice: "true" });
  });

  it("does not create another Session when leaving the completed one fails", async () => {
    const client = {
      leaveSession: vi.fn().mockRejectedValue(new Error("leave failed")),
      createSession: vi.fn(),
    };

    await expect(createFreshPracticeSession(client, "practice-old")).rejects.toThrow(
      "leave failed",
    );
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("reports a successful leave even when replacement creation fails", async () => {
    const onPreviousSessionLeft = vi.fn();
    const client = {
      leaveSession: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockRejectedValue(new Error("create failed")),
    };

    await expect(
      createFreshPracticeSession(client, "practice-old", onPreviousSessionLeft),
    ).rejects.toThrow("create failed");

    expect(onPreviousSessionLeft).toHaveBeenCalledOnce();
  });

  it("treats an already-missing completed Session as successfully left", async () => {
    const onPreviousSessionLeft = vi.fn();
    const client = {
      leaveSession: vi
        .fn()
        .mockRejectedValue(new SessionLookupError("not_found", "already gone")),
      createSession: vi.fn().mockResolvedValue(freshSession),
    };

    await expect(
      createFreshPracticeSession(client, "practice-old", onPreviousSessionLeft),
    ).resolves.toEqual(freshSession);

    expect(onPreviousSessionLeft).toHaveBeenCalledOnce();
    expect(client.createSession).toHaveBeenCalledOnce();
  });
});

describe("isPracticeMatch", () => {
  function view(isBot: boolean): SeatView {
    return {
      match_id: "match-1",
      seat: "E",
      state_version: 1,
      phase: "awaiting_discard",
      active_seat: "E",
      own_hand: [],
      own_exposed: [],
      players: [
        { seat: "E", hand_count: 17 },
        { seat: "S", hand_count: 16, taken_over: !isBot, is_bot: isBot },
        { seat: "W", hand_count: 16, is_bot: isBot },
        { seat: "N", hand_count: 16, is_bot: isBot },
      ],
      wall: { remaining: 79, drawable_remaining: 63, reserve_remaining: 16 },
    };
  }

  it("derives Practice from the authoritative bot-seat projection", () => {
    expect(isPracticeMatch(view(true))).toBe(true);
    // A disconnected human can be taken over by AI without making the hand
    // non-persistent Practice; only a permanent bot-seat flag counts.
    expect(isPracticeMatch(view(false))).toBe(false);
  });
});
