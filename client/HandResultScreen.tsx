// §9.7 "Results and explanation": the end-of-hand tally. Covers items
// 1-7 (winning hand/tile, decomposition, patterns, raw Tai, payout modifiers,
// settlement transfers, dealer continuation) plus item 8's XP (§12.1),
// item 9's post-match Add Friend action, and the Match ID and Practice
// replay/return slice of item 10. Rating (the rest of item 8), result-card
// image export (the rest of item 9), and human-queue Report remain deferred.
// Play Again covers both Practice and staked requeue (§P1.3 session closure).
import { useState, type ReactNode } from "react";

import { patternDisplayName, patternGuide } from "./scoring-guide";

import type {
  HandResult,
  HandWinner,
  HandXPAward,
  MahjongTile,
  MahjongSeat,
  PatternScore,
  SeatView,
  Transfer,
} from "../protocol/envelope";
import { TileFace } from "./TileFace";
import { XPAward } from "./XPAward";
import { formatNumber, getLocale, t, translateSource } from "./i18n";
import type { SeatId } from "./matchTableTypes";
import { tile, tileTypeKey, windName } from "./matchTableTypes";

const SEAT_ORDER: MahjongSeat[] = ["E", "S", "W", "N"];

function localizedPatternName(name: string): string {
  return getLocale() === "en" ? patternDisplayName(name) : translateSource(name);
}

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
        message: t("result.friendSendError"),
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
          <p className="hand-result-kicker">{t("result.players")}</p>
          <h3 id="result-friends-title">{t("result.addFriends")}</h3>
        </div>
        <span>
          {t(state.opponents.length === 1 ? "result.opponent" : "result.opponents", {
            count: state.opponents.length,
          })}
        </span>
      </div>
      <p className="result-friends-intro">{t("result.friendIntro")}</p>

      {state.status === "loading" && (
        <p className="result-friends-status" role="status" aria-live="polite">
          {t("result.checkingFriends")}
        </p>
      )}

      {state.status === "error" && (
        <div className="result-friends-error" role="alert" data-error-code={state.code}>
          <p>
            {state.message} <span className="result-friends-error-code">({state.code})</span>
          </p>
          <button type="button" className="secondary-action friend-action" onClick={onRetry}>
            {t("common.retry")}
          </button>
        </div>
      )}

      {state.status === "ready" && (
        state.opponents.length === 0 ? (
          <p className="result-friends-status">{t("result.noOpponents")}</p>
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
                        {opponent.relationship === "friend" ? t("result.friends") : t("result.requestSent")}
                      </span>
                    ) : opponent.relationship === "incoming" ? (
                      <span className="result-friend-relationship">{t("result.requestReceived")}</span>
                    ) : (
                      <button
                        type="button"
                        className="secondary-action friend-action"
                        aria-label={t("result.addFriendLabel", { player: playerLabel })}
                        disabled={sending}
                        onClick={() => void addFriend(opponent.userId)}
                      >
                        {sending ? t("result.sending") : t("result.addFriend")}
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
  const wind = translateSource(windName(seat as SeatId));
  return seat === localSeat ? t("result.youSeat", { wind }) : wind;
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

function publicTileCounts(view: SeatView): Map<string, number> {
  const counts = new Map<string, number>();
  const seenPhysicalTiles = new Set<string>();
  const add = (candidate: MahjongTile) => {
    if (seenPhysicalTiles.has(candidate.id)) return;
    seenPhysicalTiles.add(candidate.id);
    const key = tileTypeKey(candidate.id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (const discard of view.discards ?? []) add(discard.tile);
  for (const player of view.players) {
    if (player.melds) {
      for (const meld of player.melds) {
        if (!meld.concealed) {
          for (const candidate of meld.tiles ?? []) add(candidate);
        }
      }
    } else {
      for (const candidate of player.exposed ?? []) add(candidate);
    }
  }
  return counts;
}

function completedGroup(view: SeatView): string | null {
  const result = view.hand_result;
  const winningType = result?.winning_tile_id ? tileTypeKey(result.winning_tile_id) : null;
  if (!winningType) return null;
  for (const winner of result?.winners ?? []) {
    if (winner.score.shape.pair.some((candidate) => tileTypeKey(candidate.id) === winningType)) {
      return t("result.completedPair");
    }
    const meld = winner.score.shape.melds.find((candidate) =>
      candidate.tiles?.some((meldTile) => tileTypeKey(meldTile.id) === winningType),
    );
    if (meld) {
      if (meld.type === "pong") return t("result.completedPong");
      if (meld.type === "kong") return t("result.completedKong");
      return t("result.completedChow");
    }
  }
  return null;
}

function finalShapeProgress(view: SeatView): { groups: number; hasPair: boolean } {
  const counts = new Map<string, number>();
  for (const candidate of view.own_hand) {
    if (candidate.kind === "flower") continue;
    const key = `${candidate.kind}:${candidate.rank ?? candidate.id.split("-").slice(0, -1).join("-")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const keys = Array.from(counts.keys()).sort();
  const values = keys.map((key) => counts.get(key) ?? 0);
  const indexByKey = new Map(keys.map((key, index) => [key, index]));
  const memo = new Map<string, { groups: number; hasPair: boolean }>();

  const best = (left: { groups: number; hasPair: boolean }, right: { groups: number; hasPair: boolean }) =>
    right.groups > left.groups || (right.groups === left.groups && right.hasPair && !left.hasPair)
      ? right
      : left;
  const search = (remaining: number[], pairUsed: boolean): { groups: number; hasPair: boolean } => {
    const memoKey = `${pairUsed ? 1 : 0}:${remaining.join(",")}`;
    const cached = memo.get(memoKey);
    if (cached) return cached;
    const index = remaining.findIndex((count) => count > 0);
    if (index < 0) return { groups: 0, hasPair: pairUsed };

    const skipped = [...remaining];
    skipped[index] -= 1;
    let result = search(skipped, pairUsed);

    if (remaining[index] >= 3) {
      const triplet = [...remaining];
      triplet[index] -= 3;
      const next = search(triplet, pairUsed);
      result = best(result, { groups: next.groups + 1, hasPair: next.hasPair });
    }
    if (!pairUsed && remaining[index] >= 2) {
      const pair = [...remaining];
      pair[index] -= 2;
      result = best(result, search(pair, true));
    }

    const [kind, rankText] = keys[index].split(":");
    const rank = Number(rankText);
    if ((kind === "characters" || kind === "bamboo" || kind === "dots") && rank <= 7) {
      const second = indexByKey.get(`${kind}:${rank + 1}`);
      const third = indexByKey.get(`${kind}:${rank + 2}`);
      if (second !== undefined && third !== undefined && remaining[second] > 0 && remaining[third] > 0) {
        const sequence = [...remaining];
        sequence[index] -= 1;
        sequence[second] -= 1;
        sequence[third] -= 1;
        const next = search(sequence, pairUsed);
        result = best(result, { groups: next.groups + 1, hasPair: next.hasPair });
      }
    }
    memo.set(memoKey, result);
    return result;
  };

  const concealed = search(values, false);
  return {
    groups: concealed.groups + (view.own_melds?.length ?? 0),
    hasPair: concealed.hasPair,
  };
}

function ResultAnalysis({ view }: { view: SeatView }) {
  const result = view.hand_result;
  if (!result) return null;

  if (result.kind === "exhaustive_draw") {
    const rows = result.draw_analysis?.length
      ? result.draw_analysis
      : [{ seat: view.seat, tenpai: (view.waits?.length ?? 0) > 0, waits: view.waits }];
    return (
      <section className="hand-result-analysis" aria-labelledby="result-analysis-heading">
        <p className="hand-result-kicker">{t("result.review")}</p>
        <h3 id="result-analysis-heading">{t("result.drawAnalysis")}</h3>
        <p className="hand-result-analysis-lead">{t("result.drawAnalysisLead")}</p>
        <ul className="hand-result-draw-rows">
          {rows.map((row) => {
            const liveCopies = (row.waits ?? []).reduce(
              (sum, wait) => sum + wait.visible_remaining,
              0,
            );
            const localShape = row.seat === view.seat && !row.tenpai
              ? finalShapeProgress(view)
              : null;
            return (
              <li key={row.seat} className={row.tenpai ? "is-tenpai" : "is-not-tenpai"}>
                <div className="hand-result-draw-seat">
                  <strong>{seatLabel(row.seat, view.seat)}</strong>
                  <span>{row.tenpai ? t("result.tenpai") : t("result.notTenpai")}</span>
                </div>
                {row.tenpai && (row.waits?.length ?? 0) > 0 ? (
                  <div className="hand-result-draw-waits">
                    {(row.waits ?? []).map((wait) => (
                      <span key={`${row.seat}-${tileTypeKey(wait.tile.id)}`} className="hand-result-draw-wait">
                        <span className="tile tile-sm" role="img" aria-label={tile(wait.tile.id).label}>
                          <TileFace id={wait.tile.id} size="sm" />
                        </span>
                        <small>{t("result.liveCopies", { count: wait.visible_remaining })}</small>
                      </span>
                    ))}
                    <span className="hand-result-live-total">
                      {t("result.liveTotal", { count: liveCopies })}
                    </span>
                  </div>
                ) : row.tenpai ? (
                  <small>{t("result.waitsUnavailable")}</small>
                ) : localShape ? (
                  <div className="hand-result-draw-shape">
                    <small>{t("result.finalShapeProgress", {
                      groups: localShape.groups,
                      pair: t(localShape.hasPair ? "result.withPair" : "result.withoutPair"),
                    })}</small>
                    <div className="hand-result-final-tiles" aria-label={t("result.yourFinalTiles")}>
                      {view.own_hand.filter((candidate) => candidate.kind !== "flower").map((candidate) => (
                        <span key={candidate.id} className="tile tile-sm" role="img" aria-label={tile(candidate.id).label}>
                          <TileFace id={candidate.id} size="sm" />
                        </span>
                      ))}
                    </div>
                    <small>{t(localShape.hasPair ? "result.nextFocusGroups" : "result.nextFocusPair")}</small>
                  </div>
                ) : (
                  <small>{t("result.finishedNotReady")}</small>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  if (result.kind !== "discard" || result.payer !== view.seat || !result.winning_tile_id) {
    return null;
  }

  const winning = tile(result.winning_tile_id);
  const winningType = tileTypeKey(result.winning_tile_id);
  const publicCounts = publicTileCounts(view);
  const visibleBefore = Math.max(0, (publicCounts.get(winningType) ?? 0) - 1);
  const completed = completedGroup(view);
  const alternatives = Array.from(
    new Map(
      view.own_hand
        .filter((candidate) => candidate.kind !== "flower" && tileTypeKey(candidate.id) !== winningType)
        .map((candidate) => [tileTypeKey(candidate.id), candidate]),
    ).values(),
  )
    .map((candidate) => ({
      candidate,
      visible: publicCounts.get(tileTypeKey(candidate.id)) ?? 0,
    }))
    .sort((left, right) => right.visible - left.visible || left.candidate.id.localeCompare(right.candidate.id))
    .slice(0, 3);

  return (
    <section className="hand-result-analysis" aria-labelledby="result-analysis-heading">
      <p className="hand-result-kicker">{t("result.review")}</p>
      <h3 id="result-analysis-heading">{t("result.decisionAnalysis")}</h3>
      <div className="hand-result-deal-in">
        <span className="tile tile-md" role="img" aria-label={winning.label}>
          <TileFace id={winning.id} size="md" />
        </span>
        <div>
          <strong>{t("result.dealInTitle", { tile: winning.label })}</strong>
          <p>{visibleBefore === 0
            ? t("result.dealInUnseen")
            : t("result.dealInSeen", { count: visibleBefore })}</p>
          {completed ? <p>{t("result.completedGroup", { group: completed })}</p> : null}
        </div>
      </div>
      {alternatives.length > 0 ? (
        <div className="hand-result-alternatives">
          <strong>{t("result.visibilityAlternatives")}</strong>
          <div>
            {alternatives.map(({ candidate, visible }) => (
              <span key={tileTypeKey(candidate.id)} className="hand-result-alternative">
                <span className="tile tile-sm" role="img" aria-label={tile(candidate.id).label}>
                  <TileFace id={candidate.id} size="sm" />
                </span>
                <small>{t("result.publicCopies", { count: visible })}</small>
              </span>
            ))}
          </div>
          <p>{t("result.alternativesCaveat")}</p>
        </div>
      ) : null}
      <p className="hand-result-analysis-source">{t("result.publicOnlyReview")}</p>
    </section>
  );
}

function walletSyncPresentation(status: string | undefined, error: string | undefined): {
  icon: string;
  message: string;
} {
  switch (status) {
    case "synced":
      return { icon: "✓", message: t("result.walletSynced") };
    case "pending":
      return { icon: "…", message: t("result.walletQueued") };
    case "syncing":
      return { icon: "↻", message: t("result.walletSyncing") };
    case "error":
      if (error === "unauthorized" || error === "forbidden") {
        return {
          icon: "!",
          message: t("result.walletServiceAttention"),
        };
      }
      return {
        icon: "!",
        message: t("result.walletDelayed"),
      };
    default:
      return { icon: "?", message: t("result.walletUnavailable") };
  }
}

const WIN_TYPE_COPY: Record<HandResult["kind"], { chinese: string; romanized: string }> = {
  discard: { chinese: "胡", romanized: "Hu" },
  zimo: { chinese: "自摸", romanized: "Zi Mo" },
  rob: { chinese: "搶槓", romanized: "Qiang Gang" },
  eight_flowers: { chinese: "八仙過海", romanized: "Eight Flowers" },
  heavenly: { chinese: "天胡", romanized: "Tian Hu" },
  exhaustive_draw: { chinese: "流局", romanized: "Liu Ju" },
};

function winTypeEnglish(kind: HandResult["kind"]): string {
  if (kind === "zimo") return t("result.selfDraw");
  if (kind === "rob") return t("result.robbingKong");
  if (kind === "eight_flowers") return t("result.eightFlowers");
  if (kind === "heavenly") return t("result.heavenlyHand");
  if (kind === "exhaustive_draw") return t("result.exhaustiveDraw");
  return "";
}

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
  const english = winTypeEnglish(result.kind);
  const winningTile = result.winning_tile_id ? tile(result.winning_tile_id) : null;
  const winnerNames = winners.map((winner) => seatLabel(winner.seat, localSeat)).join(" & ");
  const payerName = result.payer ? seatLabel(result.payer, localSeat) : null;

  return (
    <header className={`hand-result-win-type hand-result-win-type-${result.kind}`}>
      <h2 className="hand-result-win-type-chinese" lang="zh-Hant">{copy.chinese}</h2>
      <p className="hand-result-win-type-name">
        {copy.romanized}{english ? ` · ${english}` : ""}
      </p>
      {result.kind === "discard" && payerName && winnerNames ? (
        <div className="hand-result-win-relationship" aria-label={t("result.discardRelationship", { payer: payerName, winners: winnerNames })}>
          <strong className="hand-result-payer">{payerName}</strong>
          <span className="hand-result-win-arrow">{t("result.discardedWinningTile")}</span>
          {winningTile ? (
            <span className="tile tile-md" role="img" aria-label={winningTile.label}>
              <TileFace id={winningTile.id} size="md" />
            </span>
          ) : null}
          <span className="hand-result-win-arrow">{t("result.to")}</span>
          <strong className="hand-result-recipient">{winnerNames}</strong>
        </div>
      ) : result.kind === "zimo" && winnerNames ? (
        <div className="hand-result-win-relationship hand-result-self-draw" aria-label={t("result.drewWinningTileLabel", { winners: winnerNames })}>
          <strong className="hand-result-recipient">{winnerNames}</strong>
          <span>{t("result.drewWinningTile")}</span>
        </div>
      ) : null}
      {winningTile && result.kind !== "discard" ? (
        <div className="hand-result-hero-tile">
          <span>{t("result.winningTile")}</span>
          <span className="tile tile-md" role="img" aria-label={winningTile.label}>
            <TileFace id={winningTile.id} size="md" />
          </span>
        </div>
      ) : null}
    </header>
  );
}

// One scoring line, expandable into what the pattern rewards.
//
// Inline rather than a modal or a separate glossary screen: the player is
// looking at their own hand and their own score, and that context is most of
// what makes the explanation land. Sending them elsewhere to read a definition
// loses it.
//
// A pattern with no guide renders as a plain row, exactly as before. Silence is
// the right failure: a control that opens to nothing is worse than no control.
function PatternRow({
  pattern,
  stakePerTai,
}: {
  pattern: PatternScore;
  stakePerTai?: number;
}) {
  const [open, setOpen] = useState(false);
  const guide = patternGuide(pattern.name);
  const displayName = localizedPatternName(pattern.name);
  const panelId = `pattern-${pattern.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const worth = guide && stakePerTai && stakePerTai > 0
    ? t("result.jadeWorth", { amount: formatNumber(pattern.tai * stakePerTai) })
    : null;

  if (!guide) {
    return (
      <li>
        <span>{displayName}</span>
        <strong>
          {pattern.tai} <span lang="zh-Hant">台</span>
        </strong>
      </li>
    );
  }

  return (
    <li className={open ? "hand-result-pattern is-open" : "hand-result-pattern"}>
      <button
        type="button"
        className="hand-result-pattern-toggle"
        title={t("result.whatIsThis")}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="hand-result-pattern-name">
          {displayName}
          {/* The affordance has to be visible without hover — this is a touch
              surface as much as a pointer one. */}
          <span className="hand-result-pattern-hint" aria-hidden="true">
            ?
          </span>
        </span>
        <strong>
          {pattern.tai} <span lang="zh-Hant">台</span>
          {guide.perInstance && <span className="hand-result-pattern-each"> {t("result.each")}</span>}
        </strong>
      </button>
      {open && (
        <div id={panelId} className="hand-result-pattern-detail">
          <p className="hand-result-pattern-what">{translateSource(guide.what)}</p>
          {guide.build && <p className="hand-result-pattern-build">{translateSource(guide.build)}</p>}
          {/* The upgrade is the part meant to change the next hand, so it is
              the most prominent thing in the panel rather than a footnote. */}
          {guide.upgrade && (
            <p className="hand-result-pattern-upgrade">
              <span className="hand-result-pattern-upgrade-label">{t("result.worthMore")}</span>
              <span>
                <strong>
                  {localizedPatternName(guide.upgrade.name)} · {guide.upgrade.tai} <span lang="zh-Hant">台</span>
                </strong>{" "}
                {translateSource(guide.upgrade.how)}
              </span>
            </p>
          )}
          {/* Never omitted when present. Encouraging a bigger hand without its
              price is how a player is talked into chasing one they cannot finish. */}
          {guide.cost && (
            <p className="hand-result-pattern-cost">
              <span className="hand-result-pattern-cost-label">{t("result.tradeOff")}</span>
              <span>{translateSource(guide.cost)}</span>
            </p>
          )}
          {worth && <p className="hand-result-pattern-worth">{worth}</p>}
        </div>
      )}
    </li>
  );
}

function WinnerBreakdown({
  winner,
  localSeat,
  stakePerTai,
}: {
  winner: HandWinner;
  localSeat: MahjongSeat;
  stakePerTai?: number;
}) {
  // The result should explain itself on first scan. Keep the authoritative
  // scoring patterns open by default while still allowing experienced
  // players to collapse the detail.
  const [expanded, setExpanded] = useState(true);
  return (
    <section className="hand-result-winner" aria-labelledby={`winner-${winner.seat}`}>
      <div className="hand-result-winner-header">
        <div>
          <p className="hand-result-kicker">{t("result.winningHand")}</p>
          <h4 id={`winner-${winner.seat}`} className="hand-result-winner-heading">
            {seatLabel(winner.seat, localSeat)}
          </h4>
        </div>
        <div className="hand-result-score-badge" aria-label={t("result.rawScoreLabel", { tai: winner.score.raw_tai })}>
          <span>{t("result.rawScore")}</span>
          <strong>{winner.score.raw_tai} <span lang="zh-Hant">台</span></strong>
        </div>
      </div>
      <div className="hand-result-decomposition" aria-label={t("result.decomposition")}>
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
        <span>{t("result.scoringDetails")}</span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div id={`winner-score-${winner.seat}`} className="hand-result-score-details">
          <ul className="hand-result-patterns" aria-label={t("result.scoringPatterns")}>
            {winner.score.patterns.map((pattern) => (
              <PatternRow key={pattern.name} pattern={pattern} stakePerTai={stakePerTai} />
            ))}
          </ul>
          <p className="hand-result-tai-total">
            <span>{t("result.rawSubtotal")}</span>
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
  return `${amount > 0 ? "+" : "−"}${formatNumber(Math.abs(amount))}`;
}

function settlementComponentLabel(kind: string): string {
  if (kind === "base") return t("result.paymentBase");
  if (kind === "tai") return t("result.paymentTai");
  return kind
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function SettlementRow({
  transfer,
  localSeat,
  unit,
}: {
  transfer: Transfer;
  localSeat: MahjongSeat;
  unit: string;
}) {
  const capped = transfer.capped || transfer.amount < transfer.raw_amount;
  const calculation = transfer.calculation;
  return (
    <li className={`hand-result-transfer${capped ? " hand-result-transfer-capped" : ""}`}>
      <div className="hand-result-transfer-route">
        <span>{seatLabel(transfer.from, localSeat)}</span>
        <span className="hand-result-transfer-arrow" aria-hidden="true">→</span>
        <span>{seatLabel(transfer.to, localSeat)}</span>
      </div>
      <strong className="hand-result-transfer-amount">
        {formatNumber(transfer.amount)} {unit}
      </strong>
      {calculation ? (
        <div className="hand-result-transfer-formula" data-settlement-method={calculation.method_id}>
          <ul className="hand-result-payment-components">
            {calculation.components.map((component, index) => (
              <li key={`${component.kind}-${index}`}>
                {t("result.paymentComponent", {
                  label: settlementComponentLabel(component.kind),
                  units: component.units,
                  value: formatNumber(calculation.unit_value),
                  amount: formatNumber(component.amount),
                  unit,
                })}
              </li>
            ))}
          </ul>
          <p>{t("result.paymentTotal", {
            multiplier: calculation.multiplier,
            amount: formatNumber(transfer.raw_amount),
            unit,
          })}</p>
        </div>
      ) : (
        <p className="hand-result-transfer-formula">
          {t("result.rawPayment", { amount: formatNumber(transfer.raw_amount), unit })}
        </p>
      )}
      {capped && (
        <p className="hand-result-cap-note">
          {t("result.debitCap", {
            raw: formatNumber(transfer.raw_amount),
            amount: formatNumber(transfer.amount),
            unit,
          })}
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
  const unit = practice ? t("result.practicePoints") : t("common.jade");
  const balanced = settlement.total_credits === settlement.total_debits;

  return (
    <section className="hand-result-chapter hand-result-settlement" aria-labelledby="settlement-heading">
      <div className="hand-result-chapter-heading">
        <div>
          <p className="hand-result-kicker">{t("result.settlement")}</p>
          <h3 id="settlement-heading">
            {practice ? t("result.practiceScore") : t("result.jadeMoved")}
          </h3>
        </div>
        <span className={`hand-result-balance-status${balanced ? " is-balanced" : ""}`}>
          {balanced ? t("result.balanced") : t("result.reviewRequired")}
        </span>
      </div>

      {!practice && view.jade_account && (
        <p className="hand-result-stake">
          <strong>{t("result.tableStake", { stake: formatNumber(view.jade_account.stake_per_tai) })}</strong>
          <span aria-hidden="true"> · </span>
          <strong>{t("result.debitCapValue", { cap: formatNumber(view.jade_account.debit_cap) })}</strong>
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
            />
          ))}
        </ol>
      ) : (
        <p className="hand-result-no-transfers">
          {practice ? t("result.noPracticeChange") : t("result.noJadeChange")}
        </p>
      )}

      <div className="hand-result-net" aria-label={t("result.netChangesLabel", { unit })}>
        <p>{t("result.netChange")}</p>
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
            ? t("result.practiceReconciled", {
                paid: formatNumber(settlement.total_debits),
                received: formatNumber(settlement.total_credits),
              })
            : t("result.jadeReconciled", {
                paid: formatNumber(settlement.total_debits),
                received: formatNumber(settlement.total_credits),
              })
          : t("result.unbalanced", {
              paid: formatNumber(settlement.total_debits),
              received: formatNumber(settlement.total_credits),
            })}
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
          <p className="hand-result-kicker">{t("result.milestone")}</p>
          <h3 id="result-achievements-title">
            {awards.length === 1 ? t("result.achievementUnlocked") : t("result.achievementsUnlocked")}
          </h3>
        </div>
        <span>{awards.length}</span>
      </div>
      <ul className="result-achievement-list">
        {awards.map((award, index) => {
          const component = award.components?.[0];
          const name = component?.label ? translateSource(component.label) : t("result.achievementUnlocked");
          return (
            <li
              key={award.award_id ?? component?.code ?? `${name}-${index}`}
              data-achievement-code={component?.code}
            >
              <span aria-hidden="true" className="result-achievement-mark">✓</span>
              <span>
                <strong>{name}</strong>
                <small>{t("result.completedPublic")}</small>
              </span>
              <strong className="result-achievement-xp">
                +{formatNumber(award.total ?? component?.amount ?? 0)} XP
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
  returnLabel?: string;
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
  onReportIssue?: () => void;
}

export function HandResultScreen({
  view,
  practice = false,
  onPlayAgain,
  playAgainNote,
  onReturn,
  returnLabel,
  accountUpgrade,
  resultFriends,
  onAddResultFriend,
  onRetryResultFriends,
  onReportIssue,
}: HandResultScreenProps) {
  const result = view.hand_result;
  if (!result) {
    return null;
  }
  const winners = result.winners ?? [];
  const dealer = currentDealer(view);
  const dealerMultiplierApplied = (view.settlement?.transfers ?? []).some(
    (transfer) => transfer.from === dealer || transfer.to === dealer,
  );
  const walletSyncStatus = view.jade_account?.wallet_sync_status;
  const walletSyncError = view.jade_account?.wallet_sync_error;
  const walletStatus = walletSyncPresentation(walletSyncStatus, walletSyncError);

  return (
    <div className="hand-result-screen" role="region" aria-label={t("result.screenLabel")}>
      <WinTypeBanner result={result} winners={winners} localSeat={view.seat} />

      {practice && (
        <p className="hand-result-practice-note">
          <strong>{t("result.practiceResult")}</strong>
          <span>{t("result.practiceNote")}</span>
        </p>
      )}

      <div className="hand-result-story">
        <section className="hand-result-chapter hand-result-scoring" aria-labelledby="scoring-heading">
          <div className="hand-result-chapter-heading">
            <div>
              <p className="hand-result-kicker">{t("result.hand")}</p>
              <h3 id="scoring-heading">{t("result.scoringBreakdown")} <span lang="zh-Hant">台</span> (Tai)</h3>
            </div>
          </div>
          {winners.length === 0 ? (
            <p className="hand-result-no-winner">{t("result.noWinner")}</p>
          ) : (
            winners.map((winner) => (
              <WinnerBreakdown
                key={winner.seat}
                winner={winner}
                localSeat={view.seat}
                // Practice stakes nothing, so the guide must not quote a Jade
                // value — the same guard the settlement rows already use.
                stakePerTai={practice ? undefined : view.jade_account?.stake_per_tai}
              />
            ))
          )}

          {dealerMultiplierApplied && dealer && (
            <p className="hand-result-dealer-tai">
              <strong>{t("table.dealer")}: ×2</strong>
              <span>
                {t("result.dealerMultiplierApplied", { dealer: seatLabel(dealer, view.seat) })}
              </span>
            </p>
          )}
        </section>

        <SettlementStory view={view} practice={practice} />
      </div>

      <ResultAnalysis view={view} />

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
          <p className="hand-result-kicker">{t("result.yourBalance")}</p>
          <p className="hand-result-jade-delta">
            {view.jade_settlement.delta > 0
              ? t("result.receivedJade", { amount: formatNumber(view.jade_settlement.delta) })
              : view.jade_settlement.delta < 0
                ? t("result.paidJade", { amount: formatNumber(Math.abs(view.jade_settlement.delta)) })
                : t("result.yourJadeUnchanged")}
          </p>
          <div className="hand-result-balance-equation" aria-label={t("result.balanceChangedLabel", {
            before: formatNumber(view.jade_settlement.balance_before),
            after: formatNumber(view.jade_settlement.balance_after),
          })}>
            <span><small>{t("result.before")}</small>{formatNumber(view.jade_settlement.balance_before)}</span>
            <span className="hand-result-balance-operator" aria-hidden="true">
              {view.jade_settlement.delta < 0 ? "−" : "+"}
            </span>
            <span><small>{t("result.change")}</small>{formatNumber(Math.abs(view.jade_settlement.delta))}</span>
            <span className="hand-result-balance-operator" aria-hidden="true">=</span>
            <strong><small>{t("result.newBalance")}</small>{formatNumber(view.jade_settlement.balance_after)} {t("common.jade")}</strong>
          </div>
          <p className="hand-result-wallet-status" role="status" aria-live="polite">
            <span aria-hidden="true">{walletStatus.icon}</span>
            {walletStatus.message}
          </p>
        </div>
      )}

      {!practice && view.jade_account && !view.jade_settlement && (
        <p className="hand-result-continuation" role="status" aria-live="polite">
          {t("result.postingJade")}
        </p>
      )}

      {!practice && view.next_dealer && (
        <div className="hand-result-next">
          <p className="hand-result-kicker">{t("result.nextHand")}</p>
          <p className="hand-result-continuation">
            {view.next_dealer.dealer_retains
              ? t("result.dealerRetains", {
                  dealer: seatLabel(view.next_dealer.next_dealer, view.seat),
                  count: view.next_dealer.next_continuations,
                })
              : t("result.dealerRotates", { dealer: seatLabel(view.next_dealer.next_dealer, view.seat) })}
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
        <span>{t("result.matchId")}</span>
        <code>{view.match_id}</code>
      </p>

      {accountUpgrade}

      {(onPlayAgain || onReturn || onReportIssue) && (
        <div className="hand-result-actions">
          {onPlayAgain && (
            <div className="hand-result-play-again">
              <button
                type="button"
                className="primary-action"
                onClick={onPlayAgain}
                aria-describedby={playAgainNote ? "play-again-note" : undefined}
              >
                {t("result.playAgain")}
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
              {returnLabel ?? t("result.returnLobby")}
            </button>
          )}
          {onReportIssue && (
            <button type="button" className="text-action hand-result-report" onClick={onReportIssue}>
              {t("result.reportIssues")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
