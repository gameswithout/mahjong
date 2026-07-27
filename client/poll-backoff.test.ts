import { describe, expect, it } from "vitest";

import {
  MAX_RECONNECT_ATTEMPTS,
  POLL_BASE_INTERVAL_MS,
  POLL_MAX_INTERVAL_MS,
  pollDelayMs,
  RECONNECT_MAX_DELAY_MS,
  reconnectDelayMs,
} from "./poll-backoff";

describe("pollDelayMs", () => {
  it("polls at exactly the base interval while healthy", () => {
    expect(pollDelayMs(0)).toBe(POLL_BASE_INTERVAL_MS);
  });

  it("backs off exponentially as failures accumulate", () => {
    // random() = 1 is the top of each jitter window, which is the plain
    // exponential value.
    const top = (failures: number) => pollDelayMs(failures, () => 1);
    expect(top(1)).toBe(8_000);
    expect(top(2)).toBe(16_000);
    expect(top(3)).toBe(30_000);
  });

  it("never exceeds the ceiling, however long the outage runs", () => {
    for (const failures of [4, 10, 100]) {
      expect(pollDelayMs(failures, () => 1)).toBe(POLL_MAX_INTERVAL_MS);
    }
  });

  // Four seats dropped by the same handover must not retry in lockstep.
  it("spreads retries across half the backoff window", () => {
    expect(pollDelayMs(3, () => 0)).toBe(POLL_MAX_INTERVAL_MS / 2);
    expect(pollDelayMs(3, () => 1)).toBe(POLL_MAX_INTERVAL_MS);
    expect(pollDelayMs(3, () => 0.5)).toBe(POLL_MAX_INTERVAL_MS * 0.75);
  });

  it("keeps at least half the backoff so a jittered retry is never eager", () => {
    for (const failures of [1, 2, 3, 5]) {
      expect(pollDelayMs(failures, () => 0)).toBeGreaterThanOrEqual(POLL_BASE_INTERVAL_MS);
    }
  });

  it("treats a negative or fractional failure count as the healthy case", () => {
    expect(pollDelayMs(-3)).toBe(POLL_BASE_INTERVAL_MS);
    expect(pollDelayMs(0.6)).toBe(POLL_BASE_INTERVAL_MS);
  });
});

describe("reconnectDelayMs", () => {
  it("starts around two seconds and doubles up to the ceiling", () => {
    const top = (attempt: number) => reconnectDelayMs(attempt, () => 1);
    expect(top(0)).toBe(2_000);
    expect(top(1)).toBe(4_000);
    expect(top(2)).toBe(8_000);
    expect(top(3)).toBe(RECONNECT_MAX_DELAY_MS);
    expect(top(7)).toBe(RECONNECT_MAX_DELAY_MS);
  });

  // The whole budget has to outlast the blackouts a phone recovers from on its
  // own — a tunnel, a lift, an LTE/5G handover. Ten seconds did not.
  it("spans at least a minute across the full attempt budget", () => {
    let worstCase = 0;
    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      worstCase += reconnectDelayMs(attempt, () => 1);
    }
    expect(worstCase).toBeGreaterThanOrEqual(60_000);
  });
});
