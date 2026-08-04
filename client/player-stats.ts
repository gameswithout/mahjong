// P2.3 statistics dashboard data.
//
// Read through the match service rather than from AGS directly. Going straight
// to AGS Statistics was the obvious design — the configurations are public and
// the player owns the record — but the AGS Social API sends no CORS headers, so
// a browser is blocked before the request leaves. AGS IAM does send them, which
// is why the rest of the client can talk to AGS and this cannot.
//
// Everything a player is shown is derived here from counters the match service
// wrote. The client computes ratios but never counts anything itself.

export type PlayerStatsErrorCode =
  | "configuration"
  | "unauthenticated"
  | "network"
  | "timeout"
  | "protocol";

export class PlayerStatsError extends Error {
  constructor(
    readonly code: PlayerStatsErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PlayerStatsError";
  }
}

// The stat codes this screen reads, matching the definitions in the namespace
// and the constants in pkg/progression/stats.go. A code missing from AGS reads
// as zero rather than failing: a player who has never dealt in has no stat
// item, and that is a legitimate zero, not an error.
export const STAT_HANDS = "public-hands-completed";
export const STAT_WINS = "public-hands-won";
export const STAT_ZIMO = "zimo-wins";
export const STAT_DEALT_IN = "public-hands-dealt-in";
export const STAT_TING = "public-hands-ting";
export const STAT_KONGS = "kongs-declared";
export const STAT_BEST_TAI = "highest-raw-tai";

export const DASHBOARD_STAT_CODES = [
  STAT_HANDS,
  STAT_WINS,
  STAT_ZIMO,
  STAT_DEALT_IN,
  STAT_TING,
  STAT_KONGS,
  STAT_BEST_TAI,
] as const;

// Below this many hands a percentage says more about luck than about the
// player, so §P2.3 asks for the count instead until the sample earns it.
export const MINIMUM_RATE_SAMPLE = 20;

/**
 * One rate on the dashboard.
 *
 * `ratio` is null until the denominator reaches the minimum sample — the
 * screen shows the raw counts in that case rather than a number that would
 * only mislead. `denominatorLabel` is displayed alongside, because a rate
 * whose denominator is unstated is not interpretable: Zimo share is a share of
 * wins, while deal-in rate is a share of every hand played.
 */
export interface StatRate {
  numerator: number;
  denominator: number;
  denominatorLabel: string;
  ratio: number | null;
}

export interface PlayerStatSummary {
  handsPlayed: number;
  wins: number;
  winRate: StatRate;
  zimoShare: StatRate;
  dealInRate: StatRate;
  tingRate: StatRate;
  kongsDeclared: number;
  bestHandTai: number;
  // True once any hand has been played; the screen shows an invitation to play
  // rather than a wall of zeroes before that.
  hasPlayed: boolean;
}

/** Reconcile lagging aggregate counters with the authoritative session list. */
export function reconcilePlayerStatsWithHistory(
  summary: PlayerStatSummary,
  history: ReadonlyArray<{ result: "Win" | "Loss" | "Draw" | "Neutral" }>,
): PlayerStatSummary {
  // Equal lengths still need reconciliation. Practice completion can advance
  // the aggregate hand counter without advancing the public-wins counter, so
  // returning early here produced "0 Wins / 4 Games Played" even while the
  // authoritative list contained a winning session.
  if (history.length < summary.handsPlayed) {
    return summary;
  }
  const handsPlayed = history.length;
  const wins = history.reduce(
    (total, entry) => total + (entry.result === "Win" ? 1 : 0),
    0,
  );
  return {
    ...summary,
    handsPlayed,
    wins,
    hasPlayed: true,
    winRate: rate(wins, handsPlayed, "hands played"),
    dealInRate: rate(summary.dealInRate.numerator, handsPlayed, "hands played"),
    tingRate: rate(summary.tingRate.numerator, handsPlayed, "hands played"),
  };
}

function rate(numerator: number, denominator: number, denominatorLabel: string): StatRate {
  return {
    numerator,
    denominator,
    denominatorLabel,
    ratio: denominator >= MINIMUM_RATE_SAMPLE && denominator > 0 ? numerator / denominator : null,
  };
}

/**
 * Turns raw AGS stat values into the numbers the dashboard shows.
 *
 * Pure, and the only place the denominators are decided. Win rate, deal-in and
 * Ting are all shares of hands played; Zimo share is a share of *wins*, since
 * "how often do I win by self-draw" is a question about wins.
 */
export function summarisePlayerStats(values: Record<string, number>): PlayerStatSummary {
  const read = (code: string): number => {
    const value = values[code];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };

  const handsPlayed = read(STAT_HANDS);
  const wins = read(STAT_WINS);

  return {
    handsPlayed,
    wins,
    winRate: rate(wins, handsPlayed, "hands played"),
    zimoShare: rate(read(STAT_ZIMO), wins, "wins"),
    dealInRate: rate(read(STAT_DEALT_IN), handsPlayed, "hands played"),
    tingRate: rate(read(STAT_TING), handsPlayed, "hands played"),
    kongsDeclared: read(STAT_KONGS),
    bestHandTai: read(STAT_BEST_TAI),
    hasPlayed: handsPlayed > 0,
  };
}

// readStatValues pulls {stat_code: value} out of a GetPlayerStatistics
// response. Unknown shapes are skipped rather than rejected: a stat code this
// build does not know about is not a reason to fail the screen.
export function readStatValues(body: unknown): Record<string, number> {
  const values: Record<string, number> = {};
  const data = (body as { statistics?: unknown } | null)?.statistics;
  if (!Array.isArray(data)) {
    return values;
  }
  for (const entry of data) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const item = entry as { stat_code?: unknown; statCode?: unknown; value?: unknown };
    const statCode =
      typeof item.stat_code === "string"
        ? item.stat_code
        : typeof item.statCode === "string"
          ? item.statCode
          : "";
    if (!statCode) {
      continue;
    }
    // protojson omits a zero double entirely, so a counter the player has
    // never moved arrives as a stat_code with no value at all. That is a real
    // zero, not a malformed row — reading it as anything else would show a
    // player who has never dealt in as having no data rather than none.
    values[statCode] = typeof item.value === "number" ? item.value : 0;
  }
  return values;
}

export interface PlayerStatsClient {
  get(): Promise<PlayerStatSummary>;
}

export interface PlayerStatsClientOptions {
  // Match service base URL, not the AGS base URL.
  url: string;
  namespace: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;

export function createPlayerStatsClient(
  accessToken: string,
  options: PlayerStatsClientOptions,
): PlayerStatsClient {
  if (!accessToken || !options.url || !options.namespace) {
    throw new PlayerStatsError("configuration", "Statistics configuration is incomplete.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // No user id in the path: the bearer token identifies the player, so the
  // screen cannot be pointed at somebody else's record by a caller bug.
  const url = `${options.url}/v1/namespaces/${encodeURIComponent(options.namespace)}/statistics`;

  return {
    async get() {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new PlayerStatsError("timeout", "Statistics did not load in time.", { cause: error });
        }
        throw new PlayerStatsError("network", "Statistics could not be reached.", { cause: error });
      } finally {
        globalThis.clearTimeout(timeout);
      }

      if (response.status === 401) {
        throw new PlayerStatsError("unauthenticated", "Sign in again to see your statistics.");
      }
      if (!response.ok) {
        throw new PlayerStatsError("network", "Statistics could not be loaded.");
      }
      try {
        return summarisePlayerStats(readStatValues(await response.json()));
      } catch (error) {
        throw new PlayerStatsError("protocol", "Statistics returned an unexpected response.", {
          cause: error,
        });
      }
    },
  };
}
