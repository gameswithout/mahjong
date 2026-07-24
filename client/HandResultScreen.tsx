// §9.7 "Results and explanation": the end-of-hand tally. Covers items
// 1-7 (winning hand/tile, decomposition, patterns, raw Tai, Dealer Tai,
// settlement transfers, dealer continuation) plus the Match ID and
// Practice replay/return slice of item 10. XP/achievements/rating (item 8,
// needs E11/E13), Add Friend and result-card image export (item 9, needs
// E12), and human-queue Report/Play Again/Continue remain deferred.
import { useState } from "react";

import type { HandWinner, MahjongSeat, SeatView, Transfer } from "../protocol/envelope";
import { TileFace } from "./TileFace";
import type { SeatId } from "./matchTableTypes";
import { tile, windName } from "./matchTableTypes";

const SEAT_ORDER: MahjongSeat[] = ["E", "S", "W", "N"];

function seatLabel(seat: MahjongSeat, localSeat: MahjongSeat): string {
  return seat === localSeat ? `You (${windName(seat as SeatId)})` : windName(seat as SeatId);
}

function currentDealer(view: SeatView): MahjongSeat | null {
  const outcome = view.next_dealer;
  if (!outcome) {
    return null;
  }
  if (outcome.dealer_retains) {
    return outcome.next_dealer;
  }
  const nextIndex = SEAT_ORDER.indexOf(outcome.next_dealer);
  return nextIndex < 0 ? null : SEAT_ORDER[(nextIndex + SEAT_ORDER.length - 1) % SEAT_ORDER.length];
}

function WinnerBreakdown({ winner, localSeat }: { winner: HandWinner; localSeat: MahjongSeat }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="hand-result-winner">
      <p className="hand-result-winner-heading">{seatLabel(winner.seat, localSeat)} won</p>
      <div className="hand-result-decomposition" aria-label="Winning hand decomposition">
        {winner.score.shape.melds.map((meld, index) => (
          <span key={index} className="hand-result-meld">
            {meld.tiles?.map((item) => (
              <span key={item.id} className="tile tile-sm" role="img" aria-label={tile(item.id).label}>
                <TileFace id={item.id} size="sm" />
              </span>
            ))}
          </span>
        ))}
        <span className="hand-result-pair">
          {winner.score.shape.pair.map((item) => (
            <span key={item.id} className="tile tile-sm" role="img" aria-label={tile(item.id).label}>
              <TileFace id={item.id} size="sm" />
            </span>
          ))}
        </span>
      </div>
      <p className="hand-result-tai-total">
        Raw <span className="bilingual-term"><span lang="zh-Hant">台</span><small>(Tai)</small></span>: {winner.score.raw_tai}
      </p>
      <button
        type="button"
        className="secondary-action hand-result-why-toggle"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {expanded ? "Hide" : "Why this scored"}
      </button>
      {expanded && (
        <ul className="hand-result-patterns">
          {winner.score.patterns.map((pattern) => (
            <li key={pattern.name}>
              {pattern.name}: {pattern.tai} <span lang="zh-Hant">台</span> (Tai)
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SettlementRow({
  transfer,
  localSeat,
  unit,
}: {
  transfer: Transfer;
  localSeat: MahjongSeat;
  unit: "Jade" | "Practice points";
}) {
  return (
    <li className="hand-result-transfer">
      {seatLabel(transfer.from, localSeat)} pays {seatLabel(transfer.to, localSeat)}: {transfer.amount} {unit}
      {transfer.capped ? " (capped)" : ""}
    </li>
  );
}

export interface HandResultScreenProps {
  view: SeatView;
  practice?: boolean;
  onPlayAgain?: () => void;
  onReturn?: () => void;
}

export function HandResultScreen({
  view,
  practice = false,
  onPlayAgain,
  onReturn,
}: HandResultScreenProps) {
  const result = view.hand_result;
  if (!result) {
    return null;
  }
  const winners = result.winners ?? [];
  const winningTile = result.winning_tile_id ? tile(result.winning_tile_id) : null;
  const dealer = currentDealer(view);
  const dealerTaiBonus = Math.max(
    0,
    ...(view.settlement?.transfers ?? []).map((transfer) => {
      const winner = winners.find((candidate) => candidate.seat === transfer.to);
      return winner ? transfer.effective_tai - winner.score.raw_tai : 0;
    }),
  );

  return (
    <div className="hand-result-screen" role="region" aria-label="Hand result">
      <h2 className="hand-result-heading">
        {result.kind === "exhaustive_draw" ? "Exhaustive draw" : "Hand complete"}
      </h2>

      {practice && (
        <p className="hand-result-practice-note">
          Practice result — no Jade, rating, or progression is changed.
        </p>
      )}

      {winningTile && (
        <p className="hand-result-winning-tile">
          Winning tile:{" "}
          <span className="tile tile-sm" role="img" aria-label={winningTile.label}>
            <TileFace id={winningTile.id} size="sm" />
          </span>
        </p>
      )}

      {winners.length === 0 ? (
        <p className="hand-result-no-winner">No winner this hand.</p>
      ) : (
        winners.map((winner) => <WinnerBreakdown key={winner.seat} winner={winner} localSeat={view.seat} />)
      )}

      {dealerTaiBonus > 0 && dealer && (
        <p className="hand-result-dealer-tai">
          Dealer <span className="bilingual-term"><span lang="zh-Hant">台</span><small>(Tai)</small></span>: +{dealerTaiBonus} when{" "}
          {seatLabel(dealer, view.seat)} is the winner or payer
        </p>
      )}

      {view.settlement && (
        <div className="hand-result-settlement">
          <p className="hand-result-settlement-heading">
            {practice ? "Practice score" : "Settlement"}
          </p>
          {view.settlement.transfers && view.settlement.transfers.length > 0 ? (
            <ul>
              {view.settlement.transfers.map((transfer, index) => (
                <SettlementRow
                  key={index}
                  transfer={transfer}
                  localSeat={view.seat}
                  unit={practice ? "Practice points" : "Jade"}
                />
              ))}
            </ul>
          ) : (
            <p className="hand-result-no-transfers">
              {practice ? "No Practice points changed." : "No Jade changed hands."}
            </p>
          )}
        </div>
      )}

      {!practice && view.jade_settlement && (
        <div
          className="hand-result-jade"
          data-testid="jade-settlement"
          data-jade-delta={view.jade_settlement.delta}
          data-jade-before={view.jade_settlement.balance_before}
          data-jade-after={view.jade_settlement.balance_after}
          data-journal-id={view.jade_settlement.journal_id}
        >
          <p className="hand-result-settlement-heading">Your Jade</p>
          <p className="hand-result-jade-delta">
            {view.jade_settlement.delta > 0 ? "+" : ""}
            {view.jade_settlement.delta.toLocaleString()} Jade
          </p>
          <p>
            {view.jade_settlement.balance_before.toLocaleString()} →{" "}
            <strong>{view.jade_settlement.balance_after.toLocaleString()} Jade</strong>
          </p>
          <p className="session-detail">
            Settlement posted
            {view.jade_account?.wallet_sync_status === "synced"
              ? " · AGS Wallet synced"
              : " · AGS Wallet syncing"}
          </p>
        </div>
      )}

      {!practice && view.jade_account && !view.jade_settlement && (
        <p className="hand-result-continuation" role="status" aria-live="polite">
          Posting Jade settlement…
        </p>
      )}

      {!practice && view.next_dealer && (
        <p className="hand-result-continuation">
          {view.next_dealer.dealer_retains
            ? `${seatLabel(view.next_dealer.next_dealer, view.seat)} remains dealer (continuation ${view.next_dealer.next_continuations}).`
            : `Dealer rotates to ${seatLabel(view.next_dealer.next_dealer, view.seat)}.`}
        </p>
      )}

      <p className="hand-result-match-id">Match ID: {view.match_id}</p>

      {(onPlayAgain || onReturn) && (
        <div className="hand-result-actions">
          {onPlayAgain && (
            <button type="button" className="primary-action" onClick={onPlayAgain}>
              Play Again
            </button>
          )}
          {onReturn && (
            <button type="button" className="secondary-action hand-result-return" onClick={onReturn}>
              Return to Lobby
            </button>
          )}
        </div>
      )}
    </div>
  );
}
