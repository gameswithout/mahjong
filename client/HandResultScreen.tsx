// §9.7 "Results and explanation": the end-of-hand tally. Covers items
// 1-7 (winning hand/tile, decomposition, patterns, raw Tai, Dealer Tai,
// settlement transfers, dealer continuation) plus item 8's XP (§12.1),
// item 9's post-match Add Friend action, and the Match ID and Practice
// replay/return slice of item 10. Rating (the rest of item 8), result-card
// image export (the rest of item 9), and human-queue Report remain deferred.
// Play Again covers both Practice and staked requeue (§P1.3 session closure).
import { useState, type ReactNode } from "react";

import type {
  HandResult,
  HandWinner,
  HandXPAward,
  MahjongSeat,
  SeatView,
  Transfer,
} from "../protocol/envelope";
import { TileFace } from "./TileFace";
import { XPAward } from "./XPAward";
import type { SeatId } from "./matchTableTypes";
import { tile, windName } from "./matchTableTypes";

const SEAT_ORDER: MahjongSeat[] = ["E", "S", "W", "N"];

export interface ResultFriendOpponent {
  userId: string;
  displayName?: string;
}

export type ResultFriendRelationship = "available" | "friend" | "incoming" | "outgoing";

export interface ResultFriendOption extends ResultFriendOpponent {
  relationship: ResultFriendRelationship;
}

export type ResultFriendsState =
  | { status: "loading"; opponents: ResultFriendOpponent[] }
  | { status: "ready"; opponents: ResultFriendOption[] }
  | {
      status: "error";
      opponents: ResultFriendOpponent[];
      code: string;
      message: string;
    };

export type FriendRequestOutcome =
  | { ok: true }
  | { ok: false; code: string; message: string };

function shortPlayerId(userId: string): string {
  return userId.length <= 12 ? userId : `${userId.slice(0, 8)}…${userId.slice(-4)}`;
}

function ResultFriends({
  state,
  onAdd,
  onRetry,
}: {
  state: ResultFriendsState;
  onAdd: (userId: string) => Promise<FriendRequestOutcome>;
  onRetry: () => void;
}) {
  const [requestStates, setRequestStates] = useState<
    Record<string, "sending" | "sent" | { code: string; message: string }>
  >({});

  async function addFriend(userId: string) {
    setRequestStates((current) => ({ ...current, [userId]: "sending" }));
    let outcome: FriendRequestOutcome;
    try {
      outcome = await onAdd(userId);
    } catch {
      outcome = {
        ok: false,
        code: "unknown",
        message: "The friend request could not be sent. Please retry.",
      };
    }
    setRequestStates((current) => ({
      ...current,
      [userId]: outcome.ok ? "sent" : { code: outcome.code, message: outcome.message },
    }));
  }

  return (
    <section className="result-friends" aria-labelledby="result-friends-title">
      <div className="result-friends-heading">
        <div>
          <p className="hand-result-kicker">Players</p>
          <h3 id="result-friends-title">Add friends from this hand</h3>
        </div>
        <span>
          {state.opponents.length} {state.opponents.length === 1 ? "opponent" : "opponents"}
        </span>
      </div>
      <p className="result-friends-intro">
        Send a request while this table is still fresh. Your next match will still use a new queue.
      </p>

      {state.status === "loading" && (
        <p className="result-friends-status" role="status" aria-live="polite">
          Checking friend status…
        </p>
      )}

      {state.status === "error" && (
        <div className="result-friends-error" role="alert" data-error-code={state.code}>
          <p>
            {state.message} <span className="result-friends-error-code">({state.code})</span>
          </p>
          <button type="button" className="secondary-action friend-action" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {state.status === "ready" && (
        state.opponents.length === 0 ? (
          <p className="result-friends-status">No eligible opponents were found for this hand.</p>
        ) : (
          <ul className="result-friends-list">
            {state.opponents.map((opponent) => {
              const localState = requestStates[opponent.userId];
              const sent =
                localState === "sent" ||
                opponent.relationship === "friend" ||
                opponent.relationship === "outgoing";
              const sending = localState === "sending";
              const requestError =
                localState && typeof localState === "object" ? localState : undefined;
              const playerLabel = opponent.displayName ?? shortPlayerId(opponent.userId);
              return (
                <li key={opponent.userId} className="result-friend-row">
                  <span className="result-friend-identity">
                    <strong>{playerLabel}</strong>
                    {opponent.displayName && <small>{shortPlayerId(opponent.userId)}</small>}
                  </span>
                  <span className="result-friend-action">
                    {sent ? (
                      <span className="result-friend-relationship" role="status">
                        {opponent.relationship === "friend" ? "Friends" : "Request sent"}
                      </span>
                    ) : opponent.relationship === "incoming" ? (
                      <span className="result-friend-relationship">Request received</span>
                    ) : (
                      <button
                        type="button"
                        className="secondary-action friend-action"
                        aria-label={`Add ${playerLabel} as a friend`}
                        disabled={sending}
                        onClick={() => void addFriend(opponent.userId)}
                      >
                        {sending ? "Sending…" : "Add Friend"}
                      </button>
                    )}
                  </span>
                  {requestError && (
                    <p
                      className="result-friend-request-error"
                      role="alert"
                      data-error-code={requestError.code}
                    >
                      {requestError.message}{" "}
                      <span className="result-friends-error-code">({requestError.code})</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}
    </section>
  );
}

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
        <div className="hand-result-score-badge" aria-label={`${winner.score.raw_tai} raw 台`}>
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
        <span>Scoring details</span>
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
            <span>Raw subtotal</span>
            <strong>{winner.score.raw_tai} <span lang="zh-Hant">台</span></strong>
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
          ? `${stakePerTai.toLocaleString()} Jade per 台 × ${transfer.effective_tai} 台 = ${transfer.raw_amount.toLocaleString()} Jade`
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
          Table stake: <strong>{view.jade_account.stake_per_tai.toLocaleString()} Jade per 台</strong>
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
            ? `${settlement.total_debits.toLocaleString()} Practice points paid = ${settlement.total_credits.toLocaleString()} received. Practice points do not persist.`
            : `${settlement.total_debits.toLocaleString()} Jade paid = ${settlement.total_credits.toLocaleString()} received. No Jade was created or removed.`
          : `${settlement.total_debits.toLocaleString()} paid does not match ${settlement.total_credits.toLocaleString()} received. This settlement needs review.`}
      </p>
    </section>
  );
}

function AchievementUnlocks({ awards }: { awards: HandXPAward[] }) {
  return (
    <section
      className="result-achievements"
      aria-labelledby="result-achievements-title"
      role="status"
      aria-live="polite"
    >
      <div className="result-achievements-heading">
        <div>
          <p className="hand-result-kicker">Milestone reached</p>
          <h3 id="result-achievements-title">
            {awards.length === 1 ? "Achievement unlocked" : "Achievements unlocked"}
          </h3>
        </div>
        <span>{awards.length}</span>
      </div>
      <ul className="result-achievement-list">
        {awards.map((award, index) => {
          const component = award.components?.[0];
          const name = component?.label ?? "Achievement unlocked";
          return (
            <li
              key={award.award_id ?? component?.code ?? `${name}-${index}`}
              data-achievement-code={component?.code}
            >
              <span aria-hidden="true" className="result-achievement-mark">✓</span>
              <span>
                <strong>{name}</strong>
                <small>Completed on this public hand</small>
              </span>
              <strong className="result-achievement-xp">
                +{(award.total ?? component?.amount ?? 0).toLocaleString()} XP
              </strong>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface HandResultScreenProps {
  view: SeatView;
  practice?: boolean;
  onPlayAgain?: () => void;
  // Play Again means something different per mode: Practice deals a new wall
  // for free, while a staked table queues for a new seat and commits Jade. The
  // note carries that difference so the stake is stated before the click, not
  // discovered after it.
  playAgainNote?: string;
  onReturn?: () => void;
  // §10.2: the end-of-match slot where a guest is offered a full account.
  // Passed in rather than built here so this screen stays presentational and
  // knows nothing about IAM.
  accountUpgrade?: ReactNode;
  // §10.6 / P4.3. The caller owns eligibility and AGS state because it knows
  // whether this was public matchmaking and whether the current identity is
  // a full account. This screen owns only the result-time interaction.
  resultFriends?: ResultFriendsState;
  onAddResultFriend?: (userId: string) => Promise<FriendRequestOutcome>;
  onRetryResultFriends?: () => void;
}

export function HandResultScreen({
  view,
  practice = false,
  onPlayAgain,
  playAgainNote,
  onReturn,
  accountUpgrade,
  resultFriends,
  onAddResultFriend,
  onRetryResultFriends,
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
          <span>No Jade or rating changed. Completed hands still earn capped XP.</span>
        </p>
      )}

      <div className="hand-result-story">
        <section className="hand-result-chapter hand-result-scoring" aria-labelledby="scoring-heading">
          <div className="hand-result-chapter-heading">
            <div>
              <p className="hand-result-kicker">Hand</p>
              <h3 id="scoring-heading">Scoring Breakdown <span lang="zh-Hant">台</span> (Tai)</h3>
            </div>
          </div>
          {winners.length === 0 ? (
            <p className="hand-result-no-winner">No winner this hand.</p>
          ) : (
            winners.map((winner) => <WinnerBreakdown key={winner.seat} winner={winner} localSeat={view.seat} />)
          )}

          {dealerTaiBonus > 0 && dealer && (
            <p className="hand-result-dealer-tai">
              <strong>Dealer <span lang="zh-Hant">台</span>: +{dealerTaiBonus}</strong>
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

      {!practice && (view.achievements?.length ?? 0) > 0 && (
        <AchievementUnlocks awards={view.achievements ?? []} />
      )}

      {/* §12.1 XP sits after the settlement explanation and before the Match
          ID: progress is a reward for reading the result, not a replacement
          for it. Practice earns capped participation XP, so this renders in
          both modes — unlike Jade, which Practice never touches. */}
      <XPAward award={view.xp_award} progression={view.progression} />

      {!practice && resultFriends && onAddResultFriend && onRetryResultFriends && (
        <ResultFriends
          state={resultFriends}
          onAdd={onAddResultFriend}
          onRetry={onRetryResultFriends}
        />
      )}

      <p className="hand-result-match-id">
        <span>Match ID</span>
        <code>{view.match_id}</code>
      </p>

      {accountUpgrade}

      {(onPlayAgain || onReturn) && (
        <div className="hand-result-actions">
          {onPlayAgain && (
            <div className="hand-result-play-again">
              <button
                type="button"
                className="primary-action"
                onClick={onPlayAgain}
                aria-describedby={playAgainNote ? "play-again-note" : undefined}
              >
                Play Again
              </button>
              {playAgainNote && (
                <p className="hand-result-play-again-note" id="play-again-note">
                  {playAgainNote}
                </p>
              )}
            </div>
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
