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
  welfare_eligible: true,
  welfare_amount: "600",
  welfare_reason: "available",
};

describe("Jade client", () => {
  it("normalizes a trailing slash in the deployed service URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ account }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createJadeClient("player-token", {
      url: "https://match.example.test/mahjong/",
      namespace: "mahjong-test",
      fetchImpl,
    });

    await client.getAccount();

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://match.example.test/mahjong/v1/namespaces/mahjong-test/jade",
      expect.any(Object),
    );
  });

  it("treats an HTML hosting fallback as a retryable service outage", async () => {
    const client = createJadeClient("player-token", {
      url: "https://match.example.test",
      namespace: "mahjong-test",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response("<!doctype html><title>Mahjong</title>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    });

    await expect(client.getAccount()).rejects.toMatchObject({
      code: "network",
      message: "Jade service is temporarily unavailable. Please retry your balance.",
    });
  });

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
      welfare_eligible: true,
      welfare_amount: 600,
      welfare_reason: "available",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://match.example.test/mahjong/v1/namespaces/mahjong-test/jade",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer player-token",
          Accept: "application/json",
        }),
      }),
    );
    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).has("Cache-Control")).toBe(false);
    expect(request.cache).toBeUndefined();
  });

  it("accepts the gateway's lower-camel JSON field names", async () => {
    const camelAccount = {
      currencyCode: "JADE",
      balance: "5000",
      reserved: "300",
      available: "4700",
      eligible: true,
      minimumBalance: "1000",
      stakePerTai: "10",
      debitCap: "300",
      welfareEligible: true,
      welfareAmount: "600",
      welfareReason: "available",
    };
    const client = createJadeClient("player-token", {
      url: "https://match.example.test",
      namespace: "mahjong-test",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ account: camelAccount }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    });

    await expect(client.getAccount()).resolves.toMatchObject({
      currency_code: "JADE",
      available: 4700,
      minimum_balance: 1000,
      welfare_eligible: true,
    });
  });

  it("accepts an omitted proto3 false eligible field", async () => {
    const { eligible: _eligible, ...ineligibleAccount } = account;
    const client = createJadeClient("player-token", {
      url: "https://match.example.test",
      namespace: "mahjong-test",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ account: ineligibleAccount }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    });

    await expect(client.getAccount()).resolves.toMatchObject({
      currency_code: "JADE",
      eligible: false,
    });
  });

  it("claims the server-calculated welfare top-up", async () => {
    const recovered = {
      ...account,
      balance: "1000",
      available: "1000",
      eligible: true,
      welfare_eligible: false,
      welfare_amount: "0",
      welfare_reason: "balance_sufficient",
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          account: recovered,
          granted: true,
          amount: "600",
          reason: "available",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = createJadeClient("player-token", {
      url: "https://match.example.test/mahjong",
      namespace: "mahjong-test",
      fetchImpl,
    });

    await expect(client.claimWelfare()).resolves.toMatchObject({
      granted: true,
      amount: 600,
      reason: "available",
      account: { balance: 1_000, eligible: true },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://match.example.test/mahjong/v1/namespaces/mahjong-test/jade/welfare",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("accepts protojson omission of a refused claim's false and zero fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          account: { ...account, welfare_eligible: false, welfare_reason: "claimed_today" },
          reason: "claimed_today",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = createJadeClient("player-token", {
      url: "https://match.example.test",
      namespace: "mahjong-test",
      fetchImpl,
    });

    await expect(client.claimWelfare()).resolves.toMatchObject({
      granted: false,
      amount: 0,
      reason: "claimed_today",
    });
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
