import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SeatView } from "../protocol/envelope";
import { MatchLoadingScreen } from "./MatchLoadingScreen";

function loadingView(): SeatView {
  return {
    match_id: "practice-1",
    seat: "S",
    state_version: 1,
    phase: "awaiting_draw",
    active_seat: "E",
    own_hand: [],
    own_exposed: [],
    players: [
      { seat: "E", hand_count: 16, is_bot: true },
      { seat: "S", hand_count: 16 },
      { seat: "W", hand_count: 16, is_bot: true },
      { seat: "N", hand_count: 16, is_bot: true },
    ],
    wall: { remaining: 80, drawable_remaining: 64, reserve_remaining: 16 },
  };
}

describe("MatchLoadingScreen", () => {
  it("shows all four profiles in seat order with local, bot, wind, and dealer identity", () => {
    const markup = renderToStaticMarkup(<MatchLoadingScreen view={loadingView()} />);

    expect(markup.match(/data-seat="/g)).toHaveLength(4);
    expect(markup.indexOf('data-seat="E"')).toBeLessThan(markup.indexOf('data-seat="S"'));
    expect(markup.indexOf('data-seat="S"')).toBeLessThan(markup.indexOf('data-seat="W"'));
    expect(markup).toContain("You");
    expect(markup.match(/>Bot</g)).toHaveLength(3);
    expect(markup).toContain("East seat");
    expect(markup).toContain("Dealer");
    expect(markup).toContain("Entering the Mahjong table");
    expect(markup.match(/match-loading-shared-profile/g)).toHaveLength(4);
    expect(markup.match(/profile-tile-icon/g)).toHaveLength(12);
  });
});
