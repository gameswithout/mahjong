// Reload/tab-loss resume (§8.7 reconnect, abnormal-termination path).
//
// The match runtime keeps a joined match alive and re-joinable server-side
// (event-sourced), and covers an absent seat with §8.7 takeover, so the only
// thing missing when a browser reloads or its tab crashes mid-hand is the
// client's own memory of *which* match it was in. This persists exactly that
// pointer so the app can silently re-authenticate and rejoin instead of
// dropping the player back at sign-in.
//
// A pointer only ever references a GUEST match. Guest is the one identity the
// client can re-establish without user input on reload: its device ID is
// already persisted (see device-id.ts) and loginAsGuest is headless, so it
// returns the same user. Email sign-in has no stored credential to replay, so
// those matches are not auto-resumable and no pointer is written for them.
//
// The access token is deliberately NOT stored here (it is memory-only by
// design — see BrowserIam.getAccessToken). Resume re-mints a fresh token via
// the persisted device ID rather than reusing a saved one.

export const MATCH_RESUME_STORAGE_KEY = "mahjong.match.resume";

// A hand is short. A pointer older than this is treated as stale and dropped
// rather than resumed — long enough to survive an accidental reload or a brief
// tab close, short enough that a day-old pointer never yanks the player into a
// long-finished session.
export const MATCH_RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000;

// Tolerance for a pointer whose savedAt is slightly in the future relative to
// "now" — a wall-clock adjustment between save and load should not make a
// freshly written pointer look invalid.
export const MATCH_RESUME_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface MatchResumePointer {
  // The AGS Session ID, which is also the match runtime ID in this codebase
  // (a match's ID is its session's ID — see connectMatchRuntime).
  sessionId: string;
  // The guest user the pointer was written for. On resume, the re-authenticated
  // guest must match this; if the device now maps to a different user, the
  // match is someone else's and must not be resumed into.
  userId: string;
  // Epoch milliseconds the pointer was written, for staleness.
  savedAt: number;
}

export interface MatchResumeStore {
  // Records (or refreshes) the pointer for a live guest match.
  save(pointer: { sessionId: string; userId: string }): void;
  // Returns the stored pointer if present, structurally valid, and fresh;
  // otherwise null. A stored-but-unusable pointer (corrupt or stale) is
  // cleared as a side effect so it cannot linger.
  load(now?: number): MatchResumePointer | null;
  clear(): void;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// parseResumePointer turns a raw localStorage string into a validated pointer,
// or null if it is missing/corrupt/the wrong shape. Pure and storage-free so
// the validation is trivially testable.
export function parseResumePointer(raw: string | null): MatchResumePointer | null {
  if (!raw) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    !isNonEmptyString(candidate.sessionId) ||
    !isNonEmptyString(candidate.userId) ||
    typeof candidate.savedAt !== "number" ||
    !Number.isFinite(candidate.savedAt)
  ) {
    return null;
  }

  return {
    sessionId: candidate.sessionId,
    userId: candidate.userId,
    savedAt: candidate.savedAt,
  };
}

// isResumablePointer decides whether a valid pointer is recent enough to
// resume into. Pure, with an injected clock so freshness is testable.
export function isResumablePointer(pointer: MatchResumePointer, now: number): boolean {
  const age = now - pointer.savedAt;
  return age >= -MATCH_RESUME_CLOCK_SKEW_MS && age <= MATCH_RESUME_MAX_AGE_MS;
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Storage can be unavailable (private mode, disabled cookies). Resume is a
    // convenience, so degrade to "no resume" rather than throwing.
    return null;
  }
}

export const browserMatchResumeStore: MatchResumeStore = {
  save(pointer) {
    const storage = safeLocalStorage();
    if (!storage) {
      return;
    }
    const record: MatchResumePointer = {
      sessionId: pointer.sessionId,
      userId: pointer.userId,
      savedAt: Date.now(),
    };
    try {
      storage.setItem(MATCH_RESUME_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // A write failure (quota, disabled storage) just means no resume.
    }
  },

  load(now = Date.now()) {
    const storage = safeLocalStorage();
    if (!storage) {
      return null;
    }
    const pointer = parseResumePointer(storage.getItem(MATCH_RESUME_STORAGE_KEY));
    if (!pointer || !isResumablePointer(pointer, now)) {
      // Clear anything unusable so it cannot resurface on a later load.
      this.clear();
      return null;
    }
    return pointer;
  },

  clear() {
    const storage = safeLocalStorage();
    if (!storage) {
      return;
    }
    try {
      storage.removeItem(MATCH_RESUME_STORAGE_KEY);
    } catch {
      // Nothing actionable if the removal itself fails.
    }
  },
};
