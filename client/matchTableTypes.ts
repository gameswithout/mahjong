// Wireframe-only data shapes for the §9.2 match table validation prototype
// (E7.F5). These intentionally mirror the rules engine's Seat/Tile/Meld
// vocabulary loosely, without importing Go types, since this component
// renders illustrative static/mock state, not live server data.

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
}

export interface WallState {
  drawableRemaining: number;
  reserveRemaining: number;
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
  legalActions: string[];
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

const seatWindLabel: Record<SeatId, string> = { E: "East", S: "South", W: "West", N: "North" };

export function windName(seat: SeatId): string {
  return seatWindLabel[seat];
}
