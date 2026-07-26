import { describe, expect, it } from "vitest";

import {
  QUEUE_PATIENCE_MS,
  queueElapsedLabel,
  queueHealth,
  queueHealthMessage,
} from "./queue-health";

describe("queue health", () => {
  it("escalates at the specification's 30 and 90 second marks", () => {
    expect(queueHealth(0)).toBe("starting");
    expect(queueHealth(29_999)).toBe("starting");
    expect(queueHealth(30_000)).toBe("normal");
    expect(queueHealth(89_999)).toBe("normal");
    expect(queueHealth(QUEUE_PATIENCE_MS)).toBe("slow");
    expect(queueHealth(10 * 60_000)).toBe("slow");
  });

  it("never promises a wait time it cannot know", () => {
    // The client cannot see queue depth. An estimate would be the one number
    // players would hold us to, so no message may contain one.
    for (const health of ["starting", "normal", "slow"] as const) {
      const message = queueHealthMessage(health);
      expect(message).not.toMatch(/\d/);
      expect(message.toLowerCase()).not.toContain("estimated");
    }
  });

  it("explains why a slow queue is slow rather than only that it is", () => {
    expect(queueHealthMessage("slow").toLowerCase()).toContain("four players");
    expect(queueHealthMessage("slow")).toContain("bot");
  });

  it("reads elapsed time in whole seconds, then minutes", () => {
    expect(queueElapsedLabel(0)).toBe("0s in queue");
    expect(queueElapsedLabel(45_400)).toBe("45s in queue");
    expect(queueElapsedLabel(59_999)).toBe("59s in queue");
    expect(queueElapsedLabel(60_000)).toBe("1m 00s in queue");
    expect(queueElapsedLabel(95_000)).toBe("1m 35s in queue");
    // A clock that runs backwards is a bug elsewhere; it must not render one.
    expect(queueElapsedLabel(-5_000)).toBe("0s in queue");
  });
});
