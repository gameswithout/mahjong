import { MatchmakingError, type MatchmakingClient, type MatchmakingTicket } from "./matchmaking";

export const RANKED_SEARCH_MS = 120_000;
export const RANKED_TIMEOUT_MESSAGE = "No Ranked match found within two minutes. Please try again later.";

// Confirm cancellation before reporting timeout; a match can win that race.
export async function pollRankedTicket(client: MatchmakingClient, ticketId: string, elapsedMs: number): Promise<MatchmakingTicket> {
  let ticket: MatchmakingTicket;
  try {
    ticket = await client.getTicket(ticketId);
  } catch (error) {
    if (elapsedMs >= RANKED_SEARCH_MS && error instanceof MatchmakingError && error.code === "not_found") return { ticketId, isActive: false };
    throw error;
  }
  if (ticket.sessionId || ticket.matchFound || ticket.isActive === false || elapsedMs < RANKED_SEARCH_MS) return ticket;
  try {
    await client.cancelTicket(ticketId);
    return { ...ticket, isActive: false };
  } catch (error) {
    const latest = await client.getTicket(ticketId);
    if (latest.sessionId || latest.matchFound || latest.isActive === false) return latest;
    throw error;
  }
}
