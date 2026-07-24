import type { SeatView } from "../protocol/envelope";
import {
  AI_PRACTICE_SESSION_ATTRIBUTES,
  SessionLookupError,
  type GameSessionSummary,
  type SessionClient,
} from "./session";

/**
 * Session leave is idempotent from the player's perspective. A retry after a
 * lost response can legitimately find that the first request already removed
 * membership, so "not found" means cleanup is complete rather than blocked.
 */
export async function leaveSessionIfPresent(
  client: Pick<SessionClient, "leaveSession">,
  sessionId: string,
): Promise<void> {
  try {
    await client.leaveSession(sessionId);
  } catch (error) {
    if (!(error instanceof SessionLookupError && error.code === "not_found")) {
      throw error;
    }
  }
}

/**
 * AI Practice is a one-hand mode. Replaying always leaves the completed AGS
 * Session and creates a fresh one so seats, wall, and match identity cannot
 * leak across hands.
 */
export async function createFreshPracticeSession(
  client: Pick<SessionClient, "createSession" | "leaveSession">,
  previousSessionId?: string,
  onPreviousSessionLeft?: () => void,
): Promise<GameSessionSummary> {
  if (previousSessionId) {
    await leaveSessionIfPresent(client, previousSessionId);
    onPreviousSessionLeft?.();
  }

  return client.createSession(AI_PRACTICE_SESSION_ATTRIBUTES);
}

/**
 * The authoritative projection marks permanent bot seats explicitly. This is
 * more reliable than remembering which lobby button launched the match and
 * still works after a runtime reconnect.
 */
export function isPracticeMatch(view: SeatView): boolean {
  return view.players.some((player) => player.is_bot === true);
}
