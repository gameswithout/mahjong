import { useEffect, useState, type ReactNode } from "react";

import type { SeatView } from "../protocol/envelope";
import {
  HandResultScreen,
  type FriendRequestOutcome,
  type ResultFriendsState,
} from "./HandResultScreen";
import { InterHandCountdown, RotationPanel, RotationPodium } from "./RotationPanel";

export const WINNING_HAND_REVEAL_MS = 5000;

export function CompletedHandFlow({
  view,
  practice,
  revealTable,
  onPlayAgain,
  playAgainNote,
  onReturn,
  accountUpgrade,
  resultFriends,
  onAddResultFriend,
  onRetryResultFriends,
  onReportIssue,
  viewerUserId,
  nameOf,
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
  resultFriends?: ResultFriendsState;
  onAddResultFriend?: (userId: string) => Promise<FriendRequestOutcome>;
  onRetryResultFriends?: () => void;
  onReportIssue?: () => void;
  // §8.4 Full Rotation. The viewer and a name resolver come from the caller,
  // which is the only place that knows who is at the table.
  viewerUserId?: string;
  nameOf?: (userId: string) => string | undefined;
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
  const rotation = view.rotation;
  const midRotation = Boolean(rotation) && !rotation?.complete;
  return (
    <>
      <HandResultScreen
        view={view}
        practice={practice}
        // Mid-rotation the match is not over, so neither offer applies: the
        // next hand is already coming, and "Play again" would queue for a new
        // match while this one is still running. The countdown below says what
        // actually happens next. Leaving the table stays available.
        onPlayAgain={midRotation ? undefined : onPlayAgain}
        playAgainNote={midRotation ? undefined : playAgainNote}
        onReturn={onReturn}
        accountUpgrade={accountUpgrade}
        resultFriends={resultFriends}
        onAddResultFriend={onAddResultFriend}
        onRetryResultFriends={onRetryResultFriends}
        onReportIssue={onReportIssue}
      />
      {rotation ? (
        <div className="rotation-result">
          <InterHandCountdown rotation={rotation} />
          <RotationPodium rotation={rotation} viewerUserId={viewerUserId} nameOf={nameOf} />
          {midRotation ? (
            <RotationPanel rotation={rotation} viewerUserId={viewerUserId} nameOf={nameOf} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
