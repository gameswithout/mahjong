// Client-facing table view models shared by the production SeatView adapter
// and the standalone §9.2 validation harness. They intentionally avoid
// importing server implementation types so the UI consumes only the
// redacted, player-safe projection it needs.

export type SeatId = "E" | "S" | "W" | "N";

export interface WireTile {
  id: string;
  glyph: string;
  label: string;
}

export interface WireMeld {
  id: string;
  type: "chow" | "pong" | "kong";
  tiles: WireTile[];
  concealed?: boolean;
  // tileCount is set instead of populating tiles when concealed is true
  // and the tile identities are not visible to the viewer (another seat's
  // concealed Kong) — rendered as face-down placeholders.
  tileCount?: number;
}

export interface SeatState {
  seat: SeatId;
  displayName: string;
  wind: SeatId;
  isDealer: boolean;
  isActive: boolean;
  handCount: number;
  hand?: WireTile[];
  melds: WireMeld[];
  discards: WireTile[];
  // takenOver is the broader "currently bot-controlled" state (disclosed
  // AFK takeover OR a permanent AI Practice bot seat) — renders as an
  // "Auto-playing" badge, unless isBot is also set, in which case the
  // seat renders a "Bot" badge instead (never was a human, nothing
  // "disconnected"). Defaults to false for the E7.F5 mock data.
  takenOver?: boolean;
  isBot?: boolean;
}

export interface WallState {
  drawableRemaining: number;
  reserveRemaining: number;
}

// MatchAction is one legal-action button (§9.4/E8.F3). onClick is omitted
// for static validation data, where buttons render but do nothing; the live
// adapter always supplies one.
export interface MatchAction {
  id: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  // preview is the §9.4 "score preview before Win" assist, set only on the
  // Win action when the server computed one.
  preview?: WinPreview;
}

export interface WinPreview {
  rawTai: number;
  patterns: { name: string; tai: number }[];
}

// WaitEntry is one §9.4 Ting/wait-list row: a tile the local player is
// waiting on, plus how many of its four copies remain visible ("All
// visible" when zero — still listed, not hidden, for a structurally legal
// but exhausted wait).
export interface WaitEntry {
  tile: WireTile;
  visibleRemaining: number;
}

export interface MatchTableState {
  localSeat: SeatId;
  prevailingWind: SeatId;
  continuation: number;
  wall: WallState;
  seats: Record<SeatId, SeatState>;
  lastDiscard: { seat: SeatId; tile: WireTile } | null;
  claimSource: SeatId | null;
  countdownSeconds: number;
  countdownTotalSeconds: number;
  // untimed is true when neither a turn nor a claim deadline is present on
  // the wire at all (§5.10 Tutorial/AI Practice) — distinct from
  // countdownSeconds legitimately reaching 0 on a real, expired deadline.
  untimed: boolean;
  legalActions: MatchAction[];
  // waits is the local player's own §9.4 Ting/wait list, empty when they
  // aren't currently holding a waiting-shaped hand.
  waits: WaitEntry[];
}

const SUIT_GLYPHS: Record<string, string> = {
  characters: "萬",
  bamboo: "索",
  dots: "筒",
};

const HONOR_GLYPHS: Record<string, string> = {
  "wind-east": "東",
  "wind-south": "南",
  "wind-west": "西",
  "wind-north": "北",
  "dragon-red": "中",
  "dragon-green": "發",
  "dragon-white": "白",
};

const FLOWER_GLYPHS: Record<string, string> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
  plum: "梅",
  orchid: "蘭",
  chrysanthemum: "菊",
  bamboo: "竹",
};

export function tile(id: string): WireTile {
  const parts = id.split("-");
  if (parts[0] === "wind" || parts[0] === "dragon") {
    const key = `${parts[0]}-${parts[1]}`;
    return { id, glyph: HONOR_GLYPHS[key] ?? "?", label: key.replace("-", " ") };
  }
  if (parts[0] === "flower") {
    return { id, glyph: FLOWER_GLYPHS[parts[1]] ?? "?", label: `flower ${parts[1]}` };
  }
  const [suit, rank] = parts;
  return { id, glyph: `${rank}${SUIT_GLYPHS[suit] ?? "?"}`, label: `${rank} of ${suit}` };
}

// tileTypeKey groups physical tiles by identity for the §9.5 identical
// visible-tile highlight, mirroring rulesengine's tileTypeKey/tileBaseID:
// two tiles match when they're the same rank of the same suit, or the same
// named honor — the trailing "-<copy>" is stripped either way.
export function tileTypeKey(id: string): string {
  const parts = id.split("-");
  if (parts[0] === "flower") {
    return id;
  }
  return parts.slice(0, -1).join("-");
}

const seatWindLabel: Record<SeatId, string> = { E: "East", S: "South", W: "West", N: "North" };

export function windName(seat: SeatId): string {
  return seatWindLabel[seat];
}
