import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";

import { TileFace } from "./TileFace";
import { PlayerProfileBadge } from "./PlayerProfile";
import {
  defaultPlayerProfile,
  type PlayerProfileConfig,
} from "./player-profile";
import type { MatchAction, MatchTableState, SeatId, SeatState, WaitEntry, WireMeld, WireTile } from "./matchTableTypes";
import { tileTypeKey, windName } from "./matchTableTypes";
import { applySort, SORT_MODES, sortModeLabel, type SortMode } from "./matchTableSort";
import { isMatchingFlower } from "./flowerTai";
import { t, translateSource } from "./i18n";

// Production match table and the standalone §9.2 validation harness share this
// component. The live adapter supplies authoritative seat/action state; the
// mock harness keeps the 640x360 simultaneous-visibility contract testable
// without a running match service.

// Screen position is fixed by seat relative to the local seat, not by
// logical seat identity: the local seat is always "bottom", and the other
// three are remapped counterclockwise (bottom -> right -> top -> left)
// following turn order E->S->W->N->E (§9.2).
const REMAP_ORDER: SeatId[] = ["E", "S", "W", "N"];
type ScreenSlot = "bottom" | "right" | "top" | "left";

function remapSeats(localSeat: SeatId): Record<ScreenSlot, SeatId> {
  const localIndex = REMAP_ORDER.indexOf(localSeat);
  const at = (offset: number) => REMAP_ORDER[(localIndex + offset) % REMAP_ORDER.length];
  return { bottom: at(0), right: at(1), top: at(2), left: at(3) };
}

function Tile({
  t,
  size = "md",
  faceDown = false,
}: {
  t: WireTile;
  size?: "sm" | "md" | "lg" | "focus";
  faceDown?: boolean;
}) {
  if (faceDown) {
    return <span className={`tile tile-back tile-${size}`} aria-hidden="true" />;
  }
  return (
    <span
      className={`tile tile-${size}`}
      role="img"
      aria-label={t.label}
      title={t.label}
    >
      <TileFace id={t.id} size={size} />
    </span>
  );
}

function MeldGroup({ meld }: { meld: WireMeld }) {
  // A concealed meld belonging to another seat arrives with no tile
  // identities (server-redacted) — render face-down placeholders instead
  // of leaking nothing-to-leak but also not falsely claiming zero tiles.
  if (meld.concealed && meld.tiles.length === 0) {
    const count = meld.tileCount ?? 4;
    return (
      <span className="meld" aria-label={`concealed ${meld.type}, ${count} tiles`}>
        {Array.from({ length: count }).map((_, index) => (
          <Tile key={index} t={{ id: `${meld.id}-back-${index}`, glyph: "", label: "concealed tile" }} size="sm" faceDown />
        ))}
      </span>
    );
  }
  return (
    <span className="meld" aria-label={`${meld.concealed ? "concealed " : ""}${meld.type} of ${meld.tiles.map((item) => item.label).join(", ")}`}>
      {meld.tiles.map((item) => (
        <Tile key={item.id} t={item} size="sm" />
      ))}
    </span>
  );
}

// Flowers are free Tai sitting in plain sight, but they used to render as
// undifferentiated small tiles pushed to the edge of a seat — easy to miss
// entirely, and impossible to tell a scoring one from a decorative one. Mark
// the seat's own matching Flowers; their Tai is summarized on the result
// screen rather than competing with the live hand for space.
function BonusTiles({
  tiles,
  owner,
  seat,
}: {
  tiles: WireTile[];
  owner: "your" | "opponent";
  seat: SeatId;
}) {
  if (tiles.length === 0) {
    return null;
  }
  const local = owner === "your";
  return (
    <div
      className={`bonus-tile-area${local ? " bonus-tile-area-local" : ""}`}
      aria-label={local ? t("table.yourFlowers") : t("table.opponentFlowers")}
    >
      {tiles.map((item) => {
        const matching = isMatchingFlower(item.id, seat);
        return (
          <span
            key={item.id}
            className={`bonus-tile${matching ? " bonus-tile-matching" : ""}`}
            // The seat's own Flower is the one that actually pays, so say so
            // rather than leaving it to be inferred from the tile face.
            title={matching ? t("table.yourFlowerBonus", { tile: item.label }) : item.label}
          >
            <Tile t={item} size="sm" />
          </span>
        );
      })}
    </div>
  );
}

function DiscardGrid({
  discards,
  highlightId,
  inPlay,
  label = t("table.discards"),
}: {
  discards: WireTile[];
  highlightId?: string;
  inPlay?: boolean;
  label?: string;
}) {
  return (
    <div className="discard-grid" role="list" aria-label={label}>
      {discards.map((item) => (
        <span
          key={item.id}
          role="listitem"
          className={`discard-slot${item.id === highlightId ? " discard-slot-recent" : ""}`}
        >
          <Tile t={item} size="sm" />
        </span>
      ))}
      {inPlay && highlightId ? (
        <span className="discard-slot discard-slot-claimed" role="listitem">
          {t("table.claimWindow")}
        </span>
      ) : null}
    </div>
  );
}

// A seat with takenOver set is currently bot-controlled — either a §8.7/
// §11.1 disclosed AFK takeover, or a permanent AI Practice bot seat
// (isBot) that was never a human to begin with, for which "Auto-playing
// (disconnected)" would be a misleading label.
function TakeoverBadge({ takenOver, isBot }: { takenOver?: boolean; isBot?: boolean }) {
  if (!takenOver) {
    return null;
  }
  if (isBot) {
    return (
      <span className="takeover-badge bot-badge" title={t("table.aiSeat")} role="status">
        {t("table.bot")}
      </span>
    );
  }
  return (
    <span className="takeover-badge" title={t("table.autoPlayingTitle")} role="status">
      {t("table.autoPlaying")}
    </span>
  );
}

// §9.4 Ting/wait-list assist: every tile type that currently completes the
// local player's hand, each with its live remaining count. Zero stays visible
// rather than being removed — a structurally legal but exhausted wait is still
// information the player can act on.
function WaitPanel({ waits }: { waits: WaitEntry[] }) {
  if (waits.length === 0) {
    return null;
  }
  return (
    <div className="wait-panel" role="group" aria-label={t("table.waitsLabel")}>
      <span className="wait-label" role="presentation">
        {t("table.ready")}
      </span>
      <span className="wait-entries" role="list" aria-label={t("table.winningTiles")}>
        {waits.map((entry) => (
          <span
            key={entry.tile.id}
            role="listitem"
            className="wait-entry"
            aria-label={`${entry.tile.label}: ${
              entry.visibleRemaining > 0
                ? t("table.copiesHidden", { count: entry.visibleRemaining })
                : t("table.allCopiesVisible")
            }`}
          >
            <Tile t={entry.tile} size="sm" />
            <span className="wait-remaining">
              {entry.visibleRemaining > 0
                ? t("table.left", { count: entry.visibleRemaining })
                : t("table.allVisible")}
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

function tileLearningSignal(tile: WireTile, hand: WireTile[]): string {
  const key = tileTypeKey(tile.id);
  const copies = hand.filter((candidate) => tileTypeKey(candidate.id) === key).length;
  if (copies > 1) {
    return t("table.learningPair", { count: copies });
  }
  const [suit, rankText] = key.split("-");
  const rank = Number(rankText);
  if (["characters", "bamboo", "dots"].includes(suit) && Number.isFinite(rank)) {
    const connected = hand.some((candidate) => {
      const candidateKey = tileTypeKey(candidate.id);
      return candidateKey === `${suit}-${rank - 1}` || candidateKey === `${suit}-${rank + 1}`;
    });
    if (connected) {
      return t("table.learningConnected");
    }
  }
  return t("table.learningIsolated");
}

function LearningHud({
  state,
  selectedTile,
  enabled,
  guided,
  onEnabledChange,
}: {
  state: MatchTableState;
  selectedTile?: WireTile;
  enabled: boolean;
  guided: boolean;
  onEnabledChange?: (enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(guided);
  const localHand = state.seats[state.localSeat].hand ?? [];
  const seats = Object.values(state.seats) as SeatState[];
  const exposedStandardTiles = Array.from(
    new Map(
      seats
        .flatMap((seat) => [
          ...seat.discards,
          ...seat.melds.flatMap((meld) => meld.tiles),
        ])
        .filter((item) => !item.id.startsWith("flower-"))
        .map((item) => [item.id, item]),
    ).values(),
  );
  const visibleStandardCount = localHand.filter((item) => !item.id.startsWith("flower-")).length +
    exposedStandardTiles.length;
  const selectedPublicCount = selectedTile
    ? exposedStandardTiles.filter((item) => tileTypeKey(item.id) === tileTypeKey(selectedTile.id)).length
    : 0;
  const liveOuts = state.waits.reduce((sum, entry) => sum + entry.visibleRemaining, 0);
  const openThreats = seats.filter(
    (seat) => seat.seat !== state.localSeat && seat.melds.filter((meld) => !meld.concealed).length >= 2,
  ).length;
  const selectionSignal = selectedTile ? tileLearningSignal(selectedTile, localHand) : null;

  useEffect(() => {
    if (guided) setExpanded(true);
  }, [guided]);

  if (!enabled) {
    return (
      <aside className="expert-hud expert-hud-disabled" aria-label={t("table.expertHudDisabled")}>
        <button
          type="button"
          className="expert-hud-toggle"
          onClick={() => onEnabledChange?.(true)}
        >
          <strong>{t("table.expertHud")}</strong>
          <span>{t("table.expertShow")}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`expert-hud${expanded ? " is-expanded" : ""}`}
      aria-label={t("table.expertHud")}
    >
      <button
        type="button"
        className="expert-hud-toggle"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-label={expanded ? t("table.expertCollapse") : t("table.expertExpand")}
      >
        <strong>{t("table.expertHud")}</strong>
        <span>
          {state.waits.length > 0
            ? t("table.expertReady", { outs: liveOuts })
            : t("table.expertDeveloping")}
        </span>
        <span>{t("table.expertVisible", { count: visibleStandardCount })}</span>
        {openThreats > 0 ? <span>{t("table.expertThreats", { count: openThreats })}</span> : null}
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded ? (
        <div className="expert-hud-details">
          <p className={`expert-hud-selection${selectedPublicCount === 0 ? " is-live" : ""}`}>
            {selectedTile
              ? selectedPublicCount === 0
                ? t("table.expertTileUnseen", { tile: selectedTile.label })
                : t("table.expertTileSeen", { tile: selectedTile.label, count: selectedPublicCount })
              : t("table.expertSelectTile")}
          </p>
          {selectionSignal ? <p className="expert-hud-shape">{selectionSignal}</p> : null}
        </div>
      ) : null}
      <div className="expert-hud-footer">
        <small>{t("table.expertPublicOnly")}</small>
        {!guided && onEnabledChange ? (
          <button type="button" onClick={() => onEnabledChange(false)}>{t("table.expertHide")}</button>
        ) : null}
      </div>
    </aside>
  );
}

interface RecentAction {
  id: string;
  text: string;
}

function publicDiscardEntries(state: MatchTableState) {
  return (Object.values(state.seats) as SeatState[]).flatMap((seat) =>
    seat.discards.map((item) => ({ seat, item })),
  );
}

function publicMeldEntries(state: MatchTableState) {
  return (Object.values(state.seats) as SeatState[]).flatMap((seat) =>
    seat.melds.map((meld) => ({ seat, meld })),
  );
}

function RecentActions({ state }: { state: MatchTableState }) {
  const initialDiscard = state.lastDiscard;
  const [actions, setActions] = useState<RecentAction[]>(() =>
    initialDiscard
      ? [{
          id: `discard:${initialDiscard.tile.id}`,
          text: t("table.actionDiscarded", {
            player: initialDiscard.seat === state.localSeat
              ? t("common.you")
              : state.seats[initialDiscard.seat].displayName,
            tile: initialDiscard.tile.label,
          }),
        }]
      : [],
  );
  const initialDiscards = publicDiscardEntries(state);
  const initialMelds = publicMeldEntries(state);
  const knownDiscards = useRef(new Set(initialDiscards.map(({ item }) => item.id)));
  const knownMelds = useRef(new Set(initialMelds.map(({ meld }) => meld.id)));
  const discardSignature = initialDiscards.map(({ item }) => item.id).join(",");
  const meldSignature = initialMelds.map(({ meld }) => meld.id).join(",");

  useEffect(() => {
    const next: RecentAction[] = [];
    const currentMelds = publicMeldEntries(state);
    const currentDiscards = publicDiscardEntries(state);
    for (const { seat, meld } of currentMelds) {
      if (knownMelds.current.has(meld.id)) continue;
      next.push({
        id: `meld:${meld.id}`,
        text: t("table.actionClaimed", {
          player: seat.seat === state.localSeat ? t("common.you") : seat.displayName,
          action: translateSource(meld.type === "pong" ? "Pong" : meld.type === "kong" ? "Gang" : "Chow"),
        }),
      });
    }
    for (const { seat, item } of currentDiscards) {
      if (knownDiscards.current.has(item.id)) continue;
      next.push({
        id: `discard:${item.id}`,
        text: t("table.actionDiscarded", {
          player: seat.seat === state.localSeat ? t("common.you") : seat.displayName,
          tile: item.label,
        }),
      });
    }
    knownDiscards.current = new Set(currentDiscards.map(({ item }) => item.id));
    knownMelds.current = new Set(currentMelds.map(({ meld }) => meld.id));
    if (next.length > 0) {
      setActions((current) => {
        const refreshedIds = new Set(next.map((action) => action.id));
        return [...current.filter((action) => !refreshedIds.has(action.id)), ...next].slice(-5);
      });
    }
  }, [discardSignature, meldSignature, state]);

  return (
    <aside className="recent-actions" aria-label={t("table.recentActions")}>
      <strong>{t("table.recentActions")}</strong>
      {actions.length > 0 ? (
        <ol aria-live="polite">
          {[...actions].reverse().map((action) => <li key={action.id}>{action.text}</li>)}
        </ol>
      ) : <p>{t("table.waitingFirstAction")}</p>}
    </aside>
  );
}

function PlayerProfile({
  state,
  profile,
}: {
  state: SeatState;
  profile?: PlayerProfileConfig;
}) {
  const fallback = defaultPlayerProfile(false);
  fallback.nickname = state.displayName;
  fallback.tileSlotIds[0] = state.isBot ? "dragon-green-1" : "dragon-red-1";
  return (
    <header className="seat-header player-profile">
      <div className="seat-identity">
        <PlayerProfileBadge profile={profile ?? fallback} />
      </div>
    </header>
  );
}

function PlayerActivity({
  state,
  prevailingWind,
  message,
  messageTitle,
}: {
  state: SeatState;
  prevailingWind: SeatId;
  message?: string;
  messageTitle?: string;
}) {
  return (
    <div className="seat-activity" aria-label={t("table.playerStatus")}>
      <span className="seat-match-facts">
        <span
          className={`wind-badge${state.wind === prevailingWind ? " wind-badge-prevailing" : ""}`}
        >
          {windName(state.wind).slice(0, 1)}
        </span>
        {state.isDealer ? <span className="dealer-badge" title={t("table.dealer")}>D</span> : null}
      </span>
      <span className="seat-activity-message">
        {state.isActive ? <span className="active-badge" title={t("table.activePlayer")}>●</span> : null}
        {message ? <span className="claim-badge" title={messageTitle}>{message}</span> : null}
      </span>
      <span className="seat-activity-facts">
        {!state.isBot ? <TakeoverBadge takenOver={state.takenOver} /> : null}
      </span>
    </div>
  );
}

function OpponentSeat({
  seat,
  slot,
  state,
  prevailingWind,
  claimSource,
}: {
  seat: SeatId;
  slot: ScreenSlot;
  state: SeatState;
  prevailingWind: SeatId;
  claimSource: SeatId | null;
}) {
  return (
    <section
      className={`seat seat-${slot}${state.isActive ? " seat-active" : ""}${
        state.revealedHand ? " seat-celebrating" : ""
      }`}
      aria-label={`${windName(seat)} seat`}
    >
      <div className="seat-meta">
        <PlayerProfile state={state} />
        <PlayerActivity
          state={state}
          prevailingWind={prevailingWind}
          message={claimSource === seat ? t("table.waiting") : undefined}
          messageTitle={t("table.waitingResponses")}
        />
      </div>
      <div className="opponent-hand-backs" aria-hidden="true">
        {Array.from({ length: Math.min(state.handCount, 17) }).map((_, index) => (
          <span key={index} className="tile tile-back tile-xs" />
        ))}
      </div>
      {state.melds.length > 0 ? (
        <div className="meld-area" aria-label={t("table.exposedMelds")}>
          {state.melds.map((meld) => (
            <MeldGroup key={meld.id} meld={meld} />
          ))}
        </div>
      ) : null}
      <BonusTiles tiles={state.bonusTiles} owner="opponent" seat={state.seat} />
    </section>
  );
}

function DiscardRiver({
  seat,
  slot,
  state,
  lastDiscardTileId,
  claimSource,
}: {
  seat: SeatId;
  slot: ScreenSlot;
  state: SeatState;
  lastDiscardTileId?: string;
  claimSource: SeatId | null;
}) {
  const label =
    slot === "bottom"
      ? t("table.yourDiscardRiver")
      : t("table.opponentDiscardRiver", {
          player: state.displayName,
          wind: translateSource(windName(seat)),
        });
  return (
    <section
      className={`discard-river discard-river-${slot}${claimSource === seat ? " discard-river-claim-source" : ""}`}
      aria-label={label}
    >
      <DiscardGrid
        discards={state.discards}
        highlightId={lastDiscardTileId}
        inPlay={claimSource === seat}
        label={label}
      />
    </section>
  );
}

// §9.4/§9.9's exact timer thresholds: neutral -> amber at 3 seconds,
// amber -> red at 1 second. (Not 5s/3s — those were the E7.F5 wireframe's
// placeholder values, never reconciled against the spec's actual wording
// until E8.F3.)
const AMBER_THRESHOLD_SECONDS = 3;
const RED_THRESHOLD_SECONDS = 1;
const WALL_WARNING_TILES = 16;
const WALL_CRITICAL_TILES = 8;

function WallAndTurnCenter({ state }: { state: MatchTableState }) {
  const urgent = !state.untimed && state.countdownSeconds <= RED_THRESHOLD_SECONDS;
  const warn = !state.untimed && state.countdownSeconds <= AMBER_THRESHOLD_SECONDS && !urgent;
  const activeSeat = (Object.values(state.seats) as SeatState[]).find((s) => s.isActive)?.seat ?? state.localSeat;
  const fraction = state.countdownTotalSeconds > 0 ? state.countdownSeconds / state.countdownTotalSeconds : 0;
  const wallRemaining = state.wall.drawableRemaining;
  const wallCritical = wallRemaining <= WALL_CRITICAL_TILES;
  const wallWarning = wallRemaining <= WALL_WARNING_TILES && !wallCritical;
  const wallWarningIntensity = wallRemaining <= WALL_WARNING_TILES
    ? Math.min(1, Math.max(0, (WALL_WARNING_TILES + 1 - wallRemaining) / (WALL_WARNING_TILES + 1)))
    : 0;
  const wallWarningStyle = wallRemaining <= WALL_WARNING_TILES
    ? ({
        "--wall-warning-glow": `${4 + wallWarningIntensity * 14}px`,
        "--wall-warning-brightness": 1.05 + wallWarningIntensity * 0.55,
        animationDuration: `${1.4 - wallWarningIntensity * 0.8}s`,
      } as CSSProperties)
    : undefined;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // This is a hand clock, not a move clock. Resetting it whenever the active
  // seat changed made the label say "elapsed" while repeatedly jumping back
  // to zero during the bot cascade.
  useEffect(() => {
    setElapsedSeconds(0);
    if (!state.untimed) {
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.untimed]);

  const elapsedLabel = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;

  // §9.4: "At 3 seconds it changes from neutral to amber, announces '3
  // seconds' to assistive technology... at 1 second it changes to red and
  // repeats the non-color cue." This must fire once per threshold crossing,
  // not on every per-second re-render (which aria-live="polite" on a
  // continuously-changing label would otherwise cause). None of this
  // applies to an untimed match (§5.10 Tutorial/AI Practice) — there is no
  // deadline counting down, so no threshold is ever crossed.
  const [announcement, setAnnouncement] = useState("");
  const announcedThresholdRef = useRef<number | null>(null);
  const [wallAnnouncement, setWallAnnouncement] = useState("");
  const announcedWallThresholdRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.untimed || state.countdownSeconds > AMBER_THRESHOLD_SECONDS) {
      announcedThresholdRef.current = null;
      return;
    }
    if (state.countdownSeconds <= RED_THRESHOLD_SECONDS && announcedThresholdRef.current !== RED_THRESHOLD_SECONDS) {
      announcedThresholdRef.current = RED_THRESHOLD_SECONDS;
      setAnnouncement(t("table.oneSecond"));
    } else if (state.countdownSeconds <= AMBER_THRESHOLD_SECONDS && announcedThresholdRef.current === null) {
      announcedThresholdRef.current = AMBER_THRESHOLD_SECONDS;
      setAnnouncement(t("table.threeSeconds"));
    }
  }, [state.countdownSeconds, state.untimed]);

  useEffect(() => {
    if (wallRemaining > WALL_WARNING_TILES) {
      announcedWallThresholdRef.current = null;
      return;
    }
    if (wallRemaining <= WALL_CRITICAL_TILES && announcedWallThresholdRef.current !== WALL_CRITICAL_TILES) {
      announcedWallThresholdRef.current = WALL_CRITICAL_TILES;
      setWallAnnouncement(t("table.wallCriticalAnnouncement", { count: wallRemaining }));
    } else if (wallRemaining <= WALL_WARNING_TILES && announcedWallThresholdRef.current === null) {
      announcedWallThresholdRef.current = WALL_WARNING_TILES;
      setWallAnnouncement(t("table.wallLowAnnouncement", { count: wallRemaining }));
    }
  }, [wallRemaining]);

  return (
    <div
      className={`center-panel${activeSeat === state.localSeat ? " center-panel-your-turn" : ""}`}
      aria-label={t("table.tableStatus")}
    >
      {state.untimed ? (
        <div
          className="countdown countdown-untimed countdown-elapsed"
          role="timer"
          aria-label={t("table.secondsElapsed", { seconds: elapsedSeconds })}
        >
          <span className="countdown-elapsed-time" aria-hidden="true">{elapsedLabel}</span>
          <span className="countdown-elapsed-caption" aria-hidden="true">{t("table.elapsed")}</span>
        </div>
      ) : (
        <div
          className={`countdown${urgent ? " countdown-urgent" : warn ? " countdown-warn" : ""}`}
          role="timer"
          aria-label={t("table.secondsRemaining", { seconds: state.countdownSeconds })}
        >
          <svg viewBox="0 0 36 36" className="countdown-ring" aria-hidden="true">
            <circle cx="18" cy="18" r="15.5" className="countdown-ring-track" />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              className="countdown-ring-fill"
              style={{ strokeDasharray: `${fraction * 97.4} 97.4` }}
            />
          </svg>
          <span className="countdown-number">{state.countdownSeconds}</span>
        </div>
      )}
      <span className="sr-only" role="status" aria-live="assertive">
        {announcement}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {wallAnnouncement}
      </span>
      <div
        className={`wall-outline${wallWarning ? " wall-outline-warning" : ""}${wallCritical ? " wall-outline-critical" : ""}`}
        style={wallWarningStyle}
        aria-label={t("table.wallRemaining", {
          count: wallRemaining,
          warning: wallCritical
            ? t("table.wallCritical")
            : wallWarning
              ? t("table.wallLow")
              : "",
        })}
      >
        <span className="wall-count">{wallRemaining}</span>
        <span className="wall-count-label">{t("table.leftCaption")}</span>
      </div>
      <div className="round-status">
        <span className="round-wind">
          {t("table.round", { wind: translateSource(windName(state.prevailingWind)) })}
        </span>
        {state.continuation > 0 ? (
          <span
            className="round-continuation"
            aria-label={t("table.dealerRepeat", { count: state.continuation })}
          >
            R×{state.continuation}
          </span>
        ) : null}
      </div>
      <div
        className={`active-seat-callout${activeSeat === state.localSeat ? " active-seat-callout-you" : ""}`}
        aria-live="polite"
      >
        {activeSeat === state.localSeat
          ? t("table.yourTurn")
          : t("table.playerTurn", {
              player: state.seats[activeSeat].displayName,
              wind: translateSource(windName(activeSeat)),
            })}
      </div>
    </div>
  );
}

function CurrentTileFocus({
  state,
  canDiscard,
  discardPending,
  selectedTile,
}: {
  state: MatchTableState;
  canDiscard?: boolean;
  discardPending?: boolean;
  selectedTile?: WireTile;
}) {
  const discard = state.lastDiscard;
  const claimAvailable = state.claimSource !== null && state.legalActions.some(
    (action) => action.id.toLowerCase() !== "pass",
  );
  const selfTurnActionAvailable =
    state.claimSource === null &&
    state.legalActions.some((action) => action.id === "win-self" || action.id.startsWith("kong-"));
  const passOnly =
    state.legalActions.length === 1 &&
    state.legalActions[0]?.id.toLowerCase() === "pass";

  if (!discard) {
    return (
      <div className={`current-tile-focus current-tile-focus-empty${canDiscard ? " current-tile-focus-your-turn" : ""}`}>
        <span className="current-tile-kicker">
          {canDiscard ? t("table.yourTurn") : t("table.waiting")}
        </span>
        <strong className="current-tile-prompt">
          {discardPending
            ? t("table.discarding")
            : canDiscard && selectedTile
              ? t("table.selectAgain", { tile: selectedTile.label })
              : canDiscard
                ? t("table.selectDiscard")
                : t("table.firstDiscard")}
        </strong>
      </div>
    );
  }

  const source =
    discard.seat === state.localSeat
      ? t("common.you")
      : `${state.seats[discard.seat].displayName} · ${windName(discard.seat)}`;
  const prompt = claimAvailable
    ? t("table.chooseClaim")
    : passOnly
      ? t("table.noClaim")
      : canDiscard
        ? discardPending
          ? t("table.discarding")
          : selectedTile
            ? t("table.selectAgain", { tile: selectedTile.label })
          : selfTurnActionAvailable
            ? t("table.chooseWinGang")
            : t("table.selectDiscardTurn")
        : t("table.lastPlayed");

  return (
    <div
      className={`current-tile-focus${claimAvailable ? " current-tile-focus-claim" : ""}${canDiscard ? " current-tile-focus-your-turn" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={`${claimAvailable ? t("table.tileInPlay") : t("table.latestDiscard")}: ${discard.tile.label}, ${t("table.from", { source })}. ${prompt}`}
    >
      <span className="current-tile-kicker">
        {claimAvailable ? t("table.tileInPlay") : t("table.latestDiscard")}
      </span>
      <Tile t={discard.tile} size="focus" />
      <strong className="current-tile-name">{discard.tile.label}</strong>
      <span className="current-tile-source">{t("table.from", { source })}</span>
      <span className="current-tile-prompt">{prompt}</span>
    </div>
  );
}

function TablePlayfield({
  state,
  slots,
  canDiscard,
  discardPending,
  selectedTile,
}: {
  state: MatchTableState;
  slots: Record<ScreenSlot, SeatId>;
  canDiscard?: boolean;
  discardPending?: boolean;
  selectedTile?: WireTile;
}) {
  const lastDiscardTileId = state.lastDiscard?.tile.id;
  const revealedSeats = (Object.values(slots) as SeatId[])
    .filter((seat) => (state.seats[seat].revealedHand?.length ?? 0) > 0);
  return (
    <div className="table-playfield">
      {(["top", "left", "right", "bottom"] as const).map((slot) => {
        const seat = slots[slot];
        return (
          <DiscardRiver
            key={slot}
            seat={seat}
            slot={slot}
            state={state.seats[seat]}
            lastDiscardTileId={state.lastDiscard?.seat === seat ? lastDiscardTileId : undefined}
            claimSource={state.claimSource}
          />
        );
      })}
      <div className="table-center-cluster central-dashboard" aria-label={t("table.centralDashboard")}>
        <WallAndTurnCenter state={state} />
        <CurrentTileFocus
          state={state}
          canDiscard={canDiscard}
          discardPending={discardPending}
          selectedTile={selectedTile}
        />
      </div>
      {state.showdown && revealedSeats.length > 0 ? (
        <div className="showdown-hands" aria-label={t("result.winningReveal")}>
          {state.showdownWinningTile ? (
            <div
              className="showdown-winning-discard"
              role="group"
              aria-label={
                state.showdownWinningDiscard
                  ? t("table.winningDiscard", {
                      tile: state.showdownWinningTile.label,
                      source: state.showdownWinningDiscard.seat === state.localSeat
                        ? t("common.you").toLowerCase()
                        : `${state.seats[state.showdownWinningDiscard.seat].displayName} · ${translateSource(windName(
                            state.showdownWinningDiscard.seat,
                          ))}`,
                    })
                  : t("table.selfDrawWinningTile", { tile: state.showdownWinningTile.label })
              }
            >
              <div className="showdown-winning-discard-copy">
                {state.showdownWinType ? (
                  <span className="showdown-win-type">
                    <b lang="zh-Hant">{state.showdownWinType.chinese}</b>
                    <em>
                      {state.showdownWinType.romanized}
                      {state.showdownWinType.english
                        ? ` · ${state.showdownWinType.english}`
                        : ""}
                    </em>
                  </span>
                ) : null}
                <strong>{state.showdownWinningTile.label}</strong>
              </div>
              <Tile t={state.showdownWinningTile} size="focus" />
            </div>
          ) : null}
          {revealedSeats.map((seat) => {
              const revealedHand = state.seats[seat].revealedHand!;
              return (
                <div
                  className="showdown-hand"
                  key={seat}
                  role="group"
                  aria-label={seat === state.localSeat
                    ? t("table.yourWinningHand")
                    : t("table.opponentWinningHand", { wind: translateSource(windName(seat)) })}
                  style={{ "--reveal-tile-count": revealedHand.length } as CSSProperties}
                >
                  {revealedHand.map((item, index) => (
                    <span
                      key={item.id}
                      className="showdown-hand-tile"
                      style={{ "--reveal-index": index } as CSSProperties}
                    >
                      <Tile t={item} size="lg" />
                    </span>
                  ))}
                </div>
              );
            })}
        </div>
      ) : null}
    </div>
  );
}

function LocalSeat({
  state,
  displayedHand,
  canDiscard,
  selectedTileId,
  onActivateTile,
  discardPending,
  canDraw,
  waits,
  sortMode,
  onCycleSortMode,
  onNudgeTile,
  onReorderTile,
  drawnTileId,
  tableFxEnabled,
  onToggleTableFx,
  isClaimThinking,
  prevailingWind,
  profile,
}: {
  state: SeatState;
  displayedHand: WireTile[];
  canDiscard?: boolean;
  selectedTileId: string | null;
  onActivateTile: (tileId: string) => void;
  discardPending?: boolean;
  canDraw?: boolean;
  waits: WaitEntry[];
  sortMode: SortMode;
  onCycleSortMode: () => void;
  onNudgeTile: (tileId: string, direction: "left" | "right") => void;
  onReorderTile: (tileId: string, beforeTileId: string) => void;
  drawnTileId: string | null;
  tableFxEnabled: boolean;
  onToggleTableFx: () => void;
  isClaimThinking: boolean;
  prevailingWind: SeatId;
  profile?: PlayerProfileConfig;
}) {
  return (
    <section
      className={`seat seat-bottom local-seat${state.isActive ? " seat-active" : ""}${
        state.revealedHand ? " seat-celebrating" : ""
      }`}
      aria-label={t("table.yourSeat")}
    >
      <div className="local-seat-footer">
        <div className="seat-meta">
          <PlayerProfile state={state} profile={profile} />
          <PlayerActivity
            state={state}
            prevailingWind={prevailingWind}
            message={isClaimThinking ? t("table.thinking") : undefined}
            messageTitle={t("table.chooseResponse")}
          />
        </div>
        <div className="local-game-controls" aria-label={t("table.controls")}>
          <button
            type="button"
            className="sort-toggle-button"
            onClick={onCycleSortMode}
            aria-label={t("table.handSortControl", { mode: translateSource(sortModeLabel(sortMode)) })}
          >
            {t("table.sort", { mode: translateSource(sortModeLabel(sortMode)) })}
          </button>
          <button
            type="button"
            className={`table-fx-toggle${tableFxEnabled ? " table-fx-toggle-on" : ""}`}
            onClick={onToggleTableFx}
            aria-pressed={tableFxEnabled}
            aria-label={t("table.fxState", {
              state: tableFxEnabled ? t("table.on") : t("table.off"),
            })}
          >
            {t("table.fxVisible", {
              state: tableFxEnabled ? t("table.on") : t("table.off"),
            })}
          </button>
        </div>
      </div>
      {state.melds.length > 0 ? (
        <div className="meld-area" aria-label={t("table.yourMelds")}>
          {state.melds.map((meld) => (
            <MeldGroup key={meld.id} meld={meld} />
          ))}
        </div>
      ) : null}
      <BonusTiles tiles={state.bonusTiles} owner="your" seat={state.seat} />
      <WaitPanel waits={waits} />
      <div className="local-hand" role="group" aria-label={t("table.yourHand")}>
        {displayedHand.map((item) => {
          const drawn = drawnTileId === item.id;
          const selected = selectedTileId === item.id;
          const actionLabel = selected
            ? canDiscard
              ? t("table.selectedDiscard", { tile: item.label })
              : t("table.selected", { tile: item.label })
            : canDiscard
              ? t("table.inspectDiscard", { tile: item.label })
              : t("table.inspect", { tile: item.label });
          return (
            <button
              key={item.id}
              type="button"
              className={`local-hand-tile-wrap local-hand-tile-button${
                drawn ? " local-hand-tile-drawn" : ""
              }${selected ? " local-hand-tile-selected" : ""}`}
              aria-label={`${actionLabel}${drawn ? t("table.newlyDrawn") : ""}`}
              aria-pressed={selected}
              data-tile-id={item.id}
              disabled={discardPending}
              draggable={sortMode === "off" && !discardPending && !drawn}
              onClick={() => onActivateTile(item.id)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-mahjong-tile", item.id);
              }}
              onDragOver={(event) => {
                if (sortMode === "off") {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const draggedTileId = event.dataTransfer.getData("application/x-mahjong-tile");
                if (draggedTileId && draggedTileId !== item.id) {
                  onReorderTile(draggedTileId, item.id);
                }
              }}
              onKeyDown={(event) => {
                if (sortMode !== "off" || drawn) {
                  return;
                }
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  onNudgeTile(item.id, "left");
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  onNudgeTile(item.id, "right");
                }
              }}
            >
              <Tile t={item} size="lg" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

// §9.4 "score preview before Win": shown on the Win button itself rather
// than behind a separate panel, so it stays within the simultaneous-
// visibility requirement (§9.2) — the raw Tai total in the label, the full
// pattern breakdown as a tooltip.
function winButtonTitle(preview: NonNullable<MatchAction["preview"]>): string {
  return preview.patterns.map((p) => `${p.name} (${p.tai})`).join(", ");
}

function ClaimButtons({ actions, compact }: { actions: MatchAction[]; compact: boolean }) {
  const disabledReasonId = useId();
  const [confirmingActionId, setConfirmingActionId] = useState<string | null>(null);
  const disabledReason = actions.find((action) => action.disabledReason)?.disabledReason;
  const isConsequential = (action: MatchAction) => {
    const id = action.id.toLowerCase();
    return id === "kong" || id.startsWith("kong-") || id === "gang" || id.startsWith("gang-") ||
      id === "pong" || id.startsWith("pong-") || id === "chow" || id.startsWith("chow-");
  };
  const actionName = (action: MatchAction) => {
    const id = action.id.toLowerCase();
    if (id === "pong" || id.startsWith("pong-")) return "Pong";
    if (id === "chow" || id.startsWith("chow-")) return "Chow";
    return "Gang";
  };
  const localizedAction = (action: MatchAction) => {
    const key = action.id.toLowerCase();
    const terms: Record<string, { glyph: string; english: string }> = {
      chow: { glyph: "吃", english: "Chow" },
      pong: { glyph: "碰", english: "Pong" },
      kong: { glyph: "槓", english: "Gang" },
      gang: { glyph: "槓", english: "Gang" },
      "win-self": { glyph: "自摸", english: "Self-Draw" },
    };
    const term = Object.entries(terms).find(([prefix]) => key === prefix || key.startsWith(`${prefix}-`))?.[1];
    if (!term) {
      return <span className="action-label-single">{translateSource(action.label)}</span>;
    }
    const suffix = action.label.replace(/^(Chow|Pong|Kong|Gang)\b/i, "").trim();
    return (
      <span className="action-label-bilingual">
        <span className="action-label-zh" lang="zh-Hant">{term.glyph}{suffix ? ` ${suffix}` : ""}</span>
        <span className="action-label-en">({term.english})</span>
      </span>
    );
  };
  const confirmingAction = actions.find((action) => action.id === confirmingActionId);
  return (
    <div className="action-choice-stack">
      <div className="action-row" role="group" aria-label={t("table.legalActions")}>
        {actions.map((action) => {
          const confirming = action.id === confirmingActionId;
          const title = [action.disabledReason, action.preview ? winButtonTitle(action.preview) : undefined]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={action.id}
              type="button"
              className={`action-button action-${action.id.toLowerCase()}${
                confirming ? " action-confirming" : ""
              }`}
              onClick={() => {
                if (isConsequential(action) && !confirming) {
                  setConfirmingActionId(action.id);
                  return;
                }
                setConfirmingActionId(null);
                action.onClick?.();
              }}
              disabled={action.disabled}
              title={title || undefined}
              aria-describedby={action.disabledReason ? disabledReasonId : undefined}
              aria-label={
                confirming
                  ? t("table.confirmActionLabel", { action: actionName(action) })
                  : action.chowPreview
                    ? `${action.label}: ${action.chowPreview.tiles.map((item) => item.label).join(", ")}`
                    : undefined
              }
            >
              {confirming ? (
                <span className="action-label-single">
                  {t("table.confirmAction", { action: actionName(action) })}
                </span>
              ) : (
                localizedAction(action)
              )}
              {action.chowPreview ? (
                <span className="chow-option-preview" aria-hidden="true">
                  {action.chowPreview.tiles.map((item) => (
                    <span
                      key={item.id}
                      className={`chow-preview-tile${
                        item.id === action.chowPreview!.claimedTileId ? " chow-preview-claimed" : ""
                      }`}
                    >
                      <Tile t={item} size="sm" />
                    </span>
                  ))}
                </span>
              ) : null}
              {action.preview ? (
                <span className="action-score-preview">
                  {action.preview.rawTai} <span lang="zh-Hant">台</span> <small>(Tai)</small>
                </span>
              ) : null}
              {!compact && action.impact ? (
                <span className="claim-impact">
                  <small>{t("table.claimImpact")}</small>
                  {translateSource(action.impact)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {confirmingAction ? (
        <p className="action-explanation" role="status">
          {t("table.claimWarning", {
            action: actionName(confirmingAction),
          })}
        </p>
      ) : null}
      {disabledReason ? (
        <p className="action-explanation" id={disabledReasonId} role="status">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}

// The single, always-present "what's happening / what do I do now" zone.
// Before this, the three things a player can do (draw, discard, claim)
// lived in three unrelated corners of the screen with no prompt telling
// them which applied; this consolidates all of it into one bar at the
// bottom with plain-language guidance, so a newcomer is never left
// guessing where to look or what the game is waiting on.
function ActionBar({
  legalActions,
  canDraw,
  onDraw,
  drawPending,
  manualDrawOnly,
  compactClaims,
  autoPassClaims,
}: {
  legalActions: MatchAction[];
  canDraw?: boolean;
  onDraw?: () => void;
  drawPending?: boolean;
  manualDrawOnly?: boolean;
  compactClaims: boolean;
  autoPassClaims: boolean;
}) {
  const winningClaimAvailable = legalActions.some((action) => {
    const id = action.id.toLowerCase();
    return id === "win" || id === "hu" || id.startsWith("win-discard") || id.startsWith("hu-");
  });
  // A winning discard claim is terminal. Do not offer Chow alongside Hu:
  // choosing the lower-priority meld would strand the player in a completed
  // hand and turn a valid win into an accidental continuation.
  const availableActions = winningClaimAvailable
    ? legalActions.filter((action) => !action.id.toLowerCase().startsWith("chow"))
    : legalActions;
  const actionPriority = (action: MatchAction) => {
    const id = action.id.toLowerCase();
    if (id === "win" || id === "hu" || id.startsWith("win-") || id.startsWith("hu-")) return 0;
    if (id === "kong" || id === "gang" || id.startsWith("kong-") || id.startsWith("gang-")) return 1;
    if (id === "pong" || id.startsWith("pong-")) return 2;
    if (id === "chow" || id.startsWith("chow-")) return 3;
    if (id === "pass") return 4;
    return 5;
  };
  const orderedActions = [...availableActions].sort(
    (left, right) => actionPriority(left) - actionPriority(right),
  );
  const passOnly =
    autoPassClaims &&
    orderedActions.length === 1 &&
    orderedActions[0]?.id.toLowerCase() === "pass";
  if (orderedActions.length > 0 && !passOnly) {
    const selfTurnActions = orderedActions.some(
      (action) => action.id === "win-self" || action.id.startsWith("kong-"),
    );
    return (
      <div
        className={`action-bar ${selfTurnActions ? "action-bar-self-turn" : "action-bar-claim"}`}
        aria-label={selfTurnActions ? t("table.selfTurnActions") : t("table.respondTile")}
      >
        <ClaimButtons actions={orderedActions} compact={compactClaims} />
      </div>
    );
  }
  if (canDraw) {
    return (
      <div className="action-bar action-bar-draw">
        <p className="action-bar-prompt action-bar-hint" role="status" aria-live="polite">
          {drawPending
            ? t("table.drawing")
            : manualDrawOnly
              ? t("table.practiceFirstStep")
              : t("table.autoDraw")}
        </p>
        {/* Keep the fallback mounted while auto-draw is in flight. Removing it
            after 320 ms can detach the control underneath a pointer or touch. */}
        <button
          type="button"
          className="action-button action-pass action-draw-fallback"
          onClick={onDraw}
          disabled={drawPending}
        >
          {t("table.drawNow")}
        </button>
      </div>
    );
  }
  return null;
}

export interface MatchTableInteraction {
  canDiscard?: boolean;
  onDiscardTile?: (tileId: string) => void;
  discardPending?: boolean;
  canDraw?: boolean;
  onDraw?: () => void;
  drawPending?: boolean;
  // Tutorial-only escape hatch: live play auto-draws, while the lesson waits
  // for the player to deliberately practise the Draw now control.
  manualDrawOnly?: boolean;
}

export interface MatchTablePreferences {
  expertHud: boolean;
  autoPassClaims: boolean;
  compactClaimPrompts: boolean;
  guided?: boolean;
  onExpertHudChange?: (enabled: boolean) => void;
}

export function MatchTable({
  state,
  interaction,
  playerProfile,
  preferences,
}: {
  state: MatchTableState;
  interaction?: MatchTableInteraction;
  playerProfile?: PlayerProfileConfig;
  preferences?: MatchTablePreferences;
}) {
  const slots = remapSeats(state.localSeat);
  const local = state.seats[state.localSeat];

  const localHand = local.hand ?? [];
  const localHandIds = localHand.map((t) => t.id).join(",");
  const passOnlyAction =
    state.legalActions.length === 1 &&
    state.legalActions[0]?.id.toLowerCase() === "pass"
      ? state.legalActions[0]
      : null;
  const automaticPassKey =
    (preferences?.autoPassClaims ?? true) && passOnlyAction && state.lastDiscard
      ? `${state.lastDiscard.tile.id}:${state.claimSource ?? state.lastDiscard.seat}`
      : null;

  const [sortMode, setSortMode] = useState<SortMode>("suit-rank");
  const [handOrder, setHandOrder] = useState<string[]>(() => localHand.map((t) => t.id));
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const selectedTile = localHand.find((item) => item.id === selectedTileId);
  const [learningHudEnabled, setLearningHudEnabled] = useState(
    preferences?.expertHud ?? true,
  );
  const [drawnTileId, setDrawnTileId] = useState<string | null>(() =>
    interaction?.canDiscard ? (localHand.at(-1)?.id ?? null) : null,
  );
  const previousHandIdsRef = useRef(localHand.map((tile) => tile.id));
  const previousCanDiscardRef = useRef(Boolean(interaction?.canDiscard));
  const [tableFxEnabled, setTableFxEnabled] = useState(() => {
    try {
      return window.localStorage.getItem("mahjong-table-fx") === "on";
    } catch {
      return false;
    }
  });
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousDiscardRef = useRef(state.lastDiscard?.tile.id);
  const previousActiveSeatRef = useRef(
    (Object.values(state.seats) as SeatState[]).find((seat) => seat.isActive)?.seat,
  );
  const previousClaimCountRef = useRef(state.legalActions.length);
  const automaticPassRef = useRef<string | null>(null);

  useEffect(() => {
    setLearningHudEnabled(preferences?.expertHud ?? true);
  }, [preferences?.expertHud]);

  function setLearningHud(enabled: boolean) {
    setLearningHudEnabled(enabled);
    preferences?.onExpertHudChange?.(enabled);
  }

  function ensureAudioContext(): AudioContext | null {
    if (audioContextRef.current) {
      return audioContextRef.current;
    }
    const AudioContextConstructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      return null;
    }
    audioContextRef.current = new AudioContextConstructor();
    return audioContextRef.current;
  }

  function playFeedbackTone(frequency: number, duration = 0.055) {
    if (!tableFxEnabled) {
      return;
    }
    const context = ensureAudioContext();
    if (!context || context.state === "closed") {
      return;
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  }

  function toggleTableFx() {
    const next = !tableFxEnabled;
    setTableFxEnabled(next);
    try {
      window.localStorage.setItem("mahjong-table-fx", next ? "on" : "off");
    } catch {
      // Preference persistence is optional; the in-memory setting still works.
    }
    if (next) {
      const context = ensureAudioContext();
      void context?.resume();
      navigator.vibrate?.(12);
    }
  }

  useEffect(() => {
    return () => {
      void audioContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const currentDiscard = state.lastDiscard?.tile.id;
    if (currentDiscard && currentDiscard !== previousDiscardRef.current) {
      playFeedbackTone(290);
    }
    previousDiscardRef.current = currentDiscard;
    // Sound preference deliberately triggers this effect without replaying an
    // unchanged discard because previousDiscardRef is updated every time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastDiscard?.tile.id, tableFxEnabled]);

  useEffect(() => {
    const activeSeat = (Object.values(state.seats) as SeatState[]).find((seat) => seat.isActive)?.seat;
    if (activeSeat === state.localSeat && activeSeat !== previousActiveSeatRef.current) {
      playFeedbackTone(540, 0.08);
      if (tableFxEnabled) {
        navigator.vibrate?.([14, 30, 14]);
      }
    }
    previousActiveSeatRef.current = activeSeat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.localSeat, state.seats, tableFxEnabled]);

  useEffect(() => {
    if (state.legalActions.length > 0 && previousClaimCountRef.current === 0) {
      playFeedbackTone(680, 0.09);
      if (tableFxEnabled) {
        navigator.vibrate?.(20);
      }
    }
    previousClaimCountRef.current = state.legalActions.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.legalActions.length, tableFxEnabled]);

  useEffect(() => {
    if (
      !automaticPassKey ||
      !passOnlyAction?.onClick ||
      passOnlyAction.disabled ||
      automaticPassRef.current === automaticPassKey
    ) {
      return;
    }
    automaticPassRef.current = automaticPassKey;
    passOnlyAction.onClick();
    // The stable discard/source key, rather than the callback identity,
    // prevents adapter re-renders from submitting the same pass twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automaticPassKey, passOnlyAction?.disabled]);

  useEffect(() => {
    const nextIds = localHand.map((tile) => tile.id);
    const previousIds = new Set(previousHandIdsRef.current);
    const added = nextIds.filter((id) => !previousIds.has(id));
    if (interaction?.canDiscard && added.length === 1) {
      setDrawnTileId(added[0]);
    } else if (!interaction?.canDiscard) {
      setDrawnTileId(null);
    }
    previousHandIdsRef.current = nextIds;
  }, [interaction?.canDiscard, localHandIds]);

  useEffect(() => {
    if (interaction?.canDiscard && !previousCanDiscardRef.current) {
      // A tile inspected while another player acted must never become a
      // one-activation discard when this player's next turn begins.
      setSelectedTileId(null);
    }
    previousCanDiscardRef.current = Boolean(interaction?.canDiscard);
  }, [interaction?.canDiscard]);

  useEffect(() => {
    if (selectedTileId && !localHand.some((tile) => tile.id === selectedTileId)) {
      setSelectedTileId(null);
    }
  }, [localHandIds, selectedTileId, localHand]);

  // Reconcile the display order after deal, draw, claim, and discard. A new
  // draw is staged at the far right without disturbing the current hand.
  // Auto-sort runs only after the hand shrinks, or when sort mode changes.
  useEffect(() => {
    setHandOrder((current) => {
      const incomingIds = localHand.map((t) => t.id);
      const incomingSet = new Set(incomingIds);
      const currentSet = new Set(current);
      const kept = current.filter((id) => incomingSet.has(id));
      const added = incomingIds.filter((id) => !currentSet.has(id));
      const reconciled = [...kept, ...added];
      if (sortMode === "off") {
        return reconciled;
      }
      const removed = current.some((id) => !incomingSet.has(id));
      if (added.length > 0 && !removed) {
        return reconciled;
      }
      const byId = new Map(localHand.map((t) => [t.id, t]));
      const ordered = reconciled.map((id) => byId.get(id)).filter((t): t is WireTile => Boolean(t));
      return applySort(sortMode, ordered).map((t) => t.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localHandIds, sortMode]);

  const displayedHand = useMemo(() => {
    const byId = new Map(localHand.map((t) => [t.id, t]));
    const ordered = handOrder.map((id) => byId.get(id)).filter((t): t is WireTile => Boolean(t));
    if (!drawnTileId) {
      return ordered;
    }
    const drawn = byId.get(drawnTileId);
    return drawn ? [...ordered.filter((tile) => tile.id !== drawnTileId), drawn] : ordered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handOrder, localHandIds, drawnTileId]);

  function cycleSortMode() {
    setSortMode((current) => SORT_MODES[(SORT_MODES.indexOf(current) + 1) % SORT_MODES.length]);
  }

  function nudgeTile(tileId: string, direction: "left" | "right") {
    setHandOrder((current) => {
      const index = current.indexOf(tileId);
      const swapWith = direction === "left" ? index - 1 : index + 1;
      if (index === -1 || swapWith < 0 || swapWith >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
  }

  function reorderTile(tileId: string, beforeTileId: string) {
    if (sortMode !== "off" || tileId === drawnTileId) {
      return;
    }
    setHandOrder((current) => {
      const fromIndex = current.indexOf(tileId);
      const targetIndex = current.indexOf(beforeTileId);
      if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) {
        return current;
      }
      const next = [...current];
      next.splice(fromIndex, 1);
      const insertionIndex = next.indexOf(beforeTileId);
      next.splice(insertionIndex, 0, tileId);
      return next;
    });
  }

  function activateTile(tileId: string) {
    if (interaction?.discardPending) {
      return;
    }
    if (interaction?.canDiscard && selectedTileId === tileId) {
      setSelectedTileId(null);
      interaction.onDiscardTile?.(tileId);
      return;
    }
    setSelectedTileId(tileId);
  }

  return (
    <div className={`match-table${state.showdown ? " match-table-showdown" : ""}`} data-testid="match-table">
      <OpponentSeat
        seat={slots.top}
        slot="top"
        state={state.seats[slots.top]}
        prevailingWind={state.prevailingWind}
        claimSource={state.claimSource}
      />
      <OpponentSeat
        seat={slots.left}
        slot="left"
        state={state.seats[slots.left]}
        prevailingWind={state.prevailingWind}
        claimSource={state.claimSource}
      />
      <TablePlayfield
        state={state}
        slots={slots}
        canDiscard={interaction?.canDiscard}
        discardPending={interaction?.discardPending}
        selectedTile={selectedTile}
      />
      <OpponentSeat
        seat={slots.right}
        slot="right"
        state={state.seats[slots.right]}
        prevailingWind={state.prevailingWind}
        claimSource={state.claimSource}
      />
      <ActionBar
        legalActions={state.legalActions}
        canDraw={interaction?.canDraw}
        onDraw={interaction?.onDraw}
        drawPending={interaction?.drawPending}
        manualDrawOnly={interaction?.manualDrawOnly}
        compactClaims={preferences?.compactClaimPrompts ?? false}
        autoPassClaims={preferences?.autoPassClaims ?? true}
      />
      <LearningHud
        state={state}
        selectedTile={selectedTile}
        enabled={learningHudEnabled}
        guided={preferences?.guided ?? false}
        onEnabledChange={setLearningHud}
      />
      <RecentActions state={state} />
      <LocalSeat
        state={local}
        displayedHand={displayedHand}
        canDiscard={interaction?.canDiscard}
        selectedTileId={selectedTileId}
        onActivateTile={activateTile}
        discardPending={interaction?.discardPending}
        canDraw={interaction?.canDraw}
        waits={state.waits}
        sortMode={sortMode}
        onCycleSortMode={cycleSortMode}
        onNudgeTile={nudgeTile}
        onReorderTile={reorderTile}
        drawnTileId={drawnTileId}
        tableFxEnabled={tableFxEnabled}
        onToggleTableFx={toggleTableFx}
        isClaimThinking={state.legalActions.length > 0}
        prevailingWind={state.prevailingWind}
        profile={playerProfile}
      />
    </div>
  );
}
