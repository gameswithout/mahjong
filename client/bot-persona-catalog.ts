/**
 * The AI Practice opponent picker's catalog client.
 *
 * bot-persona.ts is about naming a seat that is already playing; this file
 * is about the roster a player picks *from*, fetched from
 * GET /v1/namespaces/{namespace}/bot-personas (pkg/service/match_service.go
 * ListBotPersonas). The two are kept separate on purpose — one reads a
 * PlayerView already on the wire, the other makes its own request — but
 * both exist for the same reason: the client holds no second hand-authored
 * copy of persona display copy, because that copy would drift from
 * bots/personas/<id>/persona.md the moment either side changed.
 */

export type BotPersonaCatalogErrorCode =
  | "configuration"
  | "network"
  | "timeout"
  | "unauthenticated"
  | "protocol";

export class BotPersonaCatalogError extends Error {
  constructor(
    readonly code: BotPersonaCatalogErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "BotPersonaCatalogError";
  }
}

/** The five §5 display ratings, 1-5. Intended preferences, not outcomes. */
export interface PersonaBars {
  pace: number;
  value: number;
  caution: number;
  calling: number;
  concealment: number;
}

/** One persona's picker-card content. */
export interface BotPersonaCard {
  id: string;
  name: string;
  styleTag: string;
  tagline: string;
  glyph: string;
  bars: PersonaBars;
  strength: string;
  weakness: string;
}

export interface BotPersonaCatalogClient {
  list(): Promise<BotPersonaCard[]>;
}

export interface BotPersonaCatalogClientOptions {
  // Match service base URL, not the AGS base URL.
  url: string;
  namespace: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;

export function createBotPersonaCatalogClient(
  accessToken: string,
  options: BotPersonaCatalogClientOptions,
): BotPersonaCatalogClient {
  if (!accessToken || !options.url || !options.namespace) {
    throw new BotPersonaCatalogError("configuration", "Bot persona catalog configuration is incomplete.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${options.url}/v1/namespaces/${encodeURIComponent(options.namespace)}/bot-personas`;

  return {
    async list() {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new BotPersonaCatalogError("timeout", "The opponent catalog did not load in time.", {
            cause: error,
          });
        }
        throw new BotPersonaCatalogError("network", "The opponent catalog could not be reached.", {
          cause: error,
        });
      } finally {
        globalThis.clearTimeout(timeout);
      }

      if (response.status === 401) {
        throw new BotPersonaCatalogError("unauthenticated", "Sign in again to choose your opponents.");
      }
      if (!response.ok) {
        throw new BotPersonaCatalogError("network", "The opponent catalog could not be loaded.");
      }
      try {
        return readBotPersonaCards(await response.json());
      } catch (error) {
        throw new BotPersonaCatalogError("protocol", "The opponent catalog returned an unexpected response.", {
          cause: error,
        });
      }
    },
  };
}

/**
 * Parses a ListBotPersonasResponse body defensively, the same way
 * player-stats.ts's readStatValues does: protojson field names are
 * unpredictable across encoders (snake_case vs camelCase), and a row this
 * build doesn't understand is skipped rather than failing the whole catalog.
 */
export function readBotPersonaCards(body: unknown): BotPersonaCard[] {
  const data = (body as { personas?: unknown } | null)?.personas;
  if (!Array.isArray(data)) {
    return [];
  }
  const cards: BotPersonaCard[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const item = entry as Record<string, unknown>;
    const id = str(item, "id");
    const name = str(item, "name");
    if (!id || !name) {
      continue;
    }
    const barsSource = (item.bars ?? {}) as Record<string, unknown>;
    cards.push({
      id,
      name,
      styleTag: str(item, "style_tag", "styleTag"),
      tagline: str(item, "tagline"),
      glyph: str(item, "glyph"),
      bars: {
        pace: num(barsSource, "pace"),
        value: num(barsSource, "value"),
        caution: num(barsSource, "caution"),
        calling: num(barsSource, "calling"),
        concealment: num(barsSource, "concealment"),
      },
      strength: str(item, "strength"),
      weakness: str(item, "weakness"),
    });
  }
  return cards;
}

function str(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function num(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
