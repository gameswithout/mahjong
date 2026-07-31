export interface MatchHistoryEntry {
  matchId: string;
  completedAt: string;
  mode: string;
  result: "Win" | "Loss" | "Draw";
  winKind: string;
  winningTileId: string;
  rawTai: number;
  xpAwarded: number;
}

function number(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

export async function getMatchHistory(
  accessToken: string,
  options: { url: string; namespace: string; fetchImpl?: typeof fetch },
): Promise<MatchHistoryEntry[]> {
  const response = await (options.fetchImpl ?? fetch)(
    `${options.url.replace(/\/+$/, "")}/v1/namespaces/${encodeURIComponent(options.namespace)}/match-history?limit=30`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
  );
  if (!response.ok) {
    throw new Error(`Match history request failed with HTTP ${response.status}.`);
  }
  const body = await response.json() as { matches?: unknown };
  if (!Array.isArray(body.matches)) return [];
  return body.matches.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const raw = value as Record<string, unknown>;
    const read = (snake: string, camel: string) => raw[snake] ?? raw[camel];
    const result = read("result", "result");
    if (result !== "Win" && result !== "Loss" && result !== "Draw") return [];
    return [{
      matchId: String(read("match_id", "matchId") ?? ""),
      completedAt: String(read("completed_at", "completedAt") ?? ""),
      mode: String(read("mode", "mode") ?? "Mahjong"),
      result,
      winKind: String(read("win_kind", "winKind") ?? ""),
      winningTileId: String(read("winning_tile_id", "winningTileId") ?? ""),
      rawTai: number(read("raw_tai", "rawTai")),
      xpAwarded: number(read("xp_awarded", "xpAwarded")),
    } satisfies MatchHistoryEntry];
  });
}
