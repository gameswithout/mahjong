import type { SeatView } from "../protocol/envelope";
import {
  aiPracticeSessionAttributes,
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
 *
 * personaIds are the opponents the player explicitly chose from the picker,
 * in no particular order — the player never sees or chooses which physical
 * seat a pick lands in, only which personalities are somewhere at the
 * table. Omit it (or pass none) for "select for me", which is also what a
 * caller that hasn't wired the picker gets automatically.
 */
export async function createFreshPracticeSession(
  client: Pick<SessionClient, "createSession" | "leaveSession">,
  previousSessionId?: string,
  onPreviousSessionLeft?: () => void,
  personaIds: readonly string[] = [],
): Promise<GameSessionSummary> {
  if (previousSessionId) {
    await leaveSessionIfPresent(client, previousSessionId);
    onPreviousSessionLeft?.();
  }

  return client.createSession(aiPracticeSessionAttributes(personaIds));
}

/**
 * The authoritative projection marks permanent bot seats explicitly. This is
 * more reliable than remembering which lobby button launched the match and
 * still works after a runtime reconnect.
 */
export function isPracticeMatch(view: SeatView): boolean {
  return view.players.some((player) => player.is_bot === true);
}
