import type { Party } from "./party";
import type { GameSessionSummary } from "./session";

export function casualPartySessionId(party: Party | null, userId: string): string | undefined {
  if (!party) return undefined;
  if (party.leaderId !== userId) throw new Error("Your party leader starts Casual matchmaking for everyone.");
  const members = party.members.filter((member) => ["JOINED", "CONNECTED"].includes(member.status));
  if (!members.some((member) => member.userId === userId) || members.length > 4) throw new Error("Casual parties must have one to four connected players.");
  return party.partyId;
}
export function isCasualBotTable(session: GameSessionSummary): boolean {
  return session.attributes?.game_mode === "unranked" && [true, "true"].includes(session.attributes?.ai_practice as boolean | string);
}
export function newCasualPartyMatch(sessions: GameSessionSummary[], party: Party, userId: string, since: number): GameSessionSummary | undefined {
  const members = party.members.filter((member) => ["JOINED", "CONNECTED"].includes(member.status)).map((member) => member.userId);
  if (!members.includes(userId) || members.length > 4) return undefined;
  return sessions.find((session) => session.isActive === true && Date.parse(session.createdAt ?? "") >= since && isCasualBotTable(session) && members.every((id) => session.members.some((member) => member.userId === id && !["LEFT", "KICKED", "REJECTED", "TIMEOUT", "DROPPED", "CANCELLED"].includes(member.status ?? ""))));
}
