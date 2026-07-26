import type { JadeAccount } from "../protocol/envelope";

// Entry eligibility is decided by the server: `account.eligible` is the only
// authority on whether a seat can be taken. These helpers never re-derive that
// verdict — they only explain it, so the lobby and the requeue path say the
// same thing for the same account.

// The stake line shown wherever a player is about to commit Jade. Built from
// the server's own per-Tai and cap values so the lobby, the requeue button,
// and the table can never quote different numbers for the same tier.
export function stakeSummary(account: JadeAccount | undefined): string | undefined {
  if (!account || !account.stake_per_tai) {
    return undefined;
  }
  return (
    `Queues a new table · ${account.stake_per_tai.toLocaleString()} Jade per Tai · ` +
    `${account.debit_cap.toLocaleString()} Jade maximum loss`
  );
}

export function jadeEntryShortfall(account: JadeAccount): {
  balance: number;
  available: number;
} | null {
  if (account.eligible) {
    return null;
  }
  return {
    balance: Math.max(0, account.minimum_balance - account.balance),
    available: Math.max(0, account.debit_cap - account.available),
  };
}

// Explains an ineligible account in the player's own numbers. Kept honest
// about which requirement is unmet: a player with enough total Jade but an
// active reservation is a different problem from a player who is simply short.
export function jadeEntryRequirementMessage(account: JadeAccount): string {
  const shortfall = jadeEntryShortfall(account);
  if (!shortfall) {
    return "";
  }

  const requirement =
    `Entry needs ${account.minimum_balance.toLocaleString()} Jade in your balance ` +
    `and ${account.debit_cap.toLocaleString()} Jade available to cover the maximum loss.`;

  if (shortfall.balance > 0) {
    return (
      `${requirement} You have ${account.balance.toLocaleString()} Jade — ` +
      `${shortfall.balance.toLocaleString()} short.`
    );
  }

  // Balance is fine, so the gap is reserved Jade: an earlier table still holds
  // it. Saying so prevents the player reading this as "you are broke".
  return (
    `${requirement} You have ${account.balance.toLocaleString()} Jade, but ` +
    `${account.reserved.toLocaleString()} is still reserved for another table, ` +
    `leaving ${account.available.toLocaleString()} available.`
  );
}
