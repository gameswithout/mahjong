import { describe, expect, it, vi } from "vitest";

import { createJadeClient, JadeError } from "./jade";

const account = {
  currency_code: "JADE",
  balance: "5000",
  reserved: "300",
  available: "4700",
  eligible: true,
  minimum_balance: "1000",
  stake_per_tai: "10",
  debit_cap: "300",
  wallet_sync_status: "pending",
};

describe("Jade client", () => {
  it("loads and normalizes a proto JSON account", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ account }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createJadeClient("player-token", {
      url: "https://match.example.test/mahjong",
      namespace: "mahjong-test",
      fetchImpl,
    });

    await expect(client.getAccount()).resolves.toMatchObject({
      balance: 5000,
      reserved: 300,
      available: 4700,
      minimum_balance: 1000,
      stake_per_tai: 10,
      debit_cap: 300,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://match.example.test/mahjong/v1/namespaces/mahjong-test/jade",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer player-token" }),
      }),
    );
  });

  it("reserves before queueing and releases with DELETE", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            account,
            reservation: {
              reservation_id: "reserve-1",
              amount: "300",
              status: "active",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ account: { ...account, reserved: "0", available: "5000" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const client = createJadeClient("player-token", {
      url: "https://match.example.test/mahjong",
      namespace: "mahjong-test",
      fetchImpl,
    });

    await expect(client.reserve()).resolves.toMatchObject({
      reservation: { reservation_id: "reserve-1", amount: 300 },
    });
    await expect(client.release()).resolves.toMatchObject({ reserved: 0, available: 5000 });
    expect(fetchImpl.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual([
      "POST",
      "DELETE",
    ]);
  });

  it("surfaces typed eligibility failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "1,000 Jade is required" }), {
        status: 412,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createJadeClient("player-token", {
      url: "https://match.example.test",
      namespace: "mahjong-test",
      fetchImpl,
    });

    await expect(client.reserve()).rejects.toEqual(
      expect.objectContaining<JadeError>({
        name: "JadeError",
        code: "ineligible",
        message: "1,000 Jade is required",
      }),
    );
  });
});
