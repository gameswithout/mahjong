// §8.6 party, on AGS's native Party session service.
//
// A party is an AGS session of its own, separate from the game session a match
// runs in. Its only job here is to carry a group into matchmaking together:
// the matchmaking ticket names the party's session ID, and AGS seats every
// member at the same table.

export type PartyErrorCode =
  | "configuration"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "network"
  | "timeout"
  | "protocol";

export class PartyError extends Error {
  constructor(
    readonly code: PartyErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PartyError";
  }
}

// AGS member status. Only JOINED and CONNECTED occupy a seat for our purposes;
// INVITED still reserves one, which matters when deciding whether the party is
// full.
export type PartyMemberStatus =
  | "INVITED"
  | "JOINED"
  | "CONNECTED"
  | "DISCONNECTED"
  | "LEFT"
  | "KICKED"
  | "REJECTED"
  | "TIMEOUT"
  | "DROPPED"
  | "CANCELLED"
  | string;

export interface PartyMember {
  userId: string;
  status: PartyMemberStatus;
}

export interface Party {
  partyId: string;
  leaderId: string;
  members: PartyMember[];
  // Invite code, present only after one has been generated.
  code?: string;
}

export interface PartyClient {
  current(): Promise<Party | null>;
  create(): Promise<Party>;
  invite(partyId: string, userId: string): Promise<void>;
  join(partyId: string): Promise<Party>;
  joinByCode(code: string): Promise<Party>;
  generateCode(partyId: string): Promise<string>;
  leave(partyId: string): Promise<void>;
  kick(partyId: string, userId: string): Promise<void>;
}

export interface PartyClientOptions {
  url: string;
  namespace: string;
  configurationName: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const PARTY_MAX_PLAYERS = 4;

function codeForStatus(status: number): PartyErrorCode {
  if (status === 401) {
    return "unauthenticated";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 409) {
    return "conflict";
  }
  if (status >= 500) {
    return "network";
  }
  return "protocol";
}

// A member occupies a seat while they hold one, which includes an unanswered
// invite — otherwise a party could over-invite and overflow the table.
export function occupiesSeat(status: PartyMemberStatus): boolean {
  return (
    status === "INVITED" ||
    status === "JOINED" ||
    status === "CONNECTED" ||
    status === "DISCONNECTED"
  );
}

export function seatedCount(party: Party): number {
  return party.members.filter((member) => occupiesSeat(member.status)).length;
}

export function partyIsFull(party: Party): boolean {
  return seatedCount(party) >= PARTY_MAX_PLAYERS;
}

// Members actually present, for display and for the eligibility check before
// a party enters a staked queue.
export function activeMembers(party: Party): PartyMember[] {
  return party.members.filter(
    (member) => member.status === "JOINED" || member.status === "CONNECTED",
  );
}

function readParty(value: unknown): Party | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = (value as Record<string, unknown>).data ?? value;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const partyId = record.id ?? record.partyId ?? record.sessionId;
  if (typeof partyId !== "string" || !partyId) {
    return null;
  }
  const members: PartyMember[] = Array.isArray(record.members)
    ? record.members
        .map((entry): PartyMember | null => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const member = entry as Record<string, unknown>;
          const userId = member.id ?? member.userId ?? member.userID;
          if (typeof userId !== "string" || !userId) {
            return null;
          }
          const status = member.statusV2 ?? member.status;
          return { userId, status: typeof status === "string" ? status : "JOINED" };
        })
        .filter((member): member is PartyMember => member !== null)
    : [];

  const leaderId = record.leaderId ?? record.leaderID;
  const code = record.code ?? record.inviteCode;
  return {
    partyId,
    leaderId: typeof leaderId === "string" ? leaderId : "",
    members,
    code: typeof code === "string" && code ? code : undefined,
  };
}

export function createPartyClient(
  accessToken: string,
  options: PartyClientOptions,
): PartyClient {
  if (!accessToken || !options.url || !options.namespace || !options.configurationName) {
    throw new PartyError("configuration", "Party configuration is incomplete.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = `${options.url}/session/v1/public/namespaces/${encodeURIComponent(options.namespace)}`;

  async function request(
    method: "GET" | "POST" | "DELETE" | "PATCH",
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
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
        throw new PartyError("timeout", "Party did not respond in time.", { cause: error });
      }
      throw new PartyError("network", "Party could not be reached.", { cause: error });
    } finally {
      globalThis.clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new PartyError(codeForStatus(response.status), partyMessage(response.status));
    }
    const text = await response.text();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new PartyError("protocol", "Party returned invalid JSON.", { cause: error });
    }
  }

  return {
    // AGS allows exactly one party per player, so "my parties" is at most one.
    async current() {
      const body = await request("GET", "/users/me/parties");
      const envelope = (body as Record<string, unknown> | null)?.data ?? body;
      const list = Array.isArray(envelope) ? envelope : [];
      for (const entry of list) {
        const party = readParty(entry);
        if (party) {
          return party;
        }
      }
      return null;
    },

    async create() {
      const party = readParty(
        await request("POST", "/party", {
          configurationName: options.configurationName,
          joinability: "INVITE_ONLY",
          type: "NONE",
          minPlayers: 1,
          maxPlayers: PARTY_MAX_PLAYERS,
          inviteTimeout: 60,
          inactiveTimeout: 60,
          textChat: false,
          attributes: {},
          members: [],
        }),
      );
      if (!party) {
        throw new PartyError("protocol", "Party service returned an invalid party.");
      }
      return party;
    },

    async invite(partyId, userId) {
      await request("POST", `/parties/${encodeURIComponent(partyId)}/invite`, {
        userId,
      });
    },

    // /parties/{id}/join is a 404 on the live service; the member-scoped path
    // is the one that accepts an invited player. Verified against AGS.
    async join(partyId) {
      const party = readParty(
        await request("POST", `/parties/${encodeURIComponent(partyId)}/users/me/join`),
      );
      if (!party) {
        throw new PartyError("protocol", "Party service returned an invalid party on join.");
      }
      return party;
    },

    async joinByCode(code) {
      const party = readParty(
        await request("POST", "/parties/users/me/join/code", { code: code.trim().toUpperCase() }),
      );
      if (!party) {
        throw new PartyError("protocol", "Party service returned an invalid party on join.");
      }
      return party;
    },

    async generateCode(partyId) {
      const body = await request("POST", `/parties/${encodeURIComponent(partyId)}/code`);
      const envelope = (body as Record<string, unknown> | null)?.data ?? body;
      const code = (envelope as Record<string, unknown> | null)?.code;
      if (typeof code !== "string" || !code) {
        throw new PartyError("protocol", "Party service returned no invite code.");
      }
      return code;
    },

    async leave(partyId) {
      await request("DELETE", `/parties/${encodeURIComponent(partyId)}/leave`);
    },

    async kick(partyId, userId) {
      await request(
        "DELETE",
        `/parties/${encodeURIComponent(partyId)}/members/${encodeURIComponent(userId)}`,
      );
    },
  };
}

function partyMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session is no longer valid. Please sign in again.";
    case 403:
      return "You are not allowed to do that in this party.";
    case 404:
      return "That party no longer exists.";
    case 409:
      return "That party cannot accept this right now.";
    default:
      return `Party request failed with HTTP ${status}.`;
  }
}
