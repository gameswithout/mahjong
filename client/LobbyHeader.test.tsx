import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { JadeAccount } from "../protocol/envelope";
import { LobbyHeader } from "./LobbyHeader";

const account: JadeAccount = {
  currency_code: "JADE",
  balance: 5_000,
  reserved: 0,
  available: 5_000,
  eligible: true,
  minimum_balance: 1_000,
  stake_per_tai: 10,
  debit_cap: 300,
};

describe("LobbyHeader", () => {
  it("leads with spendable Jade while keeping rules in Settings", () => {
    const markup = renderToStaticMarkup(
      <LobbyHeader guest={false} account={account} jadeStatus="ready" connection="connected" />,
    );

    expect(markup).toContain("5,000");
    expect(markup).not.toContain("Taiwanese 16-tile");
    expect(markup).not.toContain("Rules");
  });

  it("shows authoritative level progress as the route to the full curve", () => {
    const markup = renderToStaticMarkup(
      <LobbyHeader
        guest={false}
        account={account}
        jadeStatus="ready"
        connection="connected"
        progressionStatus="ready"
        progression={{
          level: 3,
          lifetime_xp: 1_400,
          xp_into_level: 300,
          xp_for_next_level: 700,
        }}
      />,
    );

    expect(markup).toContain("Level 3");
    expect(markup).toContain("300 / 700 XP");
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-label="Open progression, level 3"');
    expect(markup).not.toContain("Level 0");
  });

  it("shows a new account without enabling empty progression", () => {
    const markup = renderToStaticMarkup(
      <LobbyHeader
        guest={false}
        account={account}
        jadeStatus="ready"
        connection="connected"
        progressionStatus="ready"
        progression={{ level: 1, lifetime_xp: 0, xp_into_level: 0, xp_for_next_level: 500 }}
      />,
    );

    expect(markup).toContain("No progress yet");
    expect(markup).toContain("0 / 500 XP");
    expect(markup).not.toContain("0 experience");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain(">Unavailable<");
  });

  it("separates reserved Jade from what can actually be spent", () => {
    const markup = renderToStaticMarkup(
      <LobbyHeader
        guest={false}
        account={{ ...account, reserved: 300, available: 4_700 }}
        jadeStatus="ready"
        connection="connected"
      />,
    );

    // The headline number is the spendable one; the reservation is disclosed
    // beside it rather than silently subtracted or silently included.
    expect(markup).toContain("4,700");
    expect(markup).toContain("300 Jade reserved");
  });

  it("tells a guest their progress is device-bound", () => {
    const markup = renderToStaticMarkup(
      <LobbyHeader guest account={account} jadeStatus="ready" connection="connected" />,
    );

    expect(markup).toContain("Guest player");
    expect(markup).toContain("tied to this device");
  });

  it("shows connection state only when it is not healthy", () => {
    const healthy = renderToStaticMarkup(
      <LobbyHeader guest={false} account={account} jadeStatus="ready" connection="connected" />,
    );
    const dropped = renderToStaticMarkup(
      <LobbyHeader guest={false} account={account} jadeStatus="ready" connection="reconnecting" />,
    );

    // A permanent "connected" badge is status for its own sake; the lobby only
    // spends a line on the connection when something is wrong with it.
    expect(healthy).not.toContain("Connecting");
    expect(healthy).not.toContain("Reconnecting");
    expect(dropped).toContain("Reconnecting");
  });

  it("says the balance is unavailable rather than showing a confident zero", () => {
    const markup = renderToStaticMarkup(
      <LobbyHeader guest={false} jadeStatus="error" connection="connected" />,
    );

    expect(markup).toContain("View Progress");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Unavailable");
    expect(markup).not.toContain("Tael");
  });

  it("uses the same tile-based profile shape and locks guest nicknames", () => {
    const markup = renderToStaticMarkup(
      <LobbyHeader guest account={account} jadeStatus="ready" connection="connected" />,
    );

    expect(markup).toContain("Profile slot 1");
    expect(markup).toContain("Profile slot 2");
    expect(markup).toContain("Profile slot 3");
    expect(markup).toContain("Slot 1");
    expect(markup).toContain("Slot 2");
    expect(markup).toContain("Slot 3");
    expect(markup).toContain("Personalize your player profile");
    expect(markup).toContain('maxLength="16"');
    expect(markup).toContain(">Store<");
    expect(markup).toContain(">create an account<");
    expect(markup).toContain("disabled");
    expect(markup.match(/for slot 1/g)?.length).toBe(42);
    expect(markup.indexOf("tied to this device")).toBeLessThan(
      markup.length,
    );
    expect(markup.indexOf("<summary>Edit</summary>")).toBeGreaterThan(
      markup.indexOf("Guest player"),
    );
    expect(markup).not.toContain("Rules");
  });
});
