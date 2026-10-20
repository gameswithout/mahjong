import { afterEach, describe, expect, it, vi } from "vitest";
import { findUnrankedMatch } from "./unranked-matchmaking";
import type { MatchmakingClient } from "./matchmaking";
const makeClient = () => ({ createTicket: vi.fn().mockResolvedValue({ticketId:"t",isActive:true}), getTicket: vi.fn().mockResolvedValue({ticketId:"t",isActive:true}), cancelTicket: vi.fn().mockResolvedValue(undefined) });
afterEach(() => vi.useRealTimers());
describe("Unranked matchmaking", () => {
  it("uses bots directly when a human pool is not configured", async () => {
    await expect(findUnrankedMatch({signal:new AbortController().signal})).resolves.toBeNull();
  });
  it("adopts an immediate human match without opening bots", async () => {
    const client=makeClient(); client.createTicket.mockResolvedValue({ticketId:"t",sessionId:"s"} as never);
    await expect(findUnrankedMatch({client,signal:new AbortController().signal})).resolves.toMatchObject({sessionId:"s"});
    expect(client.cancelTicket).not.toHaveBeenCalled();
  });
  it("cancels the human search before permitting bot fallback", async () => {
    const client=makeClient();
    await expect(findUnrankedMatch({client,signal:new AbortController().signal,searchMs:0})).resolves.toBeNull();
    expect(client.cancelTicket).toHaveBeenCalledWith("t");
  });
  it("adopts a human match that wins the cancellation race", async () => {
    const client=makeClient(); client.cancelTicket.mockRejectedValue(new Error("matched"));
    client.getTicket.mockResolvedValue({ticketId:"t",sessionId:"s"} as never);
    await expect(findUnrankedMatch({client,signal:new AbortController().signal,searchMs:0})).resolves.toMatchObject({sessionId:"s"});
  });
  it("never opens bots after unconfirmed cancellation", async () => {
    const client=makeClient(); client.cancelTicket.mockRejectedValue(new Error("offline"));
    await expect(findUnrankedMatch({client,signal:new AbortController().signal,searchMs:0})).rejects.toThrow("offline");
  });
  it("cancels a pending search when the player leaves", async () => {
    vi.useFakeTimers(); const client=makeClient(); const controller=new AbortController();
    const promise=findUnrankedMatch({client:client as MatchmakingClient,signal:controller.signal});
    const result=expect(promise).rejects.toMatchObject({name:"AbortError"});
    await Promise.resolve(); controller.abort(); await result;
    expect(client.cancelTicket).toHaveBeenCalledWith("t");
  });
});
