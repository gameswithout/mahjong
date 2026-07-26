import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { JadeAccount } from "../protocol/envelope";
import { LobbyHeader } from "./LobbyHeader";
import { RULES_VERSION } from "./rules-version";

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
  it("leads with spendable Jade and the ruleset in play", () => {
    const markup = renderToStaticMarkup(
      <LobbyHeader guest={false} account={account} jadeStatus="ready" connection="connected" />,
    );

    expect(markup).toContain("5,000");
    expect(markup).toContain("Taiwanese 16-tile");
    expect(markup).toContain(RULES_VERSION);
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
    expect(markup).toContain("300 reserved");
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

    expect(markup).toContain("Unavailable");
    expect(markup).not.toContain(">0<");
  });
});
