// Growth signals: the small amount of device-local state the growth events
// need, plus the banding rules that keep those events coarse.
//
// Why a module rather than inline in App.tsx: every value here is a judgement
// call ("what counts as low Jade", "what counts as activation") that a product
// team will want to read and argue with, and every one of them has to be
// stable across releases or the cohorts in AI Analytics break. Banding also
// keeps the wire payload coarse, which is what makes these events safe to send
// at all — a band is not a balance, and a milestone is not a play history.
//
// Nothing here is authoritative. Jade, XP, and statistics are server-owned;
// these are only the client's view of them, shaped for analysis.

export const GROWTH_STORAGE_PREFIX = "mahjong.growth.";
const FIRST_SEEN_KEY = `${GROWTH_STORAGE_PREFIX}first_seen_at`;
const LAST_SESSION_KEY = `${GROWTH_STORAGE_PREFIX}last_session_at`;
const SESSION_COUNT_KEY = `${GROWTH_STORAGE_PREFIX}session_count`;
const MILESTONE_KEY_PREFIX = `${GROWTH_STORAGE_PREFIX}milestone.`;

/**
 * The activation ladder. Each rung fires at most once per device, ever.
 *
 * These are deliberately few. A milestone is only worth a rung if a product
 * decision hangs on the drop-off *into* it — "how many installs ever finish a
 * hand" is a decision; "how many opened the settings panel" is not.
 */
export const GROWTH_MILESTONES = [
  // Signed in and looking at the lobby: the top of the funnel that the game
  // itself can see. Everything before it belongs to acquisition, not product.
  "first_lobby",
  // Seated at a table with other people or bots. Intent has become commitment.
  "first_match_entered",
  // Played a hand through to its end. This is activation: the first time the
  // player has experienced the actual game.
  "first_hand_completed",
  // Completed a hand with Jade and rating on it. Activation into the mode the
  // business cares about, which is a different and much smaller number.
  "first_staked_hand",
  // Added another player. The first rung of the social loop, and the strongest
  // single retention correlate in most session-based games.
  "first_friend",
] as const;

export type GrowthMilestone = (typeof GROWTH_MILESTONES)[number];

/**
 * How long since this device's previous session. The bands are the ones
 * retention is actually reported in, so a cohort chart is a GROUP BY rather
 * than a bucketing expression in every query.
 */
export type ReturnBand =
  | "first_session"
  | "same_day"
  | "next_day"
  | "within_week"
  | "within_month"
  | "lapsed";

/**
 * How many sessions this device has ever had, including the current one.
 * Bands rather than a count: the count is a weak identifier for a small beta
 * population, and no growth question needs the exact number.
 */
export type SessionCountBand = "1" | "2_3" | "4_10" | "11_30" | "31_plus";

/**
 * How far a session got. The point of this is bounce measurement: a session
 * that never left the lobby is a different failure from one that queued and
 * never got seated.
 */
export type SessionDepth = "bounced" | "browsed" | "queued" | "played";

/**
 * Jade against the thresholds that gate play, not against an absolute amount.
 * A player one stake short of the minimum is in the same product situation
 * whatever the table tier, and that situation — not the balance — is what
 * predicts whether they come back.
 */
export type JadeBalanceBand = "empty" | "below_minimum" | "low" | "healthy" | "deep";

export interface JadeBands {
  available: number;
  minimum_balance?: number;
}

export function jadeBalanceBand(account: JadeBands): JadeBalanceBand {
  const available = Number.isFinite(account.available) ? account.available : 0;
  if (available <= 0) return "empty";
  const minimum = account.minimum_balance && account.minimum_balance > 0
    ? account.minimum_balance
    : 1;
  if (available < minimum) return "below_minimum";
  if (available < minimum * 3) return "low";
  if (available < minimum * 10) return "healthy";
  return "deep";
}

const DAY_MS = 86_400_000;

export function returnBand(lastSessionAt: number | null, now: number): ReturnBand {
  if (lastSessionAt === null) return "first_session";
  const elapsed = Math.max(0, now - lastSessionAt);
  if (elapsed < DAY_MS) return "same_day";
  if (elapsed < 2 * DAY_MS) return "next_day";
  if (elapsed < 7 * DAY_MS) return "within_week";
  if (elapsed < 30 * DAY_MS) return "within_month";
  return "lapsed";
}

export function sessionCountBand(sessionCount: number): SessionCountBand {
  if (sessionCount <= 1) return "1";
  if (sessionCount <= 3) return "2_3";
  if (sessionCount <= 10) return "4_10";
  if (sessionCount <= 30) return "11_30";
  return "31_plus";
}

export function levelBand(level: number): string {
  if (level <= 1) return "1";
  if (level <= 5) return "2_5";
  if (level <= 10) return "6_10";
  if (level <= 25) return "11_25";
  if (level <= 50) return "26_50";
  return "51_plus";
}

/** The current session's depth, from the two facts the app already tracks. */
export function sessionDepth(counters: {
  matchesEntered: number;
  queueEntries: number;
  handsCompleted: number;
}): SessionDepth {
  if (counters.handsCompleted > 0) return "played";
  if (counters.matchesEntered > 0) return "played";
  if (counters.queueEntries > 0) return "queued";
  return "bounced";
}

export interface GrowthSessionStart {
  returnBand: ReturnBand;
  sessionCountBand: SessionCountBand;
  daysSinceLastSession: number;
}

export interface ReachedMilestone {
  milestone: GrowthMilestone;
  minutesSinceFirstSession: number;
  sessionCountBand: SessionCountBand;
}

export interface GrowthStore {
  /**
   * Records that a session has begun and returns how this device is returning.
   * Called once per app mount; the caller decides what to do with the answer.
   */
  beginSession(now: number): GrowthSessionStart;
  /**
   * Marks a milestone if this device has never reached it. Returns the event
   * fields on the first call and `null` on every call after, so the caller can
   * fire and forget without keeping its own guard.
   */
  reach(milestone: GrowthMilestone, now: number): ReachedMilestone | null;
}

type WritableStorage = Pick<Storage, "getItem" | "setItem">;

function safeStorage(provided?: WritableStorage): WritableStorage | undefined {
  if (provided) return provided;
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function readNumber(storage: WritableStorage | undefined, key: string): number | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function write(storage: WritableStorage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // A browser with storage blocked still plays the game. It simply looks
    // like a brand new device on every load, which is the safe direction to
    // be wrong in: milestones over-report first-time reach rather than
    // silently attributing a returning player to a cohort they are not in.
  }
}

export function createGrowthStore(storage?: WritableStorage): GrowthStore {
  const store = safeStorage(storage);

  return {
    beginSession(now) {
      const firstSeenAt = readNumber(store, FIRST_SEEN_KEY);
      if (firstSeenAt === null) {
        write(store, FIRST_SEEN_KEY, String(now));
      }
      const lastSessionAt = readNumber(store, LAST_SESSION_KEY);
      const sessionCount = (readNumber(store, SESSION_COUNT_KEY) ?? 0) + 1;
      write(store, SESSION_COUNT_KEY, String(sessionCount));
      write(store, LAST_SESSION_KEY, String(now));
      return {
        returnBand: returnBand(lastSessionAt, now),
        sessionCountBand: sessionCountBand(sessionCount),
        daysSinceLastSession:
          lastSessionAt === null ? 0 : Math.floor(Math.max(0, now - lastSessionAt) / DAY_MS),
      };
    },

    reach(milestone, now) {
      const key = `${MILESTONE_KEY_PREFIX}${milestone}`;
      if (readNumber(store, key) !== null) {
        return null;
      }
      write(store, key, String(now));
      const firstSeenAt = readNumber(store, FIRST_SEEN_KEY) ?? now;
      return {
        milestone,
        minutesSinceFirstSession: Math.max(0, Math.round((now - firstSeenAt) / 60_000)),
        sessionCountBand: sessionCountBand(readNumber(store, SESSION_COUNT_KEY) ?? 1),
      };
    },
  };
}
