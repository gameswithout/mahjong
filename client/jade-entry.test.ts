import { describe, expect, it } from "vitest";

import type { JadeAccount } from "../protocol/envelope";
import { jadeEntryRequirementMessage, jadeEntryShortfall, stakeSummary } from "./jade-entry";

function account(overrides: Partial<JadeAccount> = {}): JadeAccount {
  return {
    currency_code: "JADE",
    balance: 5_000,
    reserved: 0,
    available: 5_000,
    eligible: true,
    minimum_balance: 1_000,
    stake_per_tai: 10,
    debit_cap: 300,
    ...overrides,
  };
}

describe("jade entry requirements", () => {
  it("treats the server's verdict as the only authority on eligibility", () => {
    // Balances far below the stated requirement, but the server said yes.
    // Nothing here may second-guess that.
    expect(jadeEntryShortfall(account({ balance: 0, available: 0 }))).toBeNull();
    expect(jadeEntryRequirementMessage(account({ balance: 0, available: 0 }))).toBe("");
  });

  it("names the exact shortfall when the balance is too low", () => {
    const message = jadeEntryRequirementMessage(
      account({ balance: 400, available: 400, eligible: false }),
    );

    expect(message).toContain("1,000 Jade in your balance");
    expect(message).toContain("300 Jade available");
    expect(message).toContain("You have 400 Jade");
    expect(message).toContain("600 short");
  });

  it("distinguishes a reserved balance from an empty one", () => {
    const message = jadeEntryRequirementMessage(
      account({ balance: 5_000, reserved: 4_900, available: 100, eligible: false }),
    );

    // A player holding 5,000 Jade must not be told they are short of 1,000.
    expect(message).not.toContain("short");
    expect(message).toContain("4,900 is still reserved for another table");
    expect(message).toContain("100 available");
  });

  it("quotes the server's own stake values, and stays silent without them", () => {
    expect(stakeSummary(account())).toBe(
      "Queues a new table · 10 Jade per Tai · 300 Jade maximum loss",
    );
    expect(stakeSummary(account({ stake_per_tai: 0 }))).toBeUndefined();
    expect(stakeSummary(undefined)).toBeUndefined();
  });
});
