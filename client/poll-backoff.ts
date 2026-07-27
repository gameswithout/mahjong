// Retry pacing for the polling loops that keep a live table fresh.
//
// The match runtime is polled rather than pushed, so a mobile client that
// loses its link keeps firing requests into a network that cannot carry them.
// A fixed interval is the wrong shape for that: it neither gives a congested
// radio room to recover nor stops four seats from retrying in lockstep after
// the same tower handover dropped all of them at once.

// The healthy cadence. Fast enough that an opponent's discard shows up
// promptly, slow enough that a hand costs a bounded number of requests.
export const POLL_BASE_INTERVAL_MS = 4_000;
// The ceiling while failing. Past this, polling more often does not find the
// network sooner — the online/visibility listeners do that — and only drains
// the battery and the data plan.
export const POLL_MAX_INTERVAL_MS = 30_000;

/**
 * Delay before the next poll, given how many consecutive failures precede it.
 *
 * A healthy loop (zero failures) polls at exactly the base interval, so the
 * steady-state cadence stays predictable. Once requests start failing the
 * delay doubles per failure up to the ceiling, and half of it is replaced by
 * jitter: the four clients on one table dropped together and would otherwise
 * retry together forever, re-colliding on every attempt.
 */
export function pollDelayMs(
  consecutiveFailures: number,
  random: () => number = Math.random,
  baseMs: number = POLL_BASE_INTERVAL_MS,
  maxMs: number = POLL_MAX_INTERVAL_MS,
): number {
  const failures = Math.max(0, Math.floor(consecutiveFailures));
  if (failures === 0) {
    return baseMs;
  }
  const backoff = Math.min(baseMs * 2 ** failures, maxMs);

  return Math.round(backoff / 2 + random() * (backoff / 2));
}

// Reconnect budget for a match runtime that dropped out entirely. The old
// five fixed two-second attempts gave up after ten seconds, which is shorter
// than an ordinary tunnel, lift, or LTE/5G handover blackout — the player lost
// a live hand to a gap the network would have closed on its own.
export const RECONNECT_BASE_DELAY_MS = 2_000;
export const RECONNECT_MAX_DELAY_MS = 15_000;
export const MAX_RECONNECT_ATTEMPTS = 8;

/**
 * Delay before reconnect attempt number `attempt` (zero-based), backing off
 * from two seconds to a fifteen-second ceiling. The eight attempts span
 * roughly ninety seconds in total, which covers the blackouts a phone
 * recovers from without help.
 */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const index = Math.max(0, Math.floor(attempt));
  const backoff = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** index, RECONNECT_MAX_DELAY_MS);

  return Math.round(backoff / 2 + random() * (backoff / 2));
}
