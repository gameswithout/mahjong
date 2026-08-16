import type { SeatView } from "../protocol/envelope";

const REVIEW_STORAGE_PREFIX = "mahjong.match-reviews.v1";
const MAX_SAVED_REVIEWS = 20;

interface SavedReview {
  savedAt: string;
  view: SeatView;
}

function storageKey(userId: string): string {
  return `${REVIEW_STORAGE_PREFIX}:${userId}`;
}

function readReviews(userId: string): SavedReview[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is SavedReview => Boolean(
      entry &&
      typeof entry === "object" &&
      typeof (entry as SavedReview).savedAt === "string" &&
      typeof (entry as SavedReview).view?.match_id === "string" &&
      (entry as SavedReview).view?.hand_result,
    ));
  } catch {
    return [];
  }
}

export function saveMatchReview(userId: string, view: SeatView): void {
  if (typeof window === "undefined" || !view.hand_result) return;
  const reviews = readReviews(userId).filter((entry) => entry.view.match_id !== view.match_id);
  reviews.unshift({ savedAt: new Date().toISOString(), view });
  try {
    window.localStorage.setItem(
      storageKey(userId),
      JSON.stringify(reviews.slice(0, MAX_SAVED_REVIEWS)),
    );
  } catch {
    // A completed hand must remain playable even if storage is full or disabled.
  }
}

export function loadMatchReview(userId: string, matchId: string): SeatView | null {
  return readReviews(userId).find((entry) => entry.view.match_id === matchId)?.view ?? null;
}

export function savedMatchReviewIds(userId: string): Set<string> {
  return new Set(readReviews(userId).map((entry) => entry.view.match_id));
}
