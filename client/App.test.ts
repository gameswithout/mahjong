import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ageInYears } from "./App";

// §10.3: minimum stated age is 13, computed from month/year only (never a
// full birth date).
describe("ageInYears", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts a full year once the birth month has passed this year", () => {
    expect(ageInYears(2013, 1)).toBe(13);
    expect(ageInYears(2013, 7)).toBe(13);
  });

  it("has not yet turned this year's age when the birth month hasn't arrived", () => {
    expect(ageInYears(2013, 8)).toBe(12);
    expect(ageInYears(2013, 12)).toBe(12);
  });
});
