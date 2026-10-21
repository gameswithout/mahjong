import type { PlayerJourney } from "../protocol/envelope";
import type { PlayerProfileConfig } from "./player-profile";

// Read-side UI projections over the existing server model, not a second
// achievement ledger. Persisted grants and eligibility remain server-owned.
export type JourneyCollection = "legacy" | "skill" | "highlights";
export interface JourneyAchievement {
  id: string;
  collection: JourneyCollection;
  category: string;
  name: string;
  description: string;
  status: "approved" | "proposed";
  unlocked: boolean;
  current?: number;
  target?: number;
  unlockedAt?: string;
  unavailableReason?: string;
  reward?: string;
  rewardDelivered?: boolean;
  provenance?: { mode: string; humanSeats: number; botSeats: number; sourceMatchId: string };
}

// Approved material schedule. Eligibility is read from the server; this table
// describes future milestones and must never grant an item in the browser.
export const ANNIVERSARY_MATERIALS = [
  { year: 5, material: "Wood" }, { year: 10, material: "Tin" },
  { year: 15, material: "Crystal" }, { year: 20, material: "Porcelain" },
  { year: 25, material: "Silver" }, { year: 30, material: "Pearl" },
  { year: 40, material: "Ruby" }, { year: 50, material: "Gold" },
  { year: 60, material: "Diamond" },
] as const;

// Provisional presentation mapping, by server-supplied Prestige milestone
// index. No independent client thresholds and no additional earned capacity.
export const CHRONICLE_STAGES = [
  { id: "first-seat", title: "First Seat", milestoneIndex: 0, artworkStage: 1 },
  { id: "familiar-table", title: "Familiar Table", milestoneIndex: 1, artworkStage: 2 },
  { id: "veterans-room", title: "Veteran’s Room", milestoneIndex: 3, artworkStage: 4 },
  { id: "living-legend", title: "Living Legend", milestoneIndex: 6, artworkStage: 7 },
] as const;

export function prestigeProgress(journey: PlayerJourney) {
  const steps = [...journey.prestige].sort((a, b) => a.games - b.games);
  const earned = steps.filter((step) => step.games <= journey.completed_rotations);
  const current = earned.at(-1);
  const next = steps.find((step) => step.games > journey.completed_rotations);
  const previous = current?.games ?? 0;
  const percent = next ? Math.max(0, Math.min(100, (journey.completed_rotations - previous) / (next.games - previous) * 100)) : current ? 100 : 0;
  return { steps, earned, current, next, percent };
}

export function chronicleStage(milestoneIndex: number) {
  return CHRONICLE_STAGES.filter((stage) => stage.milestoneIndex <= milestoneIndex).at(-1);
}

// Matches the server's UTC policy: Feb 29 becomes Feb 28 in non-leap years.
// Used only for the next anniversary date, never to award badges or cosmetics.
export function anniversaryDate(firstCompletedAt: string, year: number): string | undefined {
  const first = new Date(firstCompletedAt);
  if (!Number.isFinite(first.valueOf()) || !Number.isInteger(year) || year < 1) return undefined;
  const targetYear = first.getUTCFullYear() + year;
  const month = first.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, month, Math.min(first.getUTCDate(), lastDay))).toISOString().slice(0, 10);
}

export function legacyAchievements(journey: PlayerJourney): JourneyAchievement[] {
  const { steps } = prestigeProgress(journey);
  const prestige: JourneyAchievement[] = steps.map((step) => ({
    id: `prestige-${step.games}`, collection: "legacy", category: "Games Played",
    name: step.title, description: `Complete ${step.games.toLocaleString("en-US")} full dealer ${step.games === 1 ? "rotation" : "rotations"}.`,
    status: "approved", current: journey.completed_rotations, target: step.games,
    unlocked: journey.completed_rotations >= step.games,
    // Only the very first milestone has a supported event timestamp today.
    unlockedAt: step.games === 1 && journey.completed_rotations >= 1 ? journey.first_completed_at : undefined,
    reward: "Prestige title and Chronicle progress",
  }));
  const anniversaries: JourneyAchievement[] = journey.anniversaries.map((badge) => ({
    id: `anniversary-${badge.year}`, collection: "legacy", category: "Anniversaries",
    name: `Year ${badge.year}`, description: `${badge.year} calendar ${badge.year === 1 ? "year" : "years"} since your first completed rotation.`,
    status: "approved", unlocked: true, unlockedAt: badge.earned_at,
    reward: badge.material ? `Anniversary badge · ${badge.material} cosmetic eligibility` : "Numbered anniversary badge",
  }));
  return [...prestige, ...anniversaries, {
    id: "friend-of-mahjong", collection: "legacy", category: "Community", name: "Friend of Mahjong",
    description: "Invite three unique new players who verify full accounts through email sign-in. No gameplay requirement.",
    status: "approved", unlocked: false, target: 3, reward: "Exclusive permanent Friend Tile",
    unavailableReason: "Verified referral tracking is not connected yet.",
  }];
}

// Candidates are never evaluated against a player's statistics or rewarded.
export const SKILL_CANDIDATES: JourneyAchievement[] = [
  ["first-ranked-victory", "First Ranked Victory"],
  ["first-tier-promotion", "First Tier Promotion"],
  ["reach-gold", "Reach Gold"], ["reach-platinum", "Reach Platinum"],
  ["reach-diamond", "Reach Diamond"], ["reach-master", "Reach Master"],
  ["personal-elo-record", "New Personal Elo Record"],
].map(([id, name]) => ({ id, name, collection: "skill", category: "Ranked", description: "Candidate definition. Eligibility and rewards are not finalized.", status: "proposed", unlocked: false }));

export interface JourneyCosmetic {
  id: string;
  name: string;
  type: "tile_skin" | "table_theme" | "title" | "avatar_frame" | "profile_tile";
  source: string;
  // Supplied by an authenticated ownership response, never inferred from XP,
  // a cosmetic_code on anniversary eligibility, or a browser selection.
  owned: boolean;
  compatibleDisplays: ("showcase" | "chronicle")[];
}
export const DEFAULT_SHOWCASE_CAPACITY = 3; // Temporary layout setting, not a Prestige reward.
export function selectShowcase(current: readonly string[], id: string, inventory: readonly JourneyCosmetic[], capacity = DEFAULT_SHOWCASE_CAPACITY): string[] {
  if (!Number.isInteger(capacity) || capacity < 0) throw new Error("Invalid showcase capacity.");
  const available = new Set(inventory.filter((item) => item.owned === true && item.compatibleDisplays.includes("showcase")).map((item) => item.id));
  if (!available.has(id)) throw new Error("Only owned, compatible cosmetics can be showcased.");
  const valid = [...new Set(current)].filter((item) => available.has(item)).slice(0, capacity);
  if (valid.includes(id)) return valid.filter((item) => item !== id);
  if (valid.length >= capacity) throw new Error("Your showcase is full. Remove an item first.");
  return [...valid, id];
}

export interface JourneyMilestone { id: string; name: string; date: string; detail: string }
export function recentMilestones(journey: PlayerJourney): JourneyMilestone[] {
  const events: JourneyMilestone[] = journey.anniversaries.map((entry) => ({
    id: `anniversary-${entry.year}`, name: `Year ${entry.year} anniversary`, date: entry.earned_at,
    detail: entry.material ? `${entry.material} cosmetic eligibility` : "Anniversary badge",
  }));
  if (journey.completed_rotations > 0 && journey.first_completed_at) events.push({ id: "first-rotation", name: "Your first completed rotation", date: journey.first_completed_at, detail: "The beginning of your Mahjong Journey" });
  return events.filter((event) => Number.isFinite(Date.parse(event.date))).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

// An explicit allowlist for the owner-only preview. No user ID, wallet,
// account/email, private achievements, or raw match records can pass through.
// Publishing this view still needs a server-owned privacy/ownership contract.
export function publicProfilePreview(profile: PlayerProfileConfig | undefined, journey: PlayerJourney, inventory: readonly JourneyCosmetic[], selected: readonly string[], capacity = DEFAULT_SHOWCASE_CAPACITY) {
  const progress = prestigeProgress(journey);
  const owned = new Map(inventory.filter((item) => item.owned === true && item.compatibleDisplays.includes("showcase")).map((item) => [item.id, item]));
  return {
    displayName: profile?.nickname ?? "Mahjong player",
    tileSlotIds: profile ? [...profile.tileSlotIds] : [],
    prestigeTitle: progress.current?.title,
    chronicleTitle: chronicleStage(progress.earned.length - 1)?.title,
    showcasedCosmetics: [...new Set(selected)].filter((id) => owned.has(id)).slice(0, Math.max(0, capacity)).map((id) => ({ id, name: owned.get(id)!.name, type: owned.get(id)!.type })),
  };
}

// The only connected cosmetic entitlement today. This adapter does not infer
// ownership of anniversary gifts, XP rewards, or profile tiles selected locally.
export function founderCosmetics(owned: boolean): JourneyCosmetic[] {
  return owned === true ? [{ id: "founder-og", name: "OG Founder profile tile", type: "profile_tile", source: "Founder Pack", owned: true, compatibleDisplays: ["showcase"] }] : [];
}
