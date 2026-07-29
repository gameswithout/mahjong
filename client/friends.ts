// §10.6 friends, on AGS's native Friends and Presence services.
//
// No first-party friend graph exists and none should: AGS owns the
// relationship, the request lifecycle, and presence. This module is a typed
// transport over those endpoints, shaped like jade.ts and progression.ts —
// stable error codes, no thrown strings, no derivation of anything the server
// owns.

export type FriendsErrorCode =
  | "configuration"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "network"
  | "timeout"
  | "protocol";

export class FriendsError extends Error {
  constructor(
    readonly code: FriendsErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "FriendsError";
  }
}

// AGS presence availability. The numeric form is what the lobby service
// returns; the names are ours, because "2" in a UI is not an answer.
export type PresenceState = "offline" | "online" | "busy" | "invisible";

export interface Friend {
  userId: string;
  presence: PresenceState;
  // Free-text activity AGS carries alongside presence. Present only when the
  // player's own client has set it.
  activity?: string;
}

export interface FriendRequest {
  userId: string;
  // AGS returns request time on the *WithTime variants; absent otherwise.
  requestedAt?: string;
}

export interface FriendsClient {
  list(): Promise<Friend[]>;
  incoming(): Promise<FriendRequest[]>;
  outgoing(): Promise<FriendRequest[]>;
  sendRequest(userId: string): Promise<void>;
  accept(userId: string): Promise<void>;
  reject(userId: string): Promise<void>;
  cancel(userId: string): Promise<void>;
  unfriend(userId: string): Promise<void>;
}

export interface FriendsClientOptions {
  url: string;
  namespace: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function codeForStatus(status: number): FriendsErrorCode {
  if (status === 401) {
    return "unauthenticated";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 404) {
    return "not_found";
  }
  // §10.6 caps requests at 20/day and 5/min, enforced server-side. A player
  // who hits that has done nothing wrong and needs telling, not a retry loop.
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 500) {
    return "network";
  }
  return "protocol";
}

// AGS presence availability codes. Anything unrecognised is treated as
// offline: showing a friend as available when they are not is the failure a
// player actually notices.
function readPresence(value: unknown): PresenceState {
  switch (value) {
    case 1:
    case "1":
      return "online";
    case 2:
    case "2":
      return "busy";
    case 3:
    case "3":
      return "invisible";
    default:
      return "offline";
  }
}

// AGS spells this "friendIDs" — capital ID — on the live service. Getting it
// wrong is silent: the request succeeds and the list is simply empty, which
// looks identical to having no friends. Verified against the live namespace,
// with the other spellings kept as fallbacks rather than guesses.
function readIdList(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const raw = value as Record<string, unknown>;
  const ids = raw.friendIDs ?? raw.friendIds ?? raw.data;
  if (Array.isArray(ids)) {
    const direct = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (direct.length > 0 || ids.length === 0) {
      return direct;
    }
  }
  // The richer array AGS also returns, each entry carrying a userId.
  const friends = raw.friends;
  if (Array.isArray(friends)) {
    return friends
      .map((entry) =>
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>).userId
          : undefined,
      )
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  return [];
}

function readRequests(value: unknown): FriendRequest[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const raw = value as Record<string, unknown>;
  const entries = raw.friendIDs ?? raw.friendIds ?? raw.data;
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map((entry): FriendRequest | null => {
      if (typeof entry === "string") {
        return { userId: entry };
      }
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const userId = record.friendId ?? record.userId ?? record.id;
      if (typeof userId !== "string" || !userId) {
        return null;
      }
      const requestedAt = record.requestedAt;
      return {
        userId,
        requestedAt: typeof requestedAt === "string" ? requestedAt : undefined,
      };
    })
    .filter((entry): entry is FriendRequest => entry !== null);
}

export function createFriendsClient(
  accessToken: string,
  options: FriendsClientOptions,
): FriendsClient {
  if (!accessToken || !options.url || !options.namespace) {
    throw new FriendsError("configuration", "Friends configuration is incomplete.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const namespace = encodeURIComponent(options.namespace);
  const friendsBase = `${options.url}/friends/namespaces/${namespace}/me`;
  const presenceURL = `${options.url}/lobby/v1/public/presence/namespaces/${namespace}/users/presence`;

  async function request(
    method: "GET" | "POST",
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new FriendsError("timeout", "Friends did not respond in time.", { cause: error });
      }
      throw new FriendsError("network", "Friends could not be reached.", { cause: error });
    } finally {
      globalThis.clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new FriendsError(
        codeForStatus(response.status),
        friendlyMessage(codeForStatus(response.status), response.status),
      );
    }
    const text = await response.text();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new FriendsError("protocol", "Friends returned invalid JSON.", { cause: error });
    }
  }

  // Presence for a set of friends, in one call. Absent entries stay offline
  // rather than being dropped, so a friend never vanishes from the list
  // because presence was unavailable.
  async function presenceFor(userIds: string[]): Promise<Map<string, Friend>> {
    const known = new Map<string, Friend>();
    for (const userId of userIds) {
      known.set(userId, { userId, presence: "offline" });
    }
    if (userIds.length === 0) {
      return known;
    }
    let body: unknown;
    try {
      body = await request("GET", `${presenceURL}?userIds=${userIds.map(encodeURIComponent).join(",")}`);
    } catch {
      // Presence is decoration on top of the friend list. Losing it must not
      // lose the list itself.
      return known;
    }
    const data = (body as Record<string, unknown> | null)?.data;
    if (!Array.isArray(data)) {
      return known;
    }
    for (const entry of data) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const userId = record.userId;
      if (typeof userId !== "string" || !known.has(userId)) {
        continue;
      }
      known.set(userId, {
        userId,
        presence: readPresence(record.availability),
        activity: typeof record.activity === "string" && record.activity ? record.activity : undefined,
      });
    }
    return known;
  }

  return {
    async list() {
      const body = await request("GET", `${friendsBase}?limit=100`);
      const ids = readIdList(body);
      const withPresence = await presenceFor(ids);
      // Online first, then by id so the order is stable between polls — a list
      // that reshuffles under the cursor is worse than one that is not sorted.
      return ids
        .map((id) => withPresence.get(id) ?? { userId: id, presence: "offline" as const })
        .sort((a, b) => {
          const rank = (f: Friend) => (f.presence === "offline" ? 1 : 0);
          return rank(a) - rank(b) || a.userId.localeCompare(b.userId);
        });
    },
    async incoming() {
      return readRequests(await request("GET", `${friendsBase}/incoming?limit=100`));
    },
    async outgoing() {
      return readRequests(await request("GET", `${friendsBase}/outgoing?limit=100`));
    },
    async sendRequest(userId) {
      await request("POST", `${friendsBase}/request`, { friendId: userId });
    },
    async accept(userId) {
      await request("POST", `${friendsBase}/request/accept`, { friendId: userId });
    },
    async reject(userId) {
      await request("POST", `${friendsBase}/request/reject`, { friendId: userId });
    },
    async cancel(userId) {
      await request("POST", `${friendsBase}/request/cancel`, { friendId: userId });
    },
    async unfriend(userId) {
      await request("POST", `${friendsBase}/unfriend`, { friendId: userId });
    },
  };
}

function friendlyMessage(code: FriendsErrorCode, status: number): string {
  switch (code) {
    case "unauthenticated":
      return "Your session is no longer valid. Please sign in again.";
    case "forbidden":
      return "You do not have access to that.";
    case "not_found":
      return "That player could not be found.";
    case "rate_limited":
      return "You have sent too many friend requests. Try again later.";
    case "network":
      return "Friends could not be reached. Please retry.";
    default:
      return `Friends request failed with HTTP ${status}.`;
  }
}
