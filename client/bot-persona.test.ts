import { describe, expect, it } from "vitest";

import type { PlayerView } from "../protocol/envelope";
import { botBadgeLabel, seatDisplayName, seatPersona } from "./bot-persona";

const sparrow: PlayerView = {
  seat: "E",
  hand_count: 16,
  is_bot: true,
  bot_persona_id: "swift-sparrow",
  bot_persona_name: "Swift Sparrow",
  bot_style_tag: "Rush",
  bot_glyph: "雀",
};

describe("seatPersona", () => {
  it("reads the persona off a named bot seat", () => {
    expect(seatPersona(sparrow)).toEqual({
      id: "swift-sparrow",
      name: "Swift Sparrow",
      styleTag: "Rush",
      glyph: "雀",
    });
  });

  // These three cases render identically but are genuinely different, and
  // none of them may be given a name the server did not send.
  it("returns nothing for a human, a takeover, or a pre-persona match", () => {
    expect(seatPersona({ seat: "S", hand_count: 16 })).toBeNull();
    expect(
      seatPersona({ seat: "W", hand_count: 16, taken_over: true }),
    ).toBeNull();
    expect(seatPersona({ seat: "N", hand_count: 16, is_bot: true })).toBeNull();
    expect(seatPersona(undefined)).toBeNull();
  });

  // A whitespace-only name would otherwise pass a truthiness check and
  // render a seat with no visible label at all.
  it("treats a blank name as no persona", () => {
    expect(
      seatPersona({ ...sparrow, bot_persona_name: "   " }),
    ).toBeNull();
  });
});

describe("seatDisplayName", () => {
  it("names the local player, humans, and bots", () => {
    expect(seatDisplayName(sparrow, true)).toBe("You");
    expect(seatDisplayName(sparrow, false)).toBe("Swift Sparrow");
    expect(seatDisplayName({ seat: "S", hand_count: 16 }, false)).toBe("Player");
    expect(
      seatDisplayName({ seat: "N", hand_count: 16, is_bot: true }, false),
    ).toBe("Bot");
  });

  it("calls the local seat You even when it is somehow flagged a bot", () => {
    // A takeover of the viewer's own seat still renders as theirs; being
    // told "Bot" about your own hand would be worse than useless.
    expect(
      seatDisplayName({ seat: "E", hand_count: 16, is_bot: true }, true),
    ).toBe("You");
  });
});

describe("botBadgeLabel", () => {
  // §11 requires a bot to stay visibly a bot, so the style rides alongside
  // the word rather than replacing it — a badge reading only "Rush" would
  // look like a human's chosen nickname.
  it("keeps the word Bot regardless of style", () => {
    expect(botBadgeLabel("Rush")).toBe("Bot · Rush");
    expect(botBadgeLabel("Guard")).toBe("Bot · Guard");
    expect(botBadgeLabel(undefined)).toBe("Bot");
    expect(botBadgeLabel("")).toBe("Bot");
    expect(botBadgeLabel("   ")).toBe("Bot");
  });
});
