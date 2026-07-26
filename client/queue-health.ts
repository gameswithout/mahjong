// Specification §8.7: public queues need four humans and never backfill with
// bots, so a thin population shows up as an open-ended wait. At 90 seconds the
// player is offered a way out instead of being left to guess.
//
// The specification also offers "a lower eligible Jade tier" at this point.
// This build configures a single match pool, so there is no lower tier to
// offer; presenting one would be a button that cannot work.
export const QUEUE_PATIENCE_MS = 90_000;

// §2.5 targets: p50 at or below 30 seconds, p95 at or below 90 seconds, when
// at least 16 eligible players are online.
export const QUEUE_TARGET_P50_MS = 30_000;

export type QueueHealth = "starting" | "normal" | "slow";

export function queueHealth(elapsedMs: number): QueueHealth {
  if (elapsedMs >= QUEUE_PATIENCE_MS) {
    return "slow";
  }
  if (elapsedMs >= QUEUE_TARGET_P50_MS) {
    return "normal";
  }
  return "starting";
}

// What the player is told while waiting. Deliberately never promises a time:
// the client cannot see queue depth, and inventing an estimate would be the
// one number they would hold us to.
export function queueHealthMessage(health: QueueHealth): string {
  switch (health) {
    case "slow":
      return "This is taking longer than usual. Four players are needed and nobody is filled in by a bot.";
    case "normal":
      return "Still searching. A table needs four players.";
    case "starting":
      return "Searching for players.";
  }
}

export function queueElapsedLabel(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  if (seconds < 60) {
    return `${seconds}s in queue`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s in queue`;
}
