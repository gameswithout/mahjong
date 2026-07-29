import { describe, expect, it, vi } from "vitest";

import {
  activeMembers,
  createPartyClient,
  occupiesSeat,
  partyIsFull,
  PartyError,
  seatedCount,
  type Party,
} from "./party";

const OPTIONS = {
  url: "https://ags.test",
  namespace: "mahjong-test",
  configurationName: "mahjong-party",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function party(members: { userId: string; status: string }[]): Party {
  return { partyId: "party-1", leaderId: "alice", members };
}

describe("party seat accounting", () => {
  it("counts an unanswered invite as holding a seat", () => {
    // AGS reserves the seat while an invite is outstanding. Ignoring that
    // would let a party over-invite and overflow the four-seat table.
    expect(occupiesSeat("INVITED")).toBe(true);
    expect(occupiesSeat("JOINED")).toBe(true);
    expect(occupiesSeat("CONNECTED")).toBe(true);
    expect(occupiesSeat("DISCONNECTED")).toBe(true);
  });

  it("releases the seat once a member is gone", () => {
    for (const status of ["LEFT", "KICKED", "REJECTED", "TIMEOUT", "DROPPED", "CANCELLED"]) {
      expect(occupiesSeat(status)).toBe(false);
    }
  });

  it("is full at four held seats, invites included", () => {
    const full = party([
      { userId: "alice", status: "JOINED" },
      { userId: "bob", status: "CONNECTED" },
      { userId: "carol", status: "INVITED" },
      { userId: "dave", status: "DISCONNECTED" },
    ]);
    expect(seatedCount(full)).toBe(4);
    expect(partyIsFull(full)).toBe(true);

    const withDeparture = party([
      ...full.members.slice(0, 3),
      { userId: "dave", status: "LEFT" },
    ]);
    expect(partyIsFull(withDeparture)).toBe(false);
  });

  it("counts only present members as active", () => {
    const mixed = party([
      { userId: "alice", status: "JOINED" },
      { userId: "bob", status: "INVITED" },
      { userId: "carol", status: "CONNECTED" },
    ]);
    // An invited player is not yet playing, so they must not be counted when
    // deciding whether the party can enter a staked queue.
    expect(activeMembers(mixed).map((m) => m.userId)).toEqual(["alice", "carol"]);
  });
});

describe("party client", () => {
  it("refuses to build without a party template", () => {
    expect(() => createPartyClient("token", { ...OPTIONS, configurationName: "" })).toThrow(
      PartyError,
    );
  });

  it("reads the current party, tolerating AGS field spellings", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            id: "party-9",
            leaderId: "alice",
            members: [
              { id: "alice", statusV2: "CONNECTED" },
              { userId: "bob", status: "INVITED" },
            ],
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const current = await createPartyClient("token", { ...OPTIONS, fetchImpl }).current();
    expect(current?.partyId).toBe("party-9");
    expect(current?.leaderId).toBe("alice");
    expect(current?.members).toEqual([
      { userId: "alice", status: "CONNECTED" },
      { userId: "bob", status: "INVITED" },
    ]);
  });

  it("returns null when the player is in no party", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] })) as unknown as typeof fetch;
    expect(await createPartyClient("token", { ...OPTIONS, fetchImpl }).current()).toBeNull();
  });

  it("creates an invite-only party of four using the configured template", async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return jsonResponse({ id: "party-1", leaderId: "alice", members: [] });
    }) as unknown as typeof fetch;

    await createPartyClient("token", { ...OPTIONS, fetchImpl }).create();

    expect(sent.configurationName).toBe("mahjong-party");
    // INVITE_ONLY matters: an OPEN party could be joined by strangers, which
    // is a different feature with different moderation needs.
    expect(sent.joinability).toBe("INVITE_ONLY");
    expect(sent.maxPlayers).toBe(4);
  });

  it("uppercases an invite code so a lowercase paste still works", async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return jsonResponse({ id: "party-1", leaderId: "bob", members: [] });
    }) as unknown as typeof fetch;

    await createPartyClient("token", { ...OPTIONS, fetchImpl }).joinByCode("  ab12cd  ");
    expect(sent.code).toBe("AB12CD");
  });

  it("maps a conflict distinctly from a missing party", async () => {
    for (const [status, code] of [
      [404, "not_found"],
      [409, "conflict"],
      [403, "forbidden"],
    ] as const) {
      const fetchImpl = vi.fn(async () => jsonResponse({}, status)) as unknown as typeof fetch;
      const client = createPartyClient("token", { ...OPTIONS, fetchImpl });
      await expect(client.join("party-1")).rejects.toMatchObject({ code });
    }
  });

  it("reports a missing invite code rather than returning an empty one", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: {} })) as unknown as typeof fetch;
    const client = createPartyClient("token", { ...OPTIONS, fetchImpl });
    await expect(client.generateCode("party-1")).rejects.toMatchObject({ code: "protocol" });
  });
});

describe("live AGS party endpoints", () => {
  it("joins through the member-scoped path AGS accepts", async () => {
    // /parties/{id}/join is a 404 on the live service; only the member-scoped
    // path admits an invited player. Verified 2026-07-29.
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      seen.push(String(url));
      return jsonResponse({ id: "party-1", leaderId: "alice", members: [] });
    }) as unknown as typeof fetch;

    await createPartyClient("token", { ...OPTIONS, fetchImpl }).join("party-1");
    expect(seen[0]).toContain("/parties/party-1/users/me/join");
    expect(seen[0]).not.toMatch(/\/parties\/party-1\/join$/);
  });
});
