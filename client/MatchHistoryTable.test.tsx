import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { MatchHistoryTable, displayMatchMode, recentMatches } from "./MatchHistoryTable";
import { journeyFixture } from "./fixtures/journey";
it("shows only the latest ten games in descending order without mutating history", () => {
  const { matches } = journeyFixture(15);
  const original = matches.map((match) => match.matchId);
  expect(recentMatches(matches).map((match) => match.matchId)).toEqual([...original].reverse().slice(0, 10));
  expect(matches.map((match) => match.matchId)).toEqual(original);
  const node = document.createElement("div"); node.innerHTML = renderToStaticMarkup(<MatchHistoryTable matches={matches} onSelect={vi.fn()} />);
  expect(node.querySelectorAll("tbody tr")).toHaveLength(10);
  expect(node.textContent).toContain("Casual");
  expect(node.textContent).not.toContain("unranked");
  expect(displayMatchMode("unranked")).toBe("Casual");
  expect(displayMatchMode("ranked")).toBe("Ranked");
});

it("browses older and newer ten-game pages with correct boundaries", async () => {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const node = document.createElement("div"); const root = createRoot(node); const select = vi.fn();
  const { matches } = journeyFixture(15);
  act(() => root.render(<MatchHistoryTable matches={matches} onSelect={select} />));
  const newer = () => node.querySelector<HTMLButtonElement>('[aria-label="Newer games"]')!;
  const older = () => node.querySelector<HTMLButtonElement>('[aria-label="Older games"]')!;
  expect(newer().disabled).toBe(true); expect(older().disabled).toBe(false);
  act(() => older().click());
  expect(node.querySelectorAll("tbody tr")).toHaveLength(5);
  expect(node.querySelector("tbody button")?.textContent).toBe("sample-history-5");
  expect(older().disabled).toBe(true); expect(newer().disabled).toBe(false);
  act(() => node.querySelector<HTMLButtonElement>("tbody button")!.click());
  expect(select).toHaveBeenCalledWith("sample-history-5");
  act(() => newer().click());
  expect(node.querySelectorAll("tbody tr")).toHaveLength(10);
  expect(node.querySelector("tbody button")?.textContent).toBe("sample-history-15");
  act(() => root.unmount());
});
