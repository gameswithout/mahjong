import { describe, expect, it, vi } from "vitest";

import {
  createProgressionClient,
  normalizeHandXPAward,
  normalizePlayerProgression,
} from "./progression";

const wireProgression = {
  level: 2,
  lifetime_xp: "725",
  xp_into_level: "225",
  xp_for_next_level: "600",
  earned: [
    {
      code: "level-2-student-title",
      level: 2,
      kind: "title",
      name: "Student",
    },
  ],
  next: {
    code: "level-5-tea-house-theme",
    level: 5,
    kind: "table_theme",
    name: "Tea House",
  },
  onboarding: {
    outcome: "ONBOARDING_OUTCOME_COMPLETED",
    recorded_at: "2026-07-27T12:00:00Z",
  },
};

describe("Progression client", () => {
  it("loads and normalizes protojson int64 fields across all 50 levels", async () => {
    const curve = Array.from({ length: 50 }, (_, index) => ({
      level: index + 1,
      total_xp_required: String(index * 500),
      xp_for_next_level: index === 49 ? undefined : String(500 + index * 100),
      rewards:
        index === 1
          ? [{
              code: "level-2-student-title",
              level: 2,
              kind: "title",
              name: "Student",
            }]
          : undefined,
    }));
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ progression: wireProgression, curve }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createProgressionClient("player-token", {
      url: "https://match.example.test/mahjong",
      namespace: "mahjong-test",
      fetchImpl,
    });

    const snapshot = await client.get();

    expect(snapshot.progression).toMatchObject({
      level: 2,
      lifetime_xp: 725,
      xp_into_level: 225,
      xp_for_next_level: 600,
      onboarding: { outcome: "ONBOARDING_OUTCOME_COMPLETED" },
    });
    expect(snapshot.curve).toHaveLength(50);
    expect(snapshot.curve[1]).toMatchObject({
      level: 2,
      total_xp_required: 500,
      xp_for_next_level: 600,
      rewards: [{ code: "level-2-student-title", name: "Student" }],
    });
    expect(snapshot.curve[49].xp_for_next_level).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://match.example.test/mahjong/v1/namespaces/mahjong-test/progression",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer player-token" }),
      }),
    );
  });

  it("records completion and skip as explicit, distinct outcomes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            progression: wireProgression,
            award: {
              award_id: "onboarding:player-1",
              source: "onboarding",
              total: 500,
              components: [{ code: "tutorial", label: "Tutorial", amount: 500 }],
            },
            granted: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ progression: wireProgression, award: { total: 500 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const client = createProgressionClient("player-token", {
      url: "https://match.example.test",
      namespace: "mahjong-test",
      fetchImpl,
    });

    await expect(
      client.awardOnboarding("ONBOARDING_OUTCOME_COMPLETED"),
    ).resolves.toMatchObject({
      granted: true,
      award: {
        award_id: "onboarding:player-1",
        total: 500,
        components: [{ code: "tutorial", amount: 500 }],
      },
    });
    await expect(
      client.awardOnboarding("ONBOARDING_OUTCOME_SKIPPED"),
    ).resolves.toMatchObject({ granted: false, award: { total: 500 } });

    expect(
      fetchImpl.mock.calls.map((call) =>
        JSON.parse(String((call[1] as RequestInit).body)),
      ),
    ).toEqual([
      { outcome: "ONBOARDING_OUTCOME_COMPLETED" },
      { outcome: "ONBOARDING_OUTCOME_SKIPPED" },
    ]);
  });

  it("defaults protojson-omitted zero fields without inventing a level zero", () => {
    expect(normalizePlayerProgression({})).toMatchObject({
      level: 1,
      lifetime_xp: 0,
      xp_into_level: 0,
      xp_for_next_level: 0,
      at_cap: false,
      earned: [],
    });
    expect(
      normalizeHandXPAward({
        award_id: "hand:1:player",
        source: "practice_hand",
        capped_by_daily: true,
      }),
    ).toEqual({
      award_id: "hand:1:player",
      source: "practice_hand",
      total: 0,
      components: [],
      capped_by_daily: true,
    });
  });

  it("rejects malformed XP numbers as a typed protocol failure", () => {
    expect(() => normalizePlayerProgression({ lifetime_xp: "many" })).toThrow(
      expect.objectContaining({ code: "protocol" }),
    );
  });
});
