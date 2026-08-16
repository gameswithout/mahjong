// The Jade lobby tiers from the product specification §7.1. Version 1 opens
// Bamboo Courtyard; the rest ship closed until their opening criteria are met,
// and are shown locked rather than hidden so the ladder above the player is
// legible from the first session.
//
// Only Bamboo is reachable in this build because the client is configured with
// a single match pool. Sparrow is "open" in the specification but has no queue
// here yet, and saying so is more honest than presenting a button that cannot
// work.

export interface LobbyTier {
  id: string;
  name: string;
  minimumBalance: number;
  stakePerTai: number;
  debitCap: number;
  // Why a player cannot enter, in their words. Undefined means playable.
  lockedReason?: string;
}

export const LOBBY_TIERS: LobbyTier[] = [
  {
    id: "bamboo",
    name: "Bamboo Courtyard",
    minimumBalance: 1_000,
    stakePerTai: 10,
    debitCap: 300,
  },
  {
    id: "sparrow",
    name: "Sparrow Pavilion",
    minimumBalance: 10_000,
    stakePerTai: 100,
    debitCap: 3_000,
    lockedReason: "Opens once its queue is running.",
  },
  {
    id: "wind-and-cloud",
    name: "Wind and Cloud Lounge",
    minimumBalance: 100_000,
    stakePerTai: 1_000,
    debitCap: 30_000,
    lockedReason: "Opens when enough players hold the minimum balance.",
  },
  {
    id: "dragons-den",
    name: "Dragon's Den",
    minimumBalance: 1_000_000,
    stakePerTai: 10_000,
    debitCap: 300_000,
    lockedReason: "Opens when enough players hold the minimum balance.",
  },
];

export function playableTier(): LobbyTier {
  return LOBBY_TIERS[0];
}

export function lockedTiers(): LobbyTier[] {
  return LOBBY_TIERS.filter((tier) => tier.lockedReason !== undefined);
}

export function tierSummary(tier: LobbyTier): string {
  return t("tier.summary", {
    minimum: formatNumber(tier.minimumBalance),
    stake: formatNumber(tier.stakePerTai),
    cap: formatNumber(tier.debitCap),
  });
}

export function tierName(tier: LobbyTier): string {
  switch (tier.id) {
    case "bamboo":
      return t("tier.bamboo");
    case "sparrow":
      return t("tier.sparrow");
    case "wind-and-cloud":
      return t("tier.windCloud");
    case "dragons-den":
      return t("tier.dragon");
    default:
      return tier.name;
  }
}
import { formatNumber, t } from "./i18n";
