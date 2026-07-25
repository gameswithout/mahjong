import { useEffect, useState, type ReactNode } from "react";

import type { SeatView } from "../protocol/envelope";
import { HandResultScreen } from "./HandResultScreen";

export const WINNING_HAND_REVEAL_MS = 5000;

export function CompletedHandFlow({
  view,
  practice,
  revealTable,
  onPlayAgain,
  onReturn,
}: {
  view: SeatView;
  practice: boolean;
  revealTable?: ReactNode;
  onPlayAgain?: () => void;
  onReturn: () => void;
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
    const winType = view.hand_result?.kind === "zimo"
      ? { chinese: "自摸", romanized: "Zi Mo", english: "Self-Draw" }
      : view.hand_result?.kind === "discard"
        ? { chinese: "放炮", romanized: "Fan Pao", english: "Discard Win" }
        : null;
    return (
      <div className="winning-table-reveal" role="status" aria-label="Winning hand revealed">
        {revealTable}
        {winType ? (
          <div className="winning-table-win-type" aria-label={`${winType.romanized}, ${winType.english}`}>
            <strong lang="zh-Hant">{winType.chinese}</strong>
            <span>{winType.romanized} · {winType.english}</span>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <HandResultScreen
      view={view}
      practice={practice}
      onPlayAgain={onPlayAgain}
      onReturn={onReturn}
    />
  );
}
