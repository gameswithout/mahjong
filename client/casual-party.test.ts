import { expect, it } from "vitest";
import { casualPartySessionId, isCasualBotTable, newCasualPartyMatch } from "./casual-party";
import type { Party } from "./party";
const party: Party = { partyId: "party", leaderId: "leader", members: [{ userId: "leader", status: "JOINED" }, { userId: "follower", status: "CONNECTED" }] };
it("submits only the leader's party ticket, while allowing solo entry", () => {
  expect(casualPartySessionId(null, "solo")).toBeUndefined();
  expect(casualPartySessionId(party, "leader")).toBe("party");
  expect(() => casualPartySessionId(party, "follower")).toThrow("leader");
});
it("adopts only a new active Casual table containing the connected party", () => {
  const now = Date.now();
  const session = { sessionId: "match", isActive: true, createdAt: new Date(now).toISOString(), attributes: { game_mode: "unranked", ai_practice: true }, members: party.members };
  expect(newCasualPartyMatch([session], party, "follower", now - 1)?.sessionId).toBe("match");
  expect(newCasualPartyMatch([{ ...session, createdAt: "2000-01-01" }], party, "follower", now)).toBeUndefined();
  expect(newCasualPartyMatch([{ ...session, members: [] }], party, "follower", now)).toBeUndefined();
  expect(newCasualPartyMatch([{ ...session, isActive: false }], party, "follower", now)).toBeUndefined();
  expect(isCasualBotTable({ ...session, attributes: { full_rotation: true } })).toBe(false);
});
