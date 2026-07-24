import type { JadeAccount } from "../protocol/envelope";
import type { JadeClient } from "./jade";
import type { MatchmakingClient, MatchmakingTicket } from "./matchmaking";

export async function createStakedMatchmakingTicket(
  jade: JadeClient,
  matchmaking: MatchmakingClient,
  onReserved?: (account: JadeAccount) => void,
  onReleased?: (account: JadeAccount) => void,
): Promise<MatchmakingTicket> {
  const reservation = await jade.reserve();
  onReserved?.(reservation.account);
  try {
    return await matchmaking.createTicket();
  } catch (error) {
    // The ticket never became active, so the cap is still unbound. Cleanup is
    // best-effort here; the server also expires unbound reservations.
    const released = await jade.release().catch(() => undefined);
    if (released) {
      onReleased?.(released);
    }
    throw error;
  }
}
