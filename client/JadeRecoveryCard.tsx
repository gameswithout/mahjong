import type { JadeAccount } from "../protocol/envelope";

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
      guidance =
        `Your Practice hand unlocked today's recovery. Claim ${amount.toLocaleString()} Jade ` +
        `to return to the ${account.minimum_balance.toLocaleString()}-Jade Bamboo minimum.`;
      break;
    case "practice_hand_required":
      guidance =
        `Finish one free Practice hand today to unlock a top-up to ` +
        `${account.minimum_balance.toLocaleString()} Jade.`;
      break;
    case "claimed_today":
      guidance = "Today's recovery has already been used. It resets at 00:00 UTC.";
      break;
    case "reservation_open":
      guidance = "Leave your active table and release its Jade before claiming recovery.";
      break;
    default:
      guidance = "Recovery status is unavailable. Refresh your Jade balance and try again.";
      break;
  }

  return (
    <section className="jade-recovery" aria-labelledby="jade-recovery-title">
      <p className="status-label">Jade recovery</p>
      <h3 id="jade-recovery-title">Get back to Bamboo</h3>
      <p>{guidance}</p>
      {canClaim && (
        <button
          className="secondary-action session-action"
          type="button"
          disabled={state.status === "claiming"}
          onClick={onClaim}
        >
          {state.status === "claiming"
            ? "Claiming recovery…"
            : `Claim ${amount.toLocaleString()} Jade`}
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
