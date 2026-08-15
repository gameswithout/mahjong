import type { JadeAccount } from "../protocol/envelope";
import { formatNumber, t } from "./i18n";

export type JadeRecoveryState =
  | { status: "idle" }
  | { status: "claiming" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export function JadeRecoveryCard({
  account,
  state,
  onClaim,
}: {
  account: JadeAccount;
  state: JadeRecoveryState;
  onClaim: () => void;
}) {
  if (state.status === "success") {
    return (
      <p className="jade-recovery jade-recovery-success" role="status" aria-live="polite">
        {state.message}
      </p>
    );
  }

  // The pre-faucet service does not send a reason. Keep older deployments
  // compatible by leaving the existing entry explanation as the only message.
  if (
    account.balance >= account.minimum_balance ||
    account.welfare_reason === undefined
  ) {
    return null;
  }

  const amount = account.welfare_amount ?? 0;
  const canClaim = account.welfare_eligible === true && amount > 0;
  let guidance: string;
  switch (account.welfare_reason) {
    case "available":
      guidance = t("recovery.available", {
        amount: formatNumber(amount),
        minimum: formatNumber(account.minimum_balance),
      });
      break;
    case "practice_hand_required":
      guidance = t("recovery.practiceRequired", {
        minimum: formatNumber(account.minimum_balance),
      });
      break;
    case "claimed_today":
      guidance = t("recovery.claimed");
      break;
    case "reservation_open":
      guidance = t("recovery.reservation");
      break;
    default:
      guidance = t("recovery.unavailable");
      break;
  }

  return (
    <section className="jade-recovery" aria-labelledby="jade-recovery-title">
      <p className="status-label">{t("recovery.eyebrow")}</p>
      <h3 id="jade-recovery-title">{t("recovery.title")}</h3>
      <p>{guidance}</p>
      {canClaim && (
        <button
          className="secondary-action session-action"
          type="button"
          disabled={state.status === "claiming"}
          onClick={onClaim}
        >
          {state.status === "claiming"
            ? t("recovery.claiming")
            : t("recovery.claim", { amount: formatNumber(amount) })}
        </button>
      )}
      {state.status === "error" && (
        <p className="jade-recovery-error" role="alert">
          {state.message}
        </p>
      )}
    </section>
  );
}
