import { describe, expect, it, vi } from "vitest";

import type { JadeClient } from "./jade";
import type { MatchmakingClient } from "./matchmaking";
import { createStakedMatchmakingTicket } from "./staked-matchmaking";

const account = {
  currency_code: "JADE",
  balance: 5000,
  reserved: 300,
  available: 4700,
  eligible: true,
  minimum_balance: 1000,
  stake_per_tai: 10,
  debit_cap: 300,
};

describe("staked matchmaking", () => {
  it("reserves Jade before creating an AGS ticket", async () => {
    const calls: string[] = [];
    const jade = {
      reserve: vi.fn(async () => {
        calls.push("reserve");
        return {
          account,
          reservation: { reservation_id: "reserve-1", amount: 300, status: "active" },
        };
      }),
      release: vi.fn(),
      getAccount: vi.fn(),
    } satisfies JadeClient;
    const matchmaking = {
      createTicket: vi.fn(async () => {
        calls.push("ticket");
        return { ticketId: "ticket-1" };
      }),
      getTicket: vi.fn(),
      cancelTicket: vi.fn(),
    } satisfies MatchmakingClient;

    await expect(
      createStakedMatchmakingTicket(jade, matchmaking),
    ).resolves.toEqual({ ticketId: "ticket-1" });
    expect(calls).toEqual(["reserve", "ticket"]);
  });

  it("releases an unbound reserve when ticket creation fails", async () => {
    const onReleased = vi.fn();
    const jade = {
      reserve: vi.fn().mockResolvedValue({
        account,
        reservation: { reservation_id: "reserve-1", amount: 300, status: "active" },
      }),
      release: vi.fn().mockResolvedValue({ ...account, reserved: 0, available: 5000 }),
      getAccount: vi.fn(),
    } satisfies JadeClient;
    const matchmaking = {
      createTicket: vi.fn().mockRejectedValue(new Error("ticket failed")),
      getTicket: vi.fn(),
      cancelTicket: vi.fn(),
    } satisfies MatchmakingClient;

    await expect(
      createStakedMatchmakingTicket(jade, matchmaking, undefined, onReleased),
    ).rejects.toThrow("ticket failed");
    expect(jade.release).toHaveBeenCalledOnce();
    expect(onReleased).toHaveBeenCalledWith({
      ...account,
      reserved: 0,
      available: 5000,
    });
  });
});
