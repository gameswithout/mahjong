import { describe, expect, it, vi } from "vitest";

import { createFeedbackClient } from "./feedback";

describe("feedback client", () => {
  it("stores private account feedback with its match session ID", async () => {
    const put = vi.fn().mockResolvedValue({ data: {} });
    const sdk = {
      assembly: () => ({ axiosInstance: { put } }),
    };
    const client = createFeedbackClient(
      sdk as never,
      "mahjong",
      "player 1",
      () => 1_722_000_000_000,
    );

    await client.submit({
      category: "gameplay",
      summary: "Gang failed",
      details: "The action was rejected.",
      sessionId: "match-123",
    });

    expect(put).toHaveBeenCalledWith(
      "/cloudsave/v1/namespaces/mahjong/users/player%201/records/mahjong-feedback-1722000000000",
      expect.objectContaining({
        isPublic: false,
        value: expect.objectContaining({
          category: "gameplay",
          sessionId: "match-123",
          summary: "Gang failed",
        }),
      }),
    );
  });
});
