import { beforeEach, describe, expect, it } from "vitest";

import { RESULT_SCENARIOS } from "./resultWireframeMockData";
import { loadMatchReview, saveMatchReview, savedMatchReviewIds } from "./match-reviews";

describe("saved match reviews", () => {
  beforeEach(() => window.localStorage.clear());

  it("reopens the complete authoritative result for the same account", () => {
    const view = structuredClone(RESULT_SCENARIOS[2].view);
    saveMatchReview("learner", view);

    expect(savedMatchReviewIds("learner")).toEqual(new Set([view.match_id]));
    expect(loadMatchReview("learner", view.match_id)?.hand_result).toEqual(view.hand_result);
    expect(loadMatchReview("another-player", view.match_id)).toBeNull();
  });

  it("bounds local history without discarding the newest reviews", () => {
    const fixture = RESULT_SCENARIOS[3].view;
    for (let index = 0; index < 21; index += 1) {
      saveMatchReview("learner", { ...structuredClone(fixture), match_id: `match-${index}` });
    }

    expect(savedMatchReviewIds("learner").size).toBe(20);
    expect(loadMatchReview("learner", "match-20")).not.toBeNull();
    expect(loadMatchReview("learner", "match-0")).toBeNull();
  });
});
