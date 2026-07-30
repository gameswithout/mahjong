import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RotationState } from "../protocol/envelope";
import { InterHandCountdown, RotationPanel, RotationPodium } from "./RotationPanel";

const names: Record<string, string> = {
  alice: "Alice",
  bob: "Bob",
  carol: "Carol",
  dave: "Dave",
};
const nameOf = (userId: string) => names[userId];

function rotation(overrides: Partial<RotationState> = {}): RotationState {
  return {
    hand_number: 2,
    hands_played: 1,
    continuations: 0,
    seats_dealt: 1,
    dealer_user_id: "bob",
    standings: [
      { user_id: "carol", position: "W", wind: "W", table_points: 40, dealing: false },
      { user_id: "alice", position: "E", wind: "N", table_points: -8, dealing: false },
      { user_id: "bob", position: "S", wind: "E", table_points: -12, dealing: true },
      { user_id: "dave", position: "N", wind: "S", table_points: -20, dealing: false },
    ],
    ...overrides,
  };
}

describe("RotationPanel", () => {
  it("lists every player with their table points", () => {
    const markup = renderToStaticMarkup(
      <RotationPanel rotation={rotation()} viewerUserId="alice" nameOf={nameOf} />,
    );
    for (const name of ["Carol", "Alice", "Bob", "Dave"]) {
      expect(markup).toContain(name);
    }
    expect(markup).toContain("+40");
  });

  it("shows a negative total rather than hiding it", () => {
    // §8.4 lets table points go below zero, and a player behind needs to know
    // by how much.
    const markup = renderToStaticMarkup(<RotationPanel rotation={rotation()} nameOf={nameOf} />);
    expect(markup).toContain("-20");
  });

  it("measures progress in players who have dealt, not hands played", () => {
    // A dealer who keeps winning holds the deal (§5.11). Counting hands would
    // tell a player the match was nearly over when it had barely begun.
    const markup = renderToStaticMarkup(
      <RotationPanel rotation={rotation({ hand_number: 6, hands_played: 5, seats_dealt: 2 })} />,
    );
    expect(markup).toContain("2 of 4 players have dealt");
    expect(markup).not.toContain("5 of 4");
  });

  it("names the dealer and says when they are repeating", () => {
    const markup = renderToStaticMarkup(
      <RotationPanel rotation={rotation({ continuations: 2 })} nameOf={nameOf} />,
    );
    expect(markup).toContain("Hand 2 — Bob deals 3 times running");
  });

  it("marks the viewing player", () => {
    const markup = renderToStaticMarkup(
      <RotationPanel rotation={rotation()} viewerUserId="bob" nameOf={nameOf} />,
    );
    expect(markup).toContain("(you)");
  });

  it("marks who is dealing this hand", () => {
    const markup = renderToStaticMarkup(<RotationPanel rotation={rotation()} nameOf={nameOf} />);
    expect(markup).toContain("dealing");
  });

  it("says table points are not Jade", () => {
    // The most confusable thing about the mode: it settles like a stake, but
    // §8.4 Full Rotation moves no currency at all.
    const markup = renderToStaticMarkup(<RotationPanel rotation={rotation()} nameOf={nameOf} />);
    expect(markup).toContain("stakes no Jade");
  });

  it("falls back to the seat when a name is unknown", () => {
    // An opaque AGS user ID on screen tells a player nothing.
    const markup = renderToStaticMarkup(<RotationPanel rotation={rotation()} />);
    expect(markup).toContain("West");
    expect(markup).not.toContain("carol");
  });
});

describe("InterHandCountdown", () => {
  it("counts down to the next hand", () => {
    const opensAt = new Date(Date.now() + 12_000).toISOString();
    const markup = renderToStaticMarkup(
      <InterHandCountdown rotation={rotation({ next_hand_opens_at: opensAt })} />,
    );
    expect(markup).toMatch(/Next hand in 1[12]s/);
  });

  it("shows nothing mid-hand", () => {
    expect(renderToStaticMarkup(<InterHandCountdown rotation={rotation()} />)).toBe("");
  });

  it("shows nothing once the match is over", () => {
    const opensAt = new Date(Date.now() + 12_000).toISOString();
    const markup = renderToStaticMarkup(
      <InterHandCountdown rotation={rotation({ next_hand_opens_at: opensAt, complete: true })} />,
    );
    expect(markup).toBe("");
  });

  it("reaches zero without going negative when the moment has passed", () => {
    // A client clock a little ahead of the server would otherwise render a
    // negative countdown that never resolves.
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <InterHandCountdown
          rotation={rotation({ next_hand_opens_at: new Date(Date.now() - 5_000).toISOString() })}
        />,
      );
    });
    expect(container.textContent).toContain("Dealing the next hand");
    expect(container.textContent).not.toContain("-");
    act(() => root.unmount());
    container.remove();
  });
});

describe("RotationPodium", () => {
  const finished = rotation({
    complete: true,
    reason: "rotation_complete",
    seats_dealt: 4,
    placements: [
      { user_id: "carol", position: 1, table_points: 40 },
      { user_id: "alice", position: 2, table_points: -8 },
      { user_id: "bob", position: 3, table_points: -12 },
      { user_id: "dave", position: 4, table_points: -20 },
    ],
  });

  it("stays absent until the match is complete", () => {
    expect(renderToStaticMarkup(<RotationPodium rotation={rotation()} />)).toBe("");
  });

  it("ranks every player", () => {
    const markup = renderToStaticMarkup(
      <RotationPodium rotation={finished} viewerUserId="bob" nameOf={nameOf} />,
    );
    for (const label of ["1st", "2nd", "3rd", "4th"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("Carol");
    expect(markup).toContain("-20");
  });

  it("discloses a rating tie rather than presenting a clean finish", () => {
    // §8.4 breaks equal table points for display but treats them as a genuine
    // tie for rating, so an unqualified "2nd" would misrepresent the result
    // the player's rating is about to be computed from.
    const markup = renderToStaticMarkup(
      <RotationPodium
        rotation={{
          ...finished,
          placements: [
            { user_id: "carol", position: 1, table_points: 20, rating_tie: true },
            { user_id: "alice", position: 2, table_points: 20, rating_tie: true },
            { user_id: "bob", position: 3, table_points: -20 },
            { user_id: "dave", position: 4, table_points: -20, rating_tie: true },
          ],
        }}
        nameOf={nameOf}
      />,
    );
    expect(markup.match(/Tied on table points/g)).toHaveLength(3);
  });

  it("says a completed round ran its course", () => {
    const markup = renderToStaticMarkup(<RotationPodium rotation={finished} nameOf={nameOf} />);
    expect(markup).toContain("Every player has dealt");
  });

  it("says a match cut short by the clock left the rotation unfinished", () => {
    // Presenting the time limit as an ordinary finish would hide that some
    // players never got to deal — which §8.4 calls structurally asymmetric.
    const markup = renderToStaticMarkup(
      <RotationPodium
        rotation={{ ...finished, reason: "time_limit", seats_dealt: 2 }}
        nameOf={nameOf}
      />,
    );
    expect(markup).toContain("60 minutes");
    expect(markup).toContain("2 of 4");
  });

  it("shows the placement XP when it was awarded", () => {
    const markup = renderToStaticMarkup(
      <RotationPodium
        rotation={{
          ...finished,
          placement_xp_award: {
            total: 250,
            components: [{ label: "2nd place", amount: 250 }],
          },
        }}
        nameOf={nameOf}
      />,
    );
    expect(markup).toContain("Placement XP: +250");
  });
});
