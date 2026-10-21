import type { MatchHistoryEntry } from "./match-history";
import { useSyncExternalStore } from "react";
import type { PlayerJourney } from "../protocol/envelope";

const titles = ["Newcomer", "Table Regular", "Familiar Face", "Mahjong Veteran", "Table Elder", "Mahjong Luminary", "Living Legend"];
export const previewPrestige = [1, 10, 50, 100, 500, 1000, 5000].map((games, i) => ({ games, title: titles[i], chapter: titles[i] }));
// Provisional examples for click-through testing, not approved eligibility rules.
export const SIMULATED_HIGHLIGHTS = [
  { id: "self-draw", name: "Self Draw", description: "A sample Self Draw victory during the rotation." },
  { id: "exceptional-tai", name: "Exceptional Tai", description: "A sample high-Tai hand. The qualifying threshold is not finalized." },
  { id: "personal-best", name: "Personal Tai Best", description: "A sample new personal Tai record." },
  { id: "rare-hand", name: "Rare Winning Hand", description: "A sample rare hand. Patterns and rarity are not finalized." },
  { id: "taiwanese-pattern", name: "Special Taiwanese Pattern", description: "A sample unusual Taiwanese pattern. The pattern catalog is not finalized." },
] as const;
export type SimulatedHighlight = { id: string; matchId: string; rotation: number; mode: "Unranked" | "Ranked"; humanSeats: number; botSeats: number };
export type Simulation = { rotations: number; xp: number; rankedWins: number; rankedLosses: number; elo: number; equipment: Record<number, string>; highlights: SimulatedHighlight[]; matches: MatchHistoryEntry[] };
let snapshot: Simulation | undefined;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((listener) => listener()); }
export function simulateRotation(mode: "Unranked" | "Ranked", win: boolean, random: () => number = Math.random) {
  const previous = snapshot ?? { rotations: 0, xp: 0, rankedWins: 0, rankedLosses: 0, elo: 1200, equipment: {}, highlights: [], matches: [] };
  const matchId = `sample-match-${previous.rotations + 1}`;
  const event: SimulatedHighlight[] = random() < 0.6 ? [{
    id: SIMULATED_HIGHLIGHTS[Math.min(SIMULATED_HIGHLIGHTS.length - 1, Math.max(0, Math.floor(random() * SIMULATED_HIGHLIGHTS.length)))].id,
    matchId, rotation: previous.rotations + 1, mode, humanSeats: mode === "Ranked" ? 4 : 1, botSeats: mode === "Ranked" ? 0 : 3,
  }] : [];
  const taiRoll = random();
  const rawTai = Math.max(event.some((item) => item.id === "exceptional-tai") ? 12 : 1, Math.min(16, 1 + Math.floor((Number.isFinite(taiRoll) ? taiRoll : 0) * 16)));
  snapshot = { ...previous, matches: [...previous.matches, { matchId, completedAt: new Date(Date.now() + previous.rotations).toISOString(), mode, result: win ? "Win" : "Loss", winKind: "", winningTileId: "", rawTai, xpAwarded: 100 }], highlights: [...previous.highlights, ...event], rotations: previous.rotations + 1, xp: previous.xp + 100,
    rankedWins: previous.rankedWins + Number(mode === "Ranked" && win), rankedLosses: previous.rankedLosses + Number(mode === "Ranked" && !win),
    elo: previous.elo + (mode === "Ranked" ? win ? 25 : -25 : 0) };
  emit();
}
export function resetSimulation() { snapshot = undefined; emit(); }
export function equipSimulationTile(slot: number, id: string) {
  if (!snapshot || !simulationTiles(snapshot).some((tile) => tile.id === id)) return;
  snapshot = { ...snapshot, equipment: { ...snapshot.equipment, [slot]: id } }; emit();
}
export function clearSimulationSlot(slot: number) {
  if (!snapshot) return;
  const equipment = { ...snapshot.equipment }; delete equipment[slot];
  snapshot = { ...snapshot, equipment }; emit();
}
export function useProgressionSimulation() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot, () => undefined);
}
export function simulationJourney(state: Simulation): PlayerJourney {
  return { completed_rotations: state.rotations, prestige: previewPrestige, anniversaries: [] };
}
export function simulationTiles(state: Simulation) {
  const names = previewPrestige.filter((step) => state.rotations >= step.games).map((step) => step.title);
  if (state.rankedWins > 0) names.push("First Ranked Victory");
  names.push(...SIMULATED_HIGHLIGHTS.filter((definition) => state.highlights.some((event) => event.id === definition.id)).map((definition) => definition.name));
  return names.map((label) => ({ id: `preview-achievement:${label}`, label }));
}
export function simulationTileLabel(id: string) { return id.startsWith("preview-achievement:") ? id.slice(20) : undefined; }
