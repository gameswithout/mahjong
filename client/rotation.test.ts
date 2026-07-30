import { describe, expect, it } from "vitest";

import type { RotationState } from "../protocol/envelope";
import {
  completionSummary,
  dealerName,
  formatTablePoints,
  handHeadline,
  isFullRotation,
  placementLabel,
  placementNote,
  rotationProgress,
  secondsUntilNextHand,
  standingsForDisplay,
} from "./rotation";

function rotation(overrides: Partial<RotationState> = {}): RotationState {
  return {
    hand_number: 1,
    hands_played: 0,
    continuations: 0,
    seats_dealt: 0,
    dealer_user_id: "alice",
    standings: [
      { user_id: "alice", position: "E", wind: "E", table_points: 0 },
      { user_id: "bob", position: "S", wind: "S", table_points: 0 },
      { user_id: "carol", position: "W", wind: "W", table_points: 0 },
      { user_id: "dave", position: "N", wind: "N", table_points: 0 },
    ],
    ...overrides,
  };
}

describe("mode detection", () => {
  it("treats a match without a rotation block as Quick Play", () => {
    expect(isFullRotation({})).toBe(false);
    expect(isFullRotation({ rotation: rotation() })).toBe(true);
  });
});

describe("table points", () => {
  it("signs a positive total so a gain reads as one", () => {
    expect(formatTablePoints(32)).toBe("+32");
  });

  it("shows a negative total as it is", () => {
    // §8.4 lets table points go below zero. Clamping or hiding that would
    // misrepresent the standings a rating is computed from.
    expect(formatTablePoints(-18)).toBe("-18");
  });

  it("shows zero without a sign", () => {
    expect(formatTablePoints(0)).toBe("0");
    expect(formatTablePoints(undefined)).toBe("0");
  });
});

describe("progress through the round", () => {
  it("counts dealers, not hands", () => {
    // A dealer who keeps winning retains the deal (§5.11), so six hands can
    // have passed with only two players having dealt. Counting hands would
    // show the match nearly over when it has barely started.
    const state = rotation({ hand_number: 6, hands_played: 5, seats_dealt: 2 });
    const progress = rotationProgress(state);
    expect(progress.dealt).toBe(2);
    expect(progress.total).toBe(4);
    expect(progress.label).toBe("2 of 4 players have dealt");
  });
});

describe("hand headline", () => {
  it("names the dealer for an ordinary hand", () => {
    expect(handHeadline(rotation({ hand_number: 3 }), "Bob")).toBe("Hand 3 — Bob deals");
  });

  it("says a dealer is repeating rather than leaving the count unexplained", () => {
    // The continuation is why the hand number and the deal count disagree. A
    // player not told will read the rotation as stuck.
    expect(handHeadline(rotation({ hand_number: 4, continuations: 1 }), "Bob")).toBe(
      "Hand 4 — Bob deals again",
    );
    expect(handHeadline(rotation({ hand_number: 6, continuations: 3 }), "Bob")).toBe(
      "Hand 6 — Bob deals 4 times running",
    );
  });
});

describe("inter-hand countdown", () => {
  const now = new Date("2026-07-30T12:00:00Z");

  it("counts down to the next hand", () => {
    const state = rotation({ next_hand_opens_at: "2026-07-30T12:00:20Z" });
    expect(secondsUntilNextHand(state, now)).toBe(20);
  });

  it("clamps a past instant to zero rather than counting backwards", () => {
    // A client clock a few seconds ahead of the server would otherwise show a
    // negative countdown.
    const state = rotation({ next_hand_opens_at: "2026-07-30T11:59:55Z" });
    expect(secondsUntilNextHand(state, now)).toBe(0);
  });

  it("has nothing to count when the match is over", () => {
    const state = rotation({ next_hand_opens_at: "2026-07-30T12:00:20Z", complete: true });
    expect(secondsUntilNextHand(state, now)).toBeNull();
  });

  it("has nothing to count mid-hand", () => {
    expect(secondsUntilNextHand(rotation(), now)).toBeNull();
  });
});

describe("completion summary", () => {
  it("says nothing while the match is running", () => {
    expect(completionSummary(rotation())).toBeNull();
  });

  it("reports a completed round plainly", () => {
    const state = rotation({ complete: true, reason: "rotation_complete", seats_dealt: 4 });
    expect(completionSummary(state)).toContain("Every player has dealt");
  });

  it("says a match cut short by the clock left the rotation unfinished", () => {
    // §8.4 calls this ending structurally asymmetric. Presenting it as an
    // ordinary finish would hide that some players never dealt.
    const state = rotation({ complete: true, reason: "time_limit", seats_dealt: 2 });
    const summary = completionSummary(state);
    expect(summary).toContain("60 minutes");
    expect(summary).toContain("2 of 4");
  });
});

describe("placements", () => {
  it("labels the four finishing positions", () => {
    expect([1, 2, 3, 4].map(placementLabel)).toEqual(["1st", "2nd", "3rd", "4th"]);
  });

  it("marks a tie rather than presenting it as a clean finish", () => {
    // §8.4 breaks equal points for display but treats them as a genuine tie
    // for rating, so an unqualified "2nd" would misrepresent the result.
    expect(placementNote({ user_id: "bob", position: 2, rating_tie: true })).toBe(
      "Tied on table points",
    );
    expect(placementNote({ user_id: "bob", position: 2 })).toBeNull();
  });
});

describe("standings for display", () => {
  it("keeps the server's order and marks the viewer", () => {
    // Re-sorting client-side risks disagreeing with the podium the server
    // produces at the end.
    const state = rotation({
      standings: [
        { user_id: "carol", position: "W", wind: "N", table_points: 40 },
        { user_id: "alice", position: "E", wind: "S", table_points: -10 },
        { user_id: "bob", position: "S", wind: "W", table_points: -12 },
        { user_id: "dave", position: "N", wind: "E", table_points: -18 },
      ],
    });
    const rows = standingsForDisplay(state, "bob");
    expect(rows.map((row) => row.user_id)).toEqual(["carol", "alice", "bob", "dave"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
    expect(rows.find((row) => row.isSelf)?.user_id).toBe("bob");
  });

  it("marks nobody when the viewer is unknown", () => {
    expect(standingsForDisplay(rotation(), undefined).some((row) => row.isSelf)).toBe(false);
  });
});

describe("dealer name", () => {
  it("prefers a resolved display name", () => {
    expect(dealerName(rotation(), () => "Alice")).toBe("Alice");
  });

  it("falls back to the seat rather than showing a raw user ID", () => {
    // An opaque AGS UUID tells a player nothing; a chair at the table does.
    const state = rotation({
      dealer_user_id: "dave",
      standings: [{ user_id: "dave", position: "N", wind: "E" }],
    });
    expect(dealerName(state, () => undefined)).toBe("East");
  });

  it("copes with a rotation that names no dealer", () => {
    expect(dealerName(rotation({ dealer_user_id: undefined }), () => undefined)).toBe("The dealer");
  });
});
