// §9.7 "Results and explanation": the end-of-hand tally. Covers items
// 1-7 (winning hand/tile, decomposition, patterns, raw Tai, Dealer Tai,
// settlement transfers, dealer continuation) plus the Match ID and
// Practice replay/return slice of item 10. XP/achievements/rating (item 8,
// needs E11/E13), Add Friend and result-card image export (item 9, needs
// E12), and human-queue Report/Play Again/Continue remain deferred.
import { useState, type ReactNode } from "react";

import type { HandResult, HandWinner, MahjongSeat, SeatView, Transfer } from "../protocol/envelope";
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

function walletSyncPresentation(status: string | undefined, error: string | undefined): {
  icon: string;
  message: string;
} {
  switch (status) {
    case "synced":
      return { icon: "✓", message: "Settlement posted · AGS Wallet synced" };
    case "pending":
      return { icon: "…", message: "Settlement posted · AGS Wallet queued" };
    case "syncing":
      return { icon: "↻", message: "Settlement posted · AGS Wallet syncing" };
    case "error":
      if (error === "unauthorized" || error === "forbidden") {
        return {
          icon: "!",
          message: "Settlement posted · Wallet sync needs service attention; your Jade is safe",
        };
      }
      return {
        icon: "!",
        message: "Settlement posted · Wallet sync delayed; retrying automatically",
      };
    default:
      return { icon: "?", message: "Settlement posted · Wallet status unavailable" };
  }
}

const WIN_TYPE_COPY: Record<HandResult["kind"], { chinese: string; romanized: string; english: string }> = {
  discard: { chinese: "胡", romanized: "Hu", english: "" },
  zimo: { chinese: "自摸", romanized: "Zi Mo", english: "Self-Draw" },
  rob: { chinese: "搶槓", romanized: "Qiang Gang", english: "Robbing the Kong" },
  eight_flowers: { chinese: "八仙過海", romanized: "Eight Flowers", english: "Eight Flowers Win" },
  heavenly: { chinese: "天胡", romanized: "Tian Hu", english: "Heavenly Hand" },
  exhaustive_draw: { chinese: "流局", romanized: "Liu Ju", english: "Exhaustive Draw" },
};

function WinTypeBanner({
  result,
  winners,
  localSeat,
}: {
  result: HandResult;
  winners: HandWinner[];
  localSeat: MahjongSeat;
}) {
  const copy = WIN_TYPE_COPY[result.kind];
  const winningTile = result.winning_tile_id ? tile(result.winning_tile_id) : null;
  const winnerNames = winners.map((winner) => seatLabel(winner.seat, localSeat)).join(" & ");
  const payerName = result.payer ? seatLabel(result.payer, localSeat) : null;

  return (
    <header className={`hand-result-win-type hand-result-win-type-${result.kind}`}>
      <h2 className="hand-result-win-type-chinese" lang="zh-Hant">{copy.chinese}</h2>
      <p className="hand-result-win-type-name">
        {copy.romanized}{copy.english ? ` · ${copy.english}` : ""}
      </p>
      {result.kind === "discard" && payerName && winnerNames ? (
        <div className="hand-result-win-relationship" aria-label={`${payerName} discarded the winning tile to ${winnerNames}`}>
          <strong className="hand-result-payer">{payerName}</strong>
          <span className="hand-result-win-arrow">discarded winning tile</span>
          {winningTile ? (
            <span className="tile tile-md" role="img" aria-label={winningTile.label}>
              <TileFace id={winningTile.id} size="md" />
            </span>
          ) : null}
          <span className="hand-result-win-arrow">to</span>
          <strong className="hand-result-recipient">{winnerNames}</strong>
        </div>
      ) : result.kind === "zimo" && winnerNames ? (
        <div className="hand-result-win-relationship hand-result-self-draw" aria-label={`${winnerNames} drew the winning tile`}>
          <strong className="hand-result-recipient">{winnerNames}</strong>
          <span>drew the winning tile themselves</span>
        </div>
      ) : null}
      {winningTile && result.kind !== "discard" ? (
        <div className="hand-result-hero-tile">
          <span>Winning tile</span>
          <span className="tile tile-md" role="img" aria-label={winningTile.label}>
            <TileFace id={winningTile.id} size="md" />
          </span>
        </div>
      ) : null}
    </header>
  );
}

function WinnerBreakdown({ winner, localSeat }: { winner: HandWinner; localSeat: MahjongSeat }) {
  // The result should explain itself on first scan. Keep the authoritative
  // scoring patterns open by default while still allowing experienced
  // players to collapse the detail.
  const [expanded, setExpanded] = useState(true);
  return (
    <section className="hand-result-winner" aria-labelledby={`winner-${winner.seat}`}>
      <div className="hand-result-winner-header">
        <div>
          <p className="hand-result-kicker">Winning hand</p>
          <h4 id={`winner-${winner.seat}`} className="hand-result-winner-heading">
            {seatLabel(winner.seat, localSeat)}
          </h4>
        </div>
        <div className="hand-result-score-badge" aria-label={`${winner.score.raw_tai} raw Tai`}>
          <span>Raw score</span>
          <strong>{winner.score.raw_tai} <span lang="zh-Hant">台</span></strong>
        </div>
      </div>
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
      <button
        type="button"
        className="secondary-action hand-result-why-toggle"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={`winner-score-${winner.seat}`}
      >
        <span>Why this scored</span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div id={`winner-score-${winner.seat}`} className="hand-result-score-details">
          <ul className="hand-result-patterns" aria-label="Scoring patterns">
            {winner.score.patterns.map((pattern) => (
              <li key={pattern.name}>
                <span>{pattern.name}</span>
                <strong>{pattern.tai} <span lang="zh-Hant">台</span></strong>
              </li>
            ))}
          </ul>
          <p className="hand-result-tai-total">
            <span>Raw Tai subtotal</span>
            <strong>{winner.score.raw_tai} <span className="bilingual-term"><span lang="zh-Hant">台</span><small>(Tai)</small></span></strong>
          </p>
        </div>
      )}
    </section>
  );
}

function formatSignedAmount(amount: number): string {
  if (amount === 0) {
    return "0";
  }
  return `${amount > 0 ? "+" : "−"}${Math.abs(amount).toLocaleString()}`;
}

function SettlementRow({
  transfer,
  localSeat,
  unit,
  stakePerTai,
}: {
  transfer: Transfer;
  localSeat: MahjongSeat;
  unit: "Jade" | "Practice points";
  stakePerTai?: number;
}) {
  const capped = transfer.capped || transfer.amount < transfer.raw_amount;
  return (
    <li className={`hand-result-transfer${capped ? " hand-result-transfer-capped" : ""}`}>
      <div className="hand-result-transfer-route">
        <span>{seatLabel(transfer.from, localSeat)}</span>
        <span className="hand-result-transfer-arrow" aria-hidden="true">→</span>
        <span>{seatLabel(transfer.to, localSeat)}</span>
      </div>
      <strong className="hand-result-transfer-amount">
        {transfer.amount.toLocaleString()} {unit}
      </strong>
      <p className="hand-result-transfer-formula">
        {stakePerTai
          ? `${stakePerTai.toLocaleString()} Jade per Tai × ${transfer.effective_tai} Tai = ${transfer.raw_amount.toLocaleString()} Jade`
          : `Raw payment: ${transfer.raw_amount.toLocaleString()} ${unit}`}
      </p>
      {capped && (
        <p className="hand-result-cap-note">
          Debit cap applied: {transfer.raw_amount.toLocaleString()} → {transfer.amount.toLocaleString()} {unit}
        </p>
      )}
    </li>
  );
}

function SettlementStory({
  view,
  practice,
}: {
  view: SeatView;
  practice: boolean;
}) {
  const settlement = view.settlement;
  if (!settlement) {
    return null;
  }
  const transfers = settlement.transfers ?? [];
  const unit = practice ? "Practice points" : "Jade";
  const balanced = settlement.total_credits === settlement.total_debits;

  return (
    <section className="hand-result-chapter hand-result-settlement" aria-labelledby="settlement-heading">
      <div className="hand-result-chapter-heading">
        <div>
          <p className="hand-result-kicker">Settlement</p>
          <h3 id="settlement-heading">
            {practice ? "Practice score only" : "Jade moved between players"}
          </h3>
        </div>
        <span className={`hand-result-balance-status${balanced ? " is-balanced" : ""}`}>
          {balanced ? "Balances to zero" : "Review required"}
        </span>
      </div>

      {!practice && view.jade_account && (
        <p className="hand-result-stake">
          Table stake: <strong>{view.jade_account.stake_per_tai.toLocaleString()} Jade per Tai</strong>
          <span aria-hidden="true"> · </span>
          Debit cap: <strong>{view.jade_account.debit_cap.toLocaleString()} Jade</strong>
        </p>
      )}

      {transfers.length > 0 ? (
        <ol className="hand-result-transfers">
          {transfers.map((transfer, index) => (
            <SettlementRow
              key={`${transfer.from}-${transfer.to}-${index}`}
              transfer={transfer}
              localSeat={view.seat}
              unit={unit}
              stakePerTai={practice ? undefined : view.jade_account?.stake_per_tai}
            />
          ))}
        </ol>
      ) : (
        <p className="hand-result-no-transfers">
          {practice ? "No Practice points changed." : "No Jade changed hands."}
        </p>
      )}

      <div className="hand-result-net" aria-label={`Net ${unit} changes`}>
        <p>Net change</p>
        <ul>
          {SEAT_ORDER.map((seat) => {
            const amount = settlement.net[seat] ?? 0;
            return (
              <li key={seat} className={amount > 0 ? "is-credit" : amount < 0 ? "is-debit" : ""}>
                <span>{seatLabel(seat, view.seat)}</span>
                <strong>{formatSignedAmount(amount)}</strong>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="hand-result-reconciliation">
        <span aria-hidden="true">{balanced ? "✓" : "!"}</span>
        {balanced
          ? practice
            ? `${settlement.total_debits.toLocaleString()} Practice points paid = ${settlement.total_credits.toLocaleString()} received. Nothing persists.`
            : `${settlement.total_debits.toLocaleString()} Jade paid = ${settlement.total_credits.toLocaleString()} received. No Jade was created or removed.`
          : `${settlement.total_debits.toLocaleString()} paid does not match ${settlement.total_credits.toLocaleString()} received. This settlement needs review.`}
      </p>
    </section>
  );
}

export interface HandResultScreenProps {
  view: SeatView;
  practice?: boolean;
  onPlayAgain?: () => void;
  onReturn?: () => void;
  // §10.2: the end-of-match slot where a guest is offered a full account.
  // Passed in rather than built here so this screen stays presentational and
  // knows nothing about IAM.
  accountUpgrade?: ReactNode;
}

export function HandResultScreen({
  view,
  practice = false,
  onPlayAgain,
  onReturn,
  accountUpgrade,
}: HandResultScreenProps) {
  const result = view.hand_result;
  if (!result) {
    return null;
  }
  const winners = result.winners ?? [];
  const dealer = currentDealer(view);
  const dealerTaiBonus = Math.max(
    0,
    ...(view.settlement?.transfers ?? []).map((transfer) => {
      const winner = winners.find((candidate) => candidate.seat === transfer.to);
      return winner ? transfer.effective_tai - winner.score.raw_tai : 0;
    }),
  );
  const walletSyncStatus = view.jade_account?.wallet_sync_status;
  const walletSyncError = view.jade_account?.wallet_sync_error;
  const walletStatus = walletSyncPresentation(walletSyncStatus, walletSyncError);

  return (
    <div className="hand-result-screen" role="region" aria-label="Hand result">
      <WinTypeBanner result={result} winners={winners} localSeat={view.seat} />

      {practice && (
        <p className="hand-result-practice-note">
          <strong>Practice result</strong>
          <span>No Jade, rating, or progression is changed.</span>
        </p>
      )}

      <div className="hand-result-story">
        <section className="hand-result-chapter hand-result-scoring" aria-labelledby="scoring-heading">
          <div className="hand-result-chapter-heading">
            <div>
              <p className="hand-result-kicker">Hand</p>
              <h3 id="scoring-heading">How the hand scored</h3>
            </div>
          </div>
          {winners.length === 0 ? (
            <p className="hand-result-no-winner">No winner this hand.</p>
          ) : (
            winners.map((winner) => <WinnerBreakdown key={winner.seat} winner={winner} localSeat={view.seat} />)
          )}

          {dealerTaiBonus > 0 && dealer && (
            <p className="hand-result-dealer-tai">
              <strong>Dealer Tai: +{dealerTaiBonus}</strong>
              <span>
                Applied when {seatLabel(dealer, view.seat)} is the winner or payer.
              </span>
            </p>
          )}
        </section>

        <SettlementStory view={view} practice={practice} />
      </div>

      {!practice && view.jade_settlement && (
        <div
          className="hand-result-jade"
          data-testid="jade-settlement"
          data-jade-delta={view.jade_settlement.delta}
          data-jade-before={view.jade_settlement.balance_before}
          data-jade-after={view.jade_settlement.balance_after}
          data-journal-id={view.jade_settlement.journal_id}
          data-wallet-sync-status={walletSyncStatus ?? "unknown"}
          data-wallet-sync-error={walletSyncError ?? ""}
        >
          <p className="hand-result-kicker">Your balance</p>
          <p className="hand-result-jade-delta">
            {view.jade_settlement.delta > 0
              ? `You received ${view.jade_settlement.delta.toLocaleString()} Jade`
              : view.jade_settlement.delta < 0
                ? `You paid ${Math.abs(view.jade_settlement.delta).toLocaleString()} Jade`
                : "Your Jade did not change"}
          </p>
          <div className="hand-result-balance-equation" aria-label={`Balance changed from ${view.jade_settlement.balance_before} to ${view.jade_settlement.balance_after} Jade`}>
            <span><small>Before</small>{view.jade_settlement.balance_before.toLocaleString()}</span>
            <span className="hand-result-balance-operator" aria-hidden="true">
              {view.jade_settlement.delta < 0 ? "−" : "+"}
            </span>
            <span><small>Change</small>{Math.abs(view.jade_settlement.delta).toLocaleString()}</span>
            <span className="hand-result-balance-operator" aria-hidden="true">=</span>
            <strong><small>New balance</small>{view.jade_settlement.balance_after.toLocaleString()} Jade</strong>
          </div>
          <p className="hand-result-wallet-status" role="status" aria-live="polite">
            <span aria-hidden="true">{walletStatus.icon}</span>
            {walletStatus.message}
          </p>
        </div>
      )}

      {!practice && view.jade_account && !view.jade_settlement && (
        <p className="hand-result-continuation" role="status" aria-live="polite">
          Posting Jade settlement…
        </p>
      )}

      {!practice && view.next_dealer && (
        <div className="hand-result-next">
          <p className="hand-result-kicker">Next hand</p>
          <p className="hand-result-continuation">
            {view.next_dealer.dealer_retains
              ? `${seatLabel(view.next_dealer.next_dealer, view.seat)} remains dealer · continuation ${view.next_dealer.next_continuations}`
              : `Dealer rotates to ${seatLabel(view.next_dealer.next_dealer, view.seat)}`}
          </p>
        </div>
      )}

      <p className="hand-result-match-id">
        <span>Match ID</span>
        <code>{view.match_id}</code>
      </p>

      {accountUpgrade}

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
