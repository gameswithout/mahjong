import type { RotationPlacement, RotationStanding, RotationState, SeatView } from "../protocol/envelope";

// §8.4 Full Rotation, client side.
//
// Everything here is derivation from the server's rotation block. The server
// owns the standings, the dealership, and both endings; this file only decides
// what to call them.

export const SEAT_COUNT = 4;

/** A rotation is playing when the match carries one. */
export function isFullRotation(view: Pick<SeatView, "rotation">): boolean {
  return Boolean(view.rotation);
}

/**
 * Table points are not Jade and must never be presented as if they were.
 * §8.4 Full Rotation "is ranked and uses no Jade": points start at zero, may
 * go negative, and settle to nothing.
 */
export function formatTablePoints(points: number | undefined): string {
  const value = points ?? 0;
  if (value > 0) return `+${value}`;
  return String(value);
}

/**
 * Progress through the round, in the terms §8.4 actually ends on: how many of
 * the four table positions have dealt.
 *
 * Hands played is the wrong measure and would mislead. A dealer who keeps
 * winning retains the deal (§5.11), so a rotation can be six hands deep with
 * only two positions having dealt — a progress bar counting hands would show
 * the match nearly over when it has barely started.
 */
export function rotationProgress(rotation: RotationState): {
  dealt: number;
  total: number;
  label: string;
} {
  const dealt = rotation.seats_dealt ?? 0;
  return {
    dealt,
    total: SEAT_COUNT,
    label: `${dealt} of ${SEAT_COUNT} players have dealt`,
  };
}

/**
 * How the current hand sits within the round, for the table header.
 *
 * A continuation is named explicitly because it is the reason the hand count
 * and the deal count disagree, and a player who is not told will read the
 * rotation as stuck.
 */
export function handHeadline(rotation: RotationState, dealerName: string): string {
  const hand = rotation.hand_number ?? 1;
  const continuations = rotation.continuations ?? 0;
  if (continuations > 0) {
    const times = continuations === 1 ? "again" : `${continuations + 1} times running`;
    return `Hand ${hand} — ${dealerName} deals ${times}`;
  }
  return `Hand ${hand} — ${dealerName} deals`;
}

/**
 * Seconds until the next hand opens, or null when nothing is pending.
 * Clamped at zero so a clock skewed slightly ahead of the server shows "now"
 * rather than a negative countdown.
 */
export function secondsUntilNextHand(
  rotation: RotationState,
  now: Date = new Date(),
): number | null {
  if (!rotation.next_hand_opens_at || rotation.complete) return null;
  const opensAt = Date.parse(rotation.next_hand_opens_at);
  if (Number.isNaN(opensAt)) return null;
  return Math.max(0, Math.ceil((opensAt - now.getTime()) / 1000));
}

/**
 * Why the match ended, in the player's terms.
 *
 * The two endings are genuinely different and §8.4 keeps them apart, so the
 * copy does too: a match stopped by the clock left the rotation unfinished,
 * and saying so is more honest than a generic "match over".
 */
export function completionSummary(rotation: RotationState): string | null {
  if (!rotation.complete) return null;
  if (rotation.reason === "time_limit") {
    const dealt = rotation.seats_dealt ?? 0;
    if (dealt < SEAT_COUNT) {
      return `Time called at 60 minutes with ${dealt} of ${SEAT_COUNT} players having dealt. Final standings are from the hands that were played.`;
    }
    return "Time called at 60 minutes. Final standings are from the hands that were played.";
  }
  return "Every player has dealt. The rotation is complete.";
}

/** Ordinal label for a finishing position. */
export function placementLabel(position: number): string {
  switch (position) {
    case 1:
      return "1st";
    case 2:
      return "2nd";
    case 3:
      return "3rd";
    case 4:
      return "4th";
    default:
      return `${position}th`;
  }
}

/**
 * Whether a placement should be presented as a tie rather than a clean finish.
 *
 * §8.4 breaks equal table points for display but treats them as a genuine tie
 * for rating. Showing an unqualified "2nd" to a player who actually tied would
 * misrepresent the result their rating is about to be computed from.
 */
export function placementNote(placement: RotationPlacement): string | null {
  return placement.rating_tie ? "Tied on table points" : null;
}

/**
 * Standings in display order, with the viewing player marked.
 *
 * The server already ranks them; re-sorting here would risk disagreeing with
 * the podium it produces at the end.
 */
export function standingsForDisplay(
  rotation: RotationState,
  viewerUserId: string | undefined,
): (RotationStanding & { isSelf: boolean; rank: number })[] {
  return (rotation.standings ?? []).map((standing, index) => ({
    ...standing,
    isSelf: Boolean(viewerUserId) && standing.user_id === viewerUserId,
    rank: index + 1,
  }));
}

/**
 * The dealer's display name, given a way to resolve player IDs.
 *
 * Falls back to the seat wind rather than a raw user ID: an opaque AGS UUID
 * tells a player nothing, and "East" at least names a chair at the table.
 */
export function dealerName(
  rotation: RotationState,
  nameOf: (userId: string) => string | undefined,
): string {
  const dealerId = rotation.dealer_user_id;
  if (!dealerId) return "The dealer";
  const resolved = nameOf(dealerId);
  if (resolved) return resolved;
  const standing = (rotation.standings ?? []).find((entry) => entry.user_id === dealerId);
  return standing ? seatName(standing.wind) : "The dealer";
}

const SEAT_NAMES: Record<string, string> = { E: "East", S: "South", W: "West", N: "North" };

export function seatName(seat: string | undefined): string {
  return (seat && SEAT_NAMES[seat]) || "—";
}
