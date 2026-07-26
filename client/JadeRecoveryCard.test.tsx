import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JadeAccount } from "../protocol/envelope";
import { JadeRecoveryCard } from "./JadeRecoveryCard";

function account(overrides: Partial<JadeAccount> = {}): JadeAccount {
  return {
    currency_code: "JADE",
    balance: 400,
    reserved: 0,
    available: 400,
    eligible: false,
    minimum_balance: 1_000,
    stake_per_tai: 10,
    debit_cap: 300,
    welfare_eligible: false,
    welfare_amount: 0,
    welfare_reason: "practice_hand_required",
    ...overrides,
  };
}

describe("JadeRecoveryCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("explains the Practice prerequisite without pretending the grant is ready", () => {
    act(() => {
      root.render(
        <JadeRecoveryCard account={account()} state={{ status: "idle" }} onClaim={vi.fn()} />,
      );
    });

    expect(container.textContent).toContain("Finish one free Practice hand today");
    expect(container.querySelector("button")).toBeNull();
  });

  it("claims exactly the server-calculated top-up once Practice unlocks it", () => {
    const onClaim = vi.fn();
    act(() => {
      root.render(
        <JadeRecoveryCard
          account={account({
            welfare_eligible: true,
            welfare_amount: 600,
            welfare_reason: "available",
          })}
          state={{ status: "idle" }}
          onClaim={onClaim}
        />,
      );
    });

    const claim = container.querySelector("button");
    expect(claim?.textContent).toBe("Claim 600 Jade");
    act(() => claim?.click());
    expect(onClaim).toHaveBeenCalledOnce();
  });

  it("states the UTC reset after today's recovery has been used", () => {
    act(() => {
      root.render(
        <JadeRecoveryCard
          account={account({ welfare_reason: "claimed_today" })}
          state={{ status: "idle" }}
          onClaim={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("resets at 00:00 UTC");
  });

  it("announces a successful recovery after the balance becomes eligible", () => {
    act(() => {
      root.render(
        <JadeRecoveryCard
          account={account({ balance: 1_000, available: 1_000, eligible: true })}
          state={{ status: "success", message: "Recovered 600 Jade. Bamboo is open again." }}
          onClaim={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Bamboo is open again",
    );
  });

  it("stays absent against a pre-faucet service response", () => {
    act(() => {
      root.render(
        <JadeRecoveryCard
          account={account({ welfare_reason: undefined })}
          state={{ status: "idle" }}
          onClaim={vi.fn()}
        />,
      );
    });

    expect(container.innerHTML).toBe("");
  });
});
