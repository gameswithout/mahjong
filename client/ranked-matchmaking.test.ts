import { describe, expect, it, vi } from "vitest";
import { pollRankedTicket } from "./ranked-matchmaking";

describe("Ranked timeout", () => {
  it("keeps searching before two minutes, then confirms cancellation", async () => {
    const client = { createTicket: vi.fn(), getTicket: vi.fn().mockResolvedValue({ ticketId: "t", isActive: true }), cancelTicket: vi.fn().mockResolvedValue(undefined) };
    expect((await pollRankedTicket(client, "t", 119999)).isActive).toBe(true);
    expect(client.cancelTicket).not.toHaveBeenCalled();
    expect((await pollRankedTicket(client, "t", 120000)).isActive).toBe(false);
    expect(client.cancelTicket).toHaveBeenCalledWith("t");
  });
  it("adopts a match that wins the cancellation race", async () => {
    const client = { createTicket: vi.fn(), getTicket: vi.fn().mockResolvedValueOnce({ ticketId: "t", isActive: true }).mockResolvedValueOnce({ ticketId: "t", sessionId: "s" }), cancelTicket: vi.fn().mockRejectedValue(new Error("matched")) };
    expect((await pollRankedTicket(client, "t", 120000)).sessionId).toBe("s");
  });
  it("does not claim timeout when cancellation is unconfirmed", async () => {
    const client = { createTicket: vi.fn(), getTicket: vi.fn().mockResolvedValue({ ticketId: "t", isActive: true }), cancelTicket: vi.fn().mockRejectedValue(new Error("offline")) };
    await expect(pollRankedTicket(client, "t", 120000)).rejects.toThrow("offline");
  });
});
