import { getLocale } from "./i18n";

export const FOUNDER_PACK_SKU = "og_founder_pack";
export const FOUNDER_TILE_ID = "founder-og";

export interface FounderPackStatus {
  sku: string;
  owned: boolean;
  checkout_available: boolean;
  sandbox: boolean;
}

export interface StoreClient {
  status(): Promise<FounderPackStatus>;
  checkout(): Promise<{ checkout_url: string }>;
}

export class StoreError extends Error {
  constructor(readonly code: "configuration" | "network" | "unavailable" | "protocol", message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StoreError";
  }
}

export function createStoreClient(accessToken: string, serviceURL: string, namespace: string): StoreClient {
  if (!accessToken || !serviceURL || !namespace) {
    throw new StoreError("configuration", "Store configuration is incomplete.");
  }
  const path = `${serviceURL.replace(/\/+$/, "")}/v1/namespaces/${encodeURIComponent(namespace)}/store/founder-pack`;

  async function request<T>(method: "GET" | "POST"): Promise<T> {
    let response: Response;
    try {
      response = await fetch(path + (method === "POST" ? "/checkout" : ""), {
        method,
        cache: "no-store",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: method === "POST" ? JSON.stringify({ locale: getLocale() }) : undefined,
      });
    } catch (cause) {
      throw new StoreError("network", "The store could not be reached.", { cause });
    }
    if (!response.ok) {
      const message = await response.json().then((body) => body?.message as string).catch(() => "");
      throw new StoreError(response.status === 503 ? "unavailable" : "network", message || "The store is unavailable.");
    }
    const body = await response.json().catch(() => null) as T | null;
    if (!body) throw new StoreError("protocol", "The store returned an invalid response.");
    return body;
  }

  return {
    status: () => request<FounderPackStatus>("GET"),
    checkout: () => request<{ checkout_url: string }>("POST"),
  };
}
