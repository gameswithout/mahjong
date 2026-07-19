// §9.7 "Results and explanation": the end-of-hand tally. Covers items
// 1-7 (winning hand/tile, decomposition, patterns, raw Tai, Dealer Tai,
// settlement transfers, dealer continuation) plus the Match ID/Return
// slice of item 10. XP/achievements/rating (item 8, needs E11/E13),
// Add Friend and result-card image export (item 9, needs E12), and
// Report/Play Again/Continue (need E2.F6/E2.F7 match lifecycle, unbuilt)
// are all deliberately out of scope — see the WBS deps for each.
import { useState } from "react";

import type { HandWinner, MahjongSeat, SeatView, Transfer } from "../protocol/envelope";
import type { SeatId } from "./matchTableTypes";
import { tile, windName } from "./matchTableTypes";

function seatLabel(seat: MahjongSeat, localSeat: MahjongSeat): string {
  return seat === localSeat ? `You (${windName(seat as SeatId)})` : windName(seat as SeatId);
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
                {tile(item.id).glyph}
              </span>
            ))}
          </span>
        ))}
        <span className="hand-result-pair">
          {winner.score.shape.pair.map((item) => (
            <span key={item.id} className="tile tile-sm" role="img" aria-label={tile(item.id).label}>
              {tile(item.id).glyph}
            </span>
          ))}
        </span>
      </div>
      <p className="hand-result-tai-total">Raw Tai: {winner.score.raw_tai}</p>
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
              {pattern.name}: {pattern.tai} Tai
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SettlementRow({ transfer, localSeat }: { transfer: Transfer; localSeat: MahjongSeat }) {
  return (
    <li className="hand-result-transfer">
      {seatLabel(transfer.from, localSeat)} pays {seatLabel(transfer.to, localSeat)}: {transfer.amount} Jade
      {transfer.capped ? " (capped)" : ""}
    </li>
  );
}

export function HandResultScreen({ view, onReturn }: { view: SeatView; onReturn?: () => void }) {
  const result = view.hand_result;
  if (!result) {
    return null;
  }
  const winners = result.winners ?? [];
  const dealerWinner = winners.find((w) => view.settlement?.transfers?.some((t) => t.to === w.seat));
  const dealerTaiBonus =
    dealerWinner && view.settlement?.transfers?.length
      ? Math.max(0, (view.settlement.transfers.find((t) => t.to === dealerWinner.seat)?.effective_tai ?? 0) - dealerWinner.score.raw_tai)
      : 0;

  return (
    <div className="hand-result-screen" role="region" aria-label="Hand result">
      <h2 className="hand-result-heading">
        {result.kind === "exhaustive_draw" ? "Exhaustive draw" : "Hand complete"}
      </h2>

      {winners.length === 0 ? (
        <p className="hand-result-no-winner">No winner this hand.</p>
      ) : (
        winners.map((winner) => <WinnerBreakdown key={winner.seat} winner={winner} localSeat={view.seat} />)
      )}

      {dealerTaiBonus > 0 && dealerWinner && (
        <p className="hand-result-dealer-tai">
          {seatLabel(dealerWinner.seat, view.seat)} is dealer: +{dealerTaiBonus} Dealer Tai
        </p>
      )}

      {view.settlement && (
        <div className="hand-result-settlement">
          <p className="hand-result-settlement-heading">Settlement</p>
          {view.settlement.transfers && view.settlement.transfers.length > 0 ? (
            <ul>
              {view.settlement.transfers.map((transfer, index) => (
                <SettlementRow key={index} transfer={transfer} localSeat={view.seat} />
              ))}
            </ul>
          ) : (
            <p className="hand-result-no-transfers">No Jade changed hands.</p>
          )}
        </div>
      )}

      {view.next_dealer && (
        <p className="hand-result-continuation">
          {view.next_dealer.dealer_retains
            ? `${seatLabel(view.next_dealer.next_dealer, view.seat)} remains dealer (continuation ${view.next_dealer.next_continuations}).`
            : `Dealer rotates to ${seatLabel(view.next_dealer.next_dealer, view.seat)}.`}
        </p>
      )}

      <p className="hand-result-match-id">Match ID: {view.match_id}</p>

      {onReturn && (
        <button type="button" className="primary-action hand-result-return" onClick={onReturn}>
          Return
        </button>
      )}
    </div>
  );
}
