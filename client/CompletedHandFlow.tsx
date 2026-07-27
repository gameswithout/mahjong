import { useEffect, useState, type ReactNode } from "react";

import type { SeatView } from "../protocol/envelope";
import { HandResultScreen } from "./HandResultScreen";

export const WINNING_HAND_REVEAL_MS = 5000;

export function CompletedHandFlow({
  view,
  practice,
  revealTable,
  onPlayAgain,
  playAgainNote,
  onReturn,
  accountUpgrade,
}: {
  view: SeatView;
  practice: boolean;
  revealTable?: ReactNode;
  onPlayAgain?: () => void;
  playAgainNote?: string;
  onReturn: () => void;
  // §10.2 guest upgrade offer. Deliberately only reaches the result screen,
  // never the winning-hand reveal: the reveal is a five-second celebration
  // nobody should be asked to fill in a form during.
  accountUpgrade?: ReactNode;
}) {
  const hasWinningHand =
    view.hand_result?.kind !== "exhaustive_draw" &&
    (view.hand_result?.winners?.length ?? 0) > 0;
  const [revealing, setRevealing] = useState(hasWinningHand);
  const resultKey = `${view.match_id}:${view.state_version}`;

  useEffect(() => {
    if (!hasWinningHand) {
      setRevealing(false);
      return;
    }
    setRevealing(true);
    const timer = window.setTimeout(() => setRevealing(false), WINNING_HAND_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [hasWinningHand, resultKey]);

  if (revealing) {
    return (
      <div className="winning-table-reveal" role="status" aria-label="Winning hand revealed">
        {revealTable}
      </div>
    );
  }
  return (
    <HandResultScreen
      view={view}
      practice={practice}
      onPlayAgain={onPlayAgain}
      playAgainNote={playAgainNote}
      onReturn={onReturn}
      accountUpgrade={accountUpgrade}
    />
  );
}
