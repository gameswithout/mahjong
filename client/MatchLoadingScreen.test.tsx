import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SeatView } from "../protocol/envelope";
import { MatchLoadingScreen } from "./MatchLoadingScreen";

const loadingScreenStyles = readFileSync(resolve(process.cwd(), "client/styles.css"), "utf8");

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

function personaView(): SeatView {
  const view = loadingView();
  view.players = [
    {
      seat: "E",
      hand_count: 16,
      is_bot: true,
      bot_persona_id: "swift-sparrow",
      bot_persona_name: "Swift Sparrow",
      bot_style_tag: "Rush",
      bot_glyph: "雀",
    },
    { seat: "S", hand_count: 16 },
    {
      seat: "W",
      hand_count: 16,
      is_bot: true,
      bot_persona_id: "stone-lion",
      bot_persona_name: "Stone Lion",
      bot_style_tag: "Guard",
      bot_glyph: "獅",
    },
    // A bot the service sent no persona for — an older match, or a roster
    // this deployment does not carry.
    { seat: "N", hand_count: 16, is_bot: true },
  ];
  return view;
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
    expect(markup).toContain("Setting up the table");
    expect(markup).not.toContain("Players ready");
    expect(markup).not.toContain("Setting the table...");
    expect(markup).toContain('data-seat="S" data-position="bottom"');
    expect(markup).toContain('data-seat="W" data-position="right"');
    expect(markup).toContain('data-seat="N" data-position="top"');
    expect(markup).toContain('data-seat="E" data-position="left"');
    expect(markup.match(/match-loading-shared-profile/g)).toHaveLength(4);
    expect(markup.match(/profile-tile-icon/g)).toHaveLength(12);
  });

  // The table names these seats too, and the two screens used to hold
  // separate copies of the rule — so this screen introduced an opponent as
  // "Bot" and the table called the same seat Swift Sparrow moments later.
  it("names each bot by its personality and shows the style", () => {
    const markup = renderToStaticMarkup(<MatchLoadingScreen view={personaView()} />);

    expect(markup).toContain("Swift Sparrow");
    expect(markup).toContain("Bot · Rush");
    expect(markup).toContain("Stone Lion");
    expect(markup).toContain("Bot · Guard");
    expect(markup).toContain("雀");
  });

  it("falls back to Bot for a seat with no personality", () => {
    const markup = renderToStaticMarkup(<MatchLoadingScreen view={personaView()} />);

    // North carries no persona, so it stays the plain label and contributes
    // no style line at all rather than an empty one.
    expect(markup).toContain(">Bot<");
    expect(markup.match(/match-loading-persona-tag/g)).toHaveLength(2);
  });

  it("never labels the local player or a human seat as a bot", () => {
    const markup = renderToStaticMarkup(<MatchLoadingScreen view={personaView()} />);
    const localBlock = markup.slice(markup.indexOf('data-seat="S"'), markup.indexOf('data-seat="W"'));

    expect(localBlock).toContain("You");
    expect(localBlock).not.toContain("match-loading-persona");
  });

  it("allows the shared profile badge to use the loading card width", () => {
    expect(loadingScreenStyles).toMatch(
      /\.match-loading-shared-profile\s*\{[^}]*--player-profile-width:\s*100%;[^}]*inline-size:\s*100%;[^}]*max-inline-size:\s*none;/s,
    );
    expect(loadingScreenStyles).toMatch(
      /\.match-loading-shared-profile \.profile-nickname\s*\{[^}]*flex:\s*1 1 auto;[^}]*max-width:\s*none;[^}]*min-width:\s*0;/s,
    );
  });
});
