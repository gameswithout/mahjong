import { describe, expect, it } from "vitest";

// Read as text through Vite rather than node:fs, so this test needs no Node
// type surface in the app's TypeScript project.
import scoringSource from "../rulesengine/scoring.go?raw";
import { allPatternGuides, patternDisplayName, patternGuide, taiValue } from "./scoring-guide";

/**
 * Every `PatternScore{Name: "..."}` the engine can award, and the Tai values it
 * awards them at.
 *
 * A name may appear with more than one literal value — Matching Flower pays 1
 * or 2 depending on the flower — so this collects a set per name.
 *
 * Some names carry a computed Tai instead: Kongs are scored as a rate
 * (`Tai: concealed * 2`), so the line total depends on how many were declared.
 * Those are recorded with a null value, and the guide must mark them
 * perInstance so the copy says "each" rather than quoting a total it cannot know.
 */
function enginePatterns(): Map<string, Set<number | null>> {
  const found = new Map<string, Set<number | null>>();
  const pattern = /Name:\s*"([^"]+)",\s*Tai:\s*([^},]+)/g;
  for (const match of scoringSource.matchAll(pattern)) {
    const [, name, expression] = match;
    const literal = /^\d+$/.test(expression.trim()) ? Number(expression.trim()) : null;
    const values = found.get(name) ?? new Set<number | null>();
    values.add(literal);
    found.set(name, values);
  }
  return found;
}

/** Names whose Tai the engine computes rather than fixes. */
function computedPatterns(): Set<string> {
  const computed = new Set<string>();
  for (const [name, values] of enginePatterns()) {
    if (values.has(null)) computed.add(name);
  }
  return computed;
}

describe("pattern guide agrees with the rules engine", () => {
  it("uses Traditional Chinese names for special hands", () => {
    expect(patternDisplayName("All Pongs")).toBe("碰碰胡 (Pong Pong Hu)");
    expect(patternDisplayName("Full Flush")).toBe("清一色 (Ching Yi Se)");
    expect(patternDisplayName("Zimo")).toBe("自摸 (Zi Mo)");
  });
  it("names only patterns the engine can actually award", () => {
    // A guide entry for a pattern that does not exist is copy promising a way
    // to score that the game will never pay out.
    const engine = enginePatterns();
    const unknown = allPatternGuides()
      .map((guide) => guide.name)
      .filter((name) => !engine.has(name));
    expect(unknown).toEqual([]);
  });

  it("quotes a Tai value the engine actually awards", () => {
    // The guide is read while a player looks at their own score. A number here
    // that disagrees with the one beside it is worse than no explanation.
    const engine = enginePatterns();
    const computed = computedPatterns();
    const wrong = allPatternGuides()
      .filter((guide) => !computed.has(guide.name))
      .filter((guide) => !engine.get(guide.name)?.has(guide.tai))
      .map(
        (guide) =>
          `${guide.name}: guide says ${guide.tai}, engine awards ${[...(engine.get(guide.name) ?? [])].join("/")}`,
      );
    expect(wrong).toEqual([]);
  });

  it("marks per-occurrence patterns as such", () => {
    // Kongs score as a rate, so a hand with two concealed Kongs shows 4台 on
    // one line. Copy quoting a flat "2台" beside a line reading 4 looks like a
    // bug in the score, which is the one thing this screen must never look like.
    const unmarked = [...computedPatterns()].filter((name) => !patternGuide(name)?.perInstance);
    expect(unmarked).toEqual([]);
  });

  it("points every upgrade at a real pattern with its real value", () => {
    // An upgrade path is the part meant to change how someone plays. Sending
    // them after a pattern that does not exist, or misquoting what it pays,
    // is the most damaging thing this file could do.
    const engine = enginePatterns();
    const broken: string[] = [];
    for (const guide of allPatternGuides()) {
      if (!guide.upgrade) continue;
      const values = engine.get(guide.upgrade.name);
      if (!values) {
        broken.push(`${guide.name} -> unknown pattern ${guide.upgrade.name}`);
      } else if (!values.has(null) && !values.has(guide.upgrade.tai)) {
        broken.push(
          `${guide.name} -> ${guide.upgrade.name} quoted at ${guide.upgrade.tai}, engine awards ${[...values].join("/")}`,
        );
      }
    }
    expect(broken).toEqual([]);
  });

  it("only ever points upgrades at something worth more", () => {
    // "Upgrade" has to mean upgrade. A path to an equal or lower pattern would
    // be advice to play for less.
    const downhill = allPatternGuides()
      .filter((guide) => guide.upgrade && guide.upgrade.tai <= guide.tai)
      .map((guide) => `${guide.name} (${guide.tai}) -> ${guide.upgrade!.name} (${guide.upgrade!.tai})`);
    expect(downhill).toEqual([]);
  });

  it("covers every pattern a player can actually see", () => {
    // A pattern with no guide degrades to a plain row rather than a broken
    // expander, so a gap is safe — but it is still a player looking at a term
    // with no way to learn it. This keeps the gap visible.
    const engine = enginePatterns();
    const missing = [...engine.keys()].filter((name) => !patternGuide(name));
    expect(missing).toEqual([]);
  });
});

describe("guide content", () => {
  it("explains what every pattern is", () => {
    const silent = allPatternGuides().filter((guide) => !guide.what?.trim());
    expect(silent.map((guide) => guide.name)).toEqual([]);
  });

  it("states a cost wherever it advises playing slower", () => {
    // Encouraging aggression without naming its price is how a player is
    // talked into chasing a hand they cannot finish. Any guide that tells
    // someone to decline melds or commit to one suit must say what it costs.
    const risky = ["Concealed", "Full Flush", "All Pongs", "Fully Exposed"];
    for (const name of risky) {
      const guide = patternGuide(name);
      expect(guide, `${name} should have a guide`).toBeTruthy();
      expect(guide?.cost?.trim(), `${name} advises a trade-off and must state its cost`).toBeTruthy();
    }
  });
});

describe("value in the player's currency", () => {
  it("converts Tai at the table's stake", () => {
    // Tai is the game's unit; Jade is the one that motivates.
    expect(taiValue(4, 10)).toBe("40 Jade at this table");
  });

  it("says nothing when there is no stake", () => {
    // Practice stakes nothing. Quoting a Jade figure there would claim the
    // hand paid something it did not.
    expect(taiValue(4, undefined)).toBeNull();
    expect(taiValue(4, 0)).toBeNull();
  });
});
