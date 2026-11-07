import type { MatchmakingClient, MatchmakingTicket } from "./matchmaking";

export const UNRANKED_HUMAN_SEARCH_MS = 10_000;

// Never start a bot table while an unconfirmed human ticket may still match.
export async function findUnrankedMatch(options: {
  client?: MatchmakingClient;
  signal: AbortSignal;
  searchMs?: number;
  // Configured Casual pools fill seats server-side. Never split queued humans
  // into separate private tables when that service is slow or unavailable.
  serviceManagedBots?: boolean;
  pollMs?: number;
}): Promise<MatchmakingTicket | null> {
  const { client, signal } = options;
  const check = () => { if (signal.aborted) throw new DOMException("Canceled", "AbortError"); };
  check();
  if (!client) return null;
  let ticket = await client.createTicket();
  const matched = () => Boolean(ticket.sessionId || ticket.matchFound);
  const assigned = () => Boolean(ticket.sessionId);
  // Even a canceled create request must clean up the ticket it just created.
  if (signal.aborted && !matched()) {
    await client.cancelTicket(ticket.ticketId);
    check();
  }
  const deadline = Date.now() + (options.searchMs ?? (options.serviceManagedBots ? 60_000 : UNRANKED_HUMAN_SEARCH_MS));
  try {
    while (!assigned() && (matched() || ticket.isActive !== false) && Date.now() < deadline) {
      check();
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, Math.min(options.pollMs ?? 1000, Math.max(0, deadline - Date.now())));
        signal.addEventListener("abort", finish, { once: true });
      });
      check();
      ticket = await client.getTicket(ticket.ticketId);
    }
  } catch (error) {
    // Polling failures are not evidence that the human queue is empty.
    if (!matched() && ticket.isActive !== false) await client.cancelTicket(ticket.ticketId);
    throw error;
  }
  if (assigned()) return ticket;
  if (matched()) throw new Error("Your Casual match was found, but its table is not ready yet. Retry to reconnect to the same search.");
  if (ticket.isActive !== false) {
    try {
      await client.cancelTicket(ticket.ticketId);
    } catch (error) {
      // A match can win the cancellation race. Adopt it instead of opening a
      // second table. Otherwise surface the error and do not create bots.
      ticket = await client.getTicket(ticket.ticketId);
      if (!matched() && ticket.isActive !== false) throw error;
      if (assigned()) return ticket;
      if (matched()) throw new Error("Your Casual table is still being assigned. Retry to reconnect to the same search.");
    }
  }
  check();
  if (options.serviceManagedBots) throw new Error("Casual matchmaking timed out. Please try again.");
  return null;
}
