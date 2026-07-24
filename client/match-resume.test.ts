import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MATCH_RESUME_CLOCK_SKEW_MS,
  MATCH_RESUME_MAX_AGE_MS,
  MATCH_RESUME_STORAGE_KEY,
  browserMatchResumeStore,
  isResumablePointer,
  parseResumePointer,
  type MatchResumePointer,
} from "./match-resume";

const pointer = (overrides: Partial<MatchResumePointer> = {}): MatchResumePointer => ({
  sessionId: "session-123",
  userId: "guest-abc",
  savedAt: 1_000,
  ...overrides,
});

describe("parseResumePointer", () => {
  it("returns null for missing input", () => {
    expect(parseResumePointer(null)).toBeNull();
    expect(parseResumePointer("")).toBeNull();
  });

  it("returns null for non-JSON", () => {
    expect(parseResumePointer("not json {")).toBeNull();
  });

  it("returns null when required fields are missing or wrong-typed", () => {
    expect(parseResumePointer(JSON.stringify({ sessionId: "s", userId: "u" }))).toBeNull();
    expect(parseResumePointer(JSON.stringify({ sessionId: "", userId: "u", savedAt: 1 }))).toBeNull();
    expect(parseResumePointer(JSON.stringify({ sessionId: "s", userId: "", savedAt: 1 }))).toBeNull();
    expect(parseResumePointer(JSON.stringify({ sessionId: "s", userId: "u", savedAt: "1" }))).toBeNull();
    expect(
      parseResumePointer(JSON.stringify({ sessionId: "s", userId: "u", savedAt: Number.NaN })),
    ).toBeNull();
    expect(parseResumePointer(JSON.stringify(["s", "u", 1]))).toBeNull();
    expect(parseResumePointer(JSON.stringify("string"))).toBeNull();
  });

  it("parses a well-formed pointer and keeps only the known fields", () => {
    const parsed = parseResumePointer(
      JSON.stringify({ sessionId: "s", userId: "u", savedAt: 42, extra: "ignored" }),
    );
    expect(parsed).toEqual({ sessionId: "s", userId: "u", savedAt: 42 });
  });
});

describe("isResumablePointer", () => {
  it("accepts a pointer saved just now", () => {
    expect(isResumablePointer(pointer({ savedAt: 1_000 }), 1_000)).toBe(true);
  });

  it("accepts a pointer within the max age", () => {
    const savedAt = 1_000;
    expect(isResumablePointer(pointer({ savedAt }), savedAt + MATCH_RESUME_MAX_AGE_MS)).toBe(true);
  });

  it("rejects a pointer older than the max age", () => {
    const savedAt = 1_000;
    expect(isResumablePointer(pointer({ savedAt }), savedAt + MATCH_RESUME_MAX_AGE_MS + 1)).toBe(
      false,
    );
  });

  it("tolerates a small future skew but rejects a large one", () => {
    const savedAt = 10_000;
    expect(isResumablePointer(pointer({ savedAt }), savedAt - MATCH_RESUME_CLOCK_SKEW_MS)).toBe(true);
    expect(isResumablePointer(pointer({ savedAt }), savedAt - MATCH_RESUME_CLOCK_SKEW_MS - 1)).toBe(
      false,
    );
  });
});

describe("browserMatchResumeStore", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("round-trips a saved pointer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T00:00:00Z"));
    const now = Date.now();

    browserMatchResumeStore.save({ sessionId: "s-1", userId: "guest-1" });

    expect(browserMatchResumeStore.load(now)).toEqual({
      sessionId: "s-1",
      userId: "guest-1",
      savedAt: now,
    });
  });

  it("clears and returns null for a stale stored pointer", () => {
    window.localStorage.setItem(
      MATCH_RESUME_STORAGE_KEY,
      JSON.stringify(pointer({ savedAt: 0 })),
    );

    expect(browserMatchResumeStore.load(MATCH_RESUME_MAX_AGE_MS + 1)).toBeNull();
    expect(window.localStorage.getItem(MATCH_RESUME_STORAGE_KEY)).toBeNull();
  });

  it("clears and returns null for a corrupt stored pointer", () => {
    window.localStorage.setItem(MATCH_RESUME_STORAGE_KEY, "{ not valid");

    expect(browserMatchResumeStore.load(1_000)).toBeNull();
    expect(window.localStorage.getItem(MATCH_RESUME_STORAGE_KEY)).toBeNull();
  });

  it("clear() removes a stored pointer", () => {
    browserMatchResumeStore.save({ sessionId: "s-1", userId: "guest-1" });
    browserMatchResumeStore.clear();
    expect(window.localStorage.getItem(MATCH_RESUME_STORAGE_KEY)).toBeNull();
  });
});
