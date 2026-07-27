export interface PlayerProfileConfig {
  nickname: string;
  tileSlotIds: [string, string, string];
}

export interface ProfileTileOption {
  id: string;
  label: string;
}

const NUMBER_NAMES = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];

export const PROFILE_TILE_OPTIONS: ProfileTileOption[] = [
  ...(["characters", "bamboo", "dots"] as const).flatMap((suit) =>
    NUMBER_NAMES.map((name, index) => ({
      id: `${suit}-${index + 1}-1`,
      label: `${name} of ${suit}`,
    })),
  ),
  ...(["east", "south", "west", "north"] as const).map((wind) => ({
    id: `wind-${wind}-1`,
    label: `${wind} wind`,
  })),
  ...(["red", "green", "white"] as const).map((dragon) => ({
    id: `dragon-${dragon}-1`,
    label: `${dragon} dragon`,
  })),
  ...[
    ["plum", "plum blossom"],
    ["orchid", "orchid"],
    ["chrysanthemum", "chrysanthemum"],
    ["bamboo", "bamboo flower"],
    ["spring", "spring"],
    ["summer", "summer"],
    ["autumn", "autumn"],
    ["winter", "winter"],
  ].map(([id, label]) => ({ id: `flower-${id}`, label })),
];

export const DEFAULT_PLAYER_PROFILE: PlayerProfileConfig = {
  nickname: "Player",
  tileSlotIds: ["dragon-red-1", "wind-east-1", "dots-1-1"],
};

const STORAGE_PREFIX = "mahjong-player-profile:";

function isTileOption(value: unknown): value is string {
  return (
    typeof value === "string" &&
    PROFILE_TILE_OPTIONS.some((option) => option.id === value)
  );
}

function safeNickname(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, 24);
  return trimmed || fallback;
}

export function defaultPlayerProfile(guest: boolean): PlayerProfileConfig {
  return {
    ...DEFAULT_PLAYER_PROFILE,
    nickname: guest ? "Guest player" : DEFAULT_PLAYER_PROFILE.nickname,
    tileSlotIds: [...DEFAULT_PLAYER_PROFILE.tileSlotIds],
  };
}

export function loadPlayerProfile(userId: string, guest: boolean): PlayerProfileConfig {
  const fallback = defaultPlayerProfile(guest);
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PlayerProfileConfig> & {
      avatarTileId?: unknown;
      achievementTileIds?: unknown;
    };
    // Seamlessly migrate the original avatar + two-achievement shape into
    // three equivalent cosmetic slots.
    const legacyAchievements = Array.isArray(parsed.achievementTileIds)
      ? parsed.achievementTileIds
      : [];
    const savedSlots = Array.isArray(parsed.tileSlotIds)
      ? parsed.tileSlotIds
      : [parsed.avatarTileId, legacyAchievements[0], legacyAchievements[1]];
    return {
      nickname: safeNickname(parsed.nickname, fallback.nickname),
      tileSlotIds: [
        isTileOption(savedSlots[0]) ? savedSlots[0] : fallback.tileSlotIds[0],
        isTileOption(savedSlots[1]) ? savedSlots[1] : fallback.tileSlotIds[1],
        isTileOption(savedSlots[2]) ? savedSlots[2] : fallback.tileSlotIds[2],
      ],
    };
  } catch {
    return fallback;
  }
}

export function savePlayerProfile(userId: string, profile: PlayerProfileConfig): void {
  localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(profile));
}
