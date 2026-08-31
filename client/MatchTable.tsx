import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";

import { TileFace } from "./TileFace";
import { botBadgeLabel } from "./bot-persona";
import { PlayerProfileBadge } from "./PlayerProfile";
import {
  defaultPlayerProfile,
  type PlayerProfileConfig,
} from "./player-profile";
import type { MatchAction, MatchTableState, SeatId, SeatState, WaitEntry, WireMeld, WireTile } from "./matchTableTypes";
import { tileTypeKey, windName } from "./matchTableTypes";
import { applySort, type SortMode } from "./matchTableSort";
import { AUTO_PASS_DELAYS, autoPassDelayMs, type AutoPassDelay } from "./settings";
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

function actionPriority(action: MatchAction): number {
  const id = action.id.toLowerCase();
  if (id === "win" || id === "hu" || id.startsWith("win-") || id.startsWith("hu-")) return 0;
  if (id === "kong" || id === "gang" || id === "kang" || id.startsWith("kong-") || id.startsWith("gang-") || id.startsWith("kang-")) return 1;
  if (id === "pong" || id.startsWith("pong-")) return 2;
  if (id === "chow" || id === "chi" || id.startsWith("chow-") || id.startsWith("chi-")) return 3;
  if (id === "pass") return 4;
  return 5;
}

function prepareLegalActions(actions: MatchAction[]): MatchAction[] {
  const winningClaimAvailable = actions.some((action) => actionPriority(action) === 0);
  return actions
    .filter((action) => !winningClaimAvailable || actionPriority(action) !== 3)
    .sort((left, right) => actionPriority(left) - actionPriority(right));
}

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
//
// An AI Practice bot also plays a named style, and styleTag is that style's
// plain-language label. It rides on the "Bot" badge rather than replacing
// it: §11 requires a bot to stay visibly a bot, so the badge always says so
// and the style is shown alongside.
function TakeoverBadge({
  takenOver,
  isBot,
  styleTag,
}: {
  takenOver?: boolean;
  isBot?: boolean;
  styleTag?: string;
}) {
  if (!takenOver) {
    return null;
  }
  if (isBot) {
    return (
      <span
        className="takeover-badge bot-badge"
        title={styleTag ? t("table.aiSeatStyled", { style: styleTag }) : t("table.aiSeat")}
        role="status"
      >
        {botBadgeLabel(styleTag)}
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

function RecentActions({ state, essential = false }: { state: MatchTableState; essential?: boolean }) {
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
    <aside className={essential ? "essential-side-panel essential-actions-feed" : "recent-actions"} aria-label={essential ? "Actions Feed" : t("table.recentActions")}>
      <strong>{essential ? "Actions Feed" : t("table.recentActions")}</strong>
      {actions.length > 0 ? (
        <ol aria-live="polite">
          {[...actions].reverse().map((action) => <li key={action.id}>{action.text}</li>)}
        </ol>
      ) : <p>{t("table.waitingFirstAction")}</p>}
    </aside>
  );
}

function GuideLog({ actions }: { actions: MatchAction[] }) {
  const explanations = actions.flatMap((action) => {
    const detail = action.impact || action.disabledReason;
    return detail ? [{ id: `${action.id}:${detail}`, text: `${action.label} — ${translateSource(detail)}` }] : [];
  });
  const [entries, setEntries] = useState(explanations);
  const signature = explanations.map((entry) => entry.id).join("|");

  useEffect(() => {
    if (explanations.length === 0) return;
    setEntries((current) => {
      const known = new Set(current.map((entry) => entry.id));
      return [...current, ...explanations.filter((entry) => !known.has(entry.id))].slice(-5);
    });
    // `signature` represents the complete explanation payload for this turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <aside className="essential-side-panel essential-guide" aria-label="Guide">
      <strong>Guide</strong>
      {entries.length > 0 ? (
        <ol aria-live="polite">{[...entries].reverse().map((entry) => <li key={entry.id}>{entry.text}</li>)}</ol>
      ) : <p>Explanations will appear as decisions become available.</p>}
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
        <TakeoverBadge
          takenOver={state.takenOver}
          isBot={state.isBot}
          styleTag={state.botStyleTag}
        />
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

  // Untimed play still needs a per-move clock so the elapsed value describes
  // the player currently highlighted by the turn indicator.
  useEffect(() => {
    setElapsedSeconds(0);
  }, [state.untimed, activeSeat]);

  useEffect(() => {
    if (!state.untimed || state.showdown) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.untimed, state.showdown, activeSeat]);

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
  passAutomatically,
}: {
  state: MatchTableState;
  canDiscard?: boolean;
  discardPending?: boolean;
  selectedTile?: WireTile;
  passAutomatically: boolean;
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
      ? passAutomatically
        ? t("table.noClaim")
        : t("table.passRequired")
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
  passAutomatically,
}: {
  state: MatchTableState;
  slots: Record<ScreenSlot, SeatId>;
  canDiscard?: boolean;
  discardPending?: boolean;
  selectedTile?: WireTile;
  passAutomatically: boolean;
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
          passAutomatically={passAutomatically}
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
      {state.showdown && state.showdownDraw ? (
        <div className="showdown-draw-declaration" role="status" aria-label={t("result.exhaustiveDraw")}>
          <strong lang="zh-Hant">流局</strong>
          <span>Liu Ju</span>
          <b>{t("result.exhaustiveDraw")}</b>
        </div>
      ) : null}
    </div>
  );
}

// "Off" is a word; the rest are already their own labels. Kept out of the
// message catalog because "3s" is the same string in every locale we ship.
function autoPassDelayLabel(delay: AutoPassDelay): string {
  return delay === "off" ? t("table.off") : delay;
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
  drawnTileId,
  tableFxEnabled,
  onToggleTableFx,
  claimImpactEnabled,
  onToggleClaimImpact,
  autoPassDelay,
  onCycleAutoPassDelay,
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
  drawnTileId: string | null;
  tableFxEnabled: boolean;
  onToggleTableFx: () => void;
  claimImpactEnabled: boolean;
  onToggleClaimImpact: () => void;
  autoPassDelay: AutoPassDelay;
  onCycleAutoPassDelay: () => void;
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
            className={`sort-toggle-button${claimImpactEnabled ? " sort-toggle-button-on" : ""}`}
            onClick={onToggleClaimImpact}
            aria-pressed={claimImpactEnabled}
            aria-label={t("table.impactControl", {
              state: claimImpactEnabled ? t("table.on") : t("table.off"),
            })}
          >
            {t("table.impact", {
              state: claimImpactEnabled ? t("table.on") : t("table.off"),
            })}
          </button>
          <button
            type="button"
            className={`sort-toggle-button${autoPassDelay !== "off" ? " sort-toggle-button-on" : ""}`}
            onClick={onCycleAutoPassDelay}
            aria-label={t("table.autoPassControl", { value: autoPassDelayLabel(autoPassDelay) })}
          >
            {t("table.autoPass", { value: autoPassDelayLabel(autoPassDelay) })}
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
              onClick={() => onActivateTile(item.id)}
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

function ClaimButtons({ actions, showImpact }: { actions: MatchAction[]; showImpact: boolean }) {
  const disabledReasonId = useId();
  const [confirmingActionId, setConfirmingActionId] = useState<string | null>(null);
  const disabledReason = actions.find((action) => action.disabledReason)?.disabledReason;
  const isConsequential = (action: MatchAction) => {
    const id = action.id.toLowerCase();
    return id === "kong" || id.startsWith("kong-") || id === "gang" || id.startsWith("gang-") || id === "kang" || id.startsWith("kang-") ||
      id === "pong" || id.startsWith("pong-") || id === "chow" || id.startsWith("chow-") || id === "chi" || id.startsWith("chi-");
  };
  const actionName = (action: MatchAction) => {
    const id = action.id.toLowerCase();
    if (id === "pong" || id.startsWith("pong-")) return "Pong";
    if (id === "chow" || id.startsWith("chow-") || id === "chi" || id.startsWith("chi-")) return "Chi";
    return "Gang";
  };
  const localizedAction = (action: MatchAction) => {
    const key = action.id.toLowerCase();
    const terms: Record<string, { glyph: string; english: string }> = {
      chow: { glyph: "吃", english: "Chow" },
      chi: { glyph: "吃", english: "Chi" },
      pong: { glyph: "碰", english: "Pong" },
      kong: { glyph: "槓", english: "Gang" },
      gang: { glyph: "槓", english: "Gang" },
      kang: { glyph: "槓", english: "Kang" },
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
                  : action.claimPreview
                    ? `${action.label}: ${action.claimPreview.tiles.map((item) => item.label).join(", ")}`
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
              {action.claimPreview ? (
                <span className="chow-option-preview" aria-hidden="true">
                  {action.claimPreview.tiles.map((item) => (
                    <span
                      key={item.id}
                      className={`chow-preview-tile${
                        item.id === action.claimPreview!.claimedTileId ? " chow-preview-claimed" : ""
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
              {showImpact && action.impact ? (
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
  showClaimImpact,
  showPassOnly,
}: {
  legalActions: MatchAction[];
  canDraw?: boolean;
  onDraw?: () => void;
  drawPending?: boolean;
  manualDrawOnly?: boolean;
  showClaimImpact: boolean;
  showPassOnly: boolean;
}) {
  const orderedActions = prepareLegalActions(legalActions);
  const passOnly =
    orderedActions.length === 1 &&
    orderedActions[0]?.id.toLowerCase() === "pass";
  if (orderedActions.length > 0 && (!passOnly || showPassOnly)) {
    const selfTurnActions = orderedActions.some(
      (action) => action.id === "win-self" || action.id.startsWith("kong-"),
    );
    return (
      <div
        className={`action-bar ${selfTurnActions ? "action-bar-self-turn" : "action-bar-claim"}`}
        aria-label={selfTurnActions ? t("table.selfTurnActions") : t("table.respondTile")}
      >
        <ClaimButtons actions={orderedActions} showImpact={showClaimImpact} />
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
  autoPassDelay: AutoPassDelay;
  claimImpactAnalysis: boolean;
  showGuide?: boolean;
  showActionsFeed?: boolean;
  guided?: boolean;
  experimentalTableUi?: boolean;
  tableLayoutOutlines?: boolean;
  handSortMode?: SortMode;
  tableFxEnabled?: boolean;
  onExpertHudChange?: (enabled: boolean) => void;
  // The table owns these two while a hand is live, because they are pacing
  // and verbosity controls a player reaches for mid-hand rather than in a
  // settings screen. The callbacks let the surrounding app persist what they
  // chose; without them the choice still applies to this table.
  onClaimImpactChange?: (enabled: boolean) => void;
  onAutoPassDelayChange?: (delay: AutoPassDelay) => void;
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
  const passAction = state.legalActions.find(
    (action) => action.id.toLowerCase() === "pass",
  ) ?? null;
  const meaningfulClaimActions = state.legalActions.filter(
    (action) => action.id.toLowerCase() !== "pass",
  );
  const hasAvailableClaim = meaningfulClaimActions.some((action) => !action.disabled);
  const currentActiveSeat = (Object.values(state.seats) as SeatState[]).find(
    (seat) => seat.isActive,
  )?.seat ?? state.localSeat;
  const [sortMode, setSortMode] = useState<SortMode>(preferences?.handSortMode ?? "suit-rank");
  const [handOrder, setHandOrder] = useState<string[]>(() => localHand.map((t) => t.id));
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const selectedTile = localHand.find((item) => item.id === selectedTileId);
  const [learningHudEnabled, setLearningHudEnabled] = useState(
    preferences?.expertHud ?? true,
  );
  // Mirrored rather than read straight from preferences so the footer buttons
  // respond on the click instead of waiting for a Cloud Save round trip.
  const [claimImpactEnabled, setClaimImpactEnabled] = useState(
    preferences?.claimImpactAnalysis ?? false,
  );
  const [autoPassDelay, setAutoPassDelay] = useState<AutoPassDelay>(
    preferences?.autoPassDelay ?? "1s",
  );
  const automaticPassKey =
    passAction && state.lastDiscard && autoPassDelay !== "off" && !hasAvailableClaim
      ? `${state.lastDiscard.tile.id}:${state.claimSource ?? state.lastDiscard.seat}`
      : null;
  const [drawnTileId, setDrawnTileId] = useState<string | null>(() =>
    interaction?.canDiscard ? (localHand.at(-1)?.id ?? null) : null,
  );
  const previousHandIdsRef = useRef(localHand.map((tile) => tile.id));
  const previousCanDiscardRef = useRef(Boolean(interaction?.canDiscard));
  const [tableFxEnabled, setTableFxEnabled] = useState(() => {
    if (preferences?.tableFxEnabled !== undefined) return preferences.tableFxEnabled;
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
  const [essentialElapsedSeconds, setEssentialElapsedSeconds] = useState(0);
  const [autoPassRemainingMs, setAutoPassRemainingMs] = useState<number | null>(null);
  const [essentialConfirmingActionId, setEssentialConfirmingActionId] = useState<string | null>(null);
  const essentialActionSignature = state.legalActions.map((action) => action.id).join("|");

  useEffect(() => {
    setEssentialConfirmingActionId(null);
  }, [essentialActionSignature, state.lastDiscard?.tile.id]);

  useEffect(() => {
    setClaimImpactEnabled(preferences?.claimImpactAnalysis ?? false);
  }, [preferences?.claimImpactAnalysis]);

  useEffect(() => {
    setAutoPassDelay(preferences?.autoPassDelay ?? "1s");
  }, [preferences?.autoPassDelay]);

  useEffect(() => {
    setLearningHudEnabled(preferences?.expertHud ?? true);
  }, [preferences?.expertHud]);

  useEffect(() => setSortMode(preferences?.handSortMode ?? "suit-rank"), [preferences?.handSortMode]);
  useEffect(() => {
    if (preferences?.tableFxEnabled !== undefined) setTableFxEnabled(preferences.tableFxEnabled);
  }, [preferences?.tableFxEnabled]);

  useEffect(() => {
    setEssentialElapsedSeconds(0);
  }, [preferences?.experimentalTableUi, state.untimed, currentActiveSeat]);

  useEffect(() => {
    if (!preferences?.experimentalTableUi || !state.untimed || state.showdown) return;
    const timer = window.setInterval(() => {
      setEssentialElapsedSeconds((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [preferences?.experimentalTableUi, state.untimed, state.showdown, currentActiveSeat]);

  useEffect(() => {
    if (!automaticPassKey) {
      setAutoPassRemainingMs(null);
      return;
    }
    const delay = autoPassDelayMs(autoPassDelay);
    const deadline = Date.now() + delay;
    setAutoPassRemainingMs(delay);
    const timer = window.setInterval(() => {
      setAutoPassRemainingMs(Math.max(0, deadline - Date.now()));
    }, 100);
    return () => window.clearInterval(timer);
  }, [automaticPassKey, autoPassDelay]);

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
      !passAction?.onClick ||
      passAction.disabled ||
      automaticPassRef.current === automaticPassKey
    ) {
      return;
    }
    const submit = passAction.onClick;
    // The key is claimed before the timer fires, not inside it: a re-render
    // during the wait must not schedule a second pass for the same discard.
    automaticPassRef.current = automaticPassKey;
    const timer = window.setTimeout(submit, autoPassDelayMs(autoPassDelay));
    // The wait is the whole feature — it is the window in which the player
    // reads the discard — so it has to survive a re-render and be cancelled
    // if the table moves on first.
    return () => window.clearTimeout(timer);
    // The stable discard/source key, rather than the callback identity,
    // prevents adapter re-renders from submitting the same pass twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automaticPassKey, passAction?.disabled, autoPassDelay]);

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

  // Both write through to the app so the choice sticks past this hand, and
  // both apply locally first so the button responds even when nothing is
  // listening (the wireframe harness, or a guided practice hand).
  function toggleClaimImpact() {
    const next = !claimImpactEnabled;
    setClaimImpactEnabled(next);
    preferences?.onClaimImpactChange?.(next);
  }

  function cycleAutoPassDelay() {
    const next =
      AUTO_PASS_DELAYS[(AUTO_PASS_DELAYS.indexOf(autoPassDelay) + 1) % AUTO_PASS_DELAYS.length];
    setAutoPassDelay(next);
    preferences?.onAutoPassDelayChange?.(next);
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

  if (preferences?.experimentalTableUi) {
    const activeSeat = currentActiveSeat;
    const visibleClaimSource = state.showdown ? null : state.claimSource;
    const outlineClass = preferences.tableLayoutOutlines ? " essential-table--outlines" : "";
    const essentialTimer = state.untimed
      ? `${Math.floor(essentialElapsedSeconds / 60)}:${String(essentialElapsedSeconds % 60).padStart(2, "0")}`
      : String(state.countdownSeconds);
    const opponentSlots: Array<{ seatId: SeatId; slot: "top" | "left" | "right" }> = [
      { seatId: slots.top, slot: "top" },
      { seatId: slots.left, slot: "left" },
      { seatId: slots.right, slot: "right" },
    ];
    const compassSeats: Array<{ seatId: SeatId; position: "top" | "right" | "bottom" | "left" }> = [
      { seatId: slots.top, position: "top" },
      { seatId: slots.right, position: "right" },
      { seatId: state.localSeat, position: "bottom" },
      { seatId: slots.left, position: "left" },
    ];
    const essentialActions = state.showdown ? [] : prepareLegalActions(state.legalActions);
    const reviewTemporaryUi = preferences.tableLayoutOutlines === true;
    const hasManualDrawAction = Boolean(interaction?.canDraw);
    const showWinDeclaration = Boolean(state.showdown && (state.showdownWinningTile || state.showdownDraw));
    const wallUrgency = state.wall.drawableRemaining <= WALL_CRITICAL_TILES
      ? "critical"
      : state.wall.drawableRemaining <= WALL_WARNING_TILES
        ? "warning"
        : null;
    const showdownWinner = (Object.values(state.seats) as SeatState[]).find(
      (seat) => (seat.revealedHand?.length ?? 0) > 0,
    );
    const showdownWinners = (Object.values(state.seats) as SeatState[]).filter(
      (seat) => (seat.revealedHand?.length ?? 0) > 0,
    );
    const drawnTile = drawnTileId
      ? displayedHand.find((tile) => tile.id === drawnTileId) ?? null
      : null;
    const settledHand = drawnTile
      ? displayedHand.filter((tile) => tile.id !== drawnTile.id)
      : displayedHand;
    const renderEssentialHandTile = (tile: WireTile) => (
      <button
        type="button"
        className={selectedTileId === tile.id ? "is-selected" : ""}
        key={tile.id}
        onClick={() => activateTile(tile.id)}
        disabled={interaction?.discardPending}
        aria-pressed={selectedTileId === tile.id}
        aria-label={`${selectedTileId === tile.id ? "Selected" : "Inspect"} ${tile.label}${tile.id === drawnTileId ? ", newly drawn" : ""}`}
      >
        <Tile t={tile} size="lg" />
      </button>
    );
    return (
      <div className={`essential-table${preferences.showGuide || preferences.showActionsFeed ? " essential-table--side-panels" : ""}${outlineClass}`} data-testid="essential-match-table">
        <section className="essential-opponents" aria-label="Opponents">
          {opponentSlots.map(({ seatId, slot }) => {
            const seat = state.seats[seatId];
            return <article className={`essential-opponent essential-opponent--${slot}${visibleClaimSource === seatId ? " is-claim-source" : ""}`} key={seatId}>
              <div className="essential-profile-row">
                <div className="essential-seat-status"><strong>{seat.wind}</strong>{seat.isDealer ? <span>Dealer</span> : null}</div>
                <div className="essential-profile">
                  <PlayerProfileBadge profile={{ ...defaultPlayerProfile(false), nickname: seat.displayName }} />
                  <span className="essential-player-flags">
                    {seat.wind === state.prevailingWind ? <small>Prevailing</small> : null}
                    <TakeoverBadge takenOver={seat.takenOver} isBot={seat.isBot} styleTag={seat.botStyleTag} />
                    {visibleClaimSource === seatId ? <small>Response pending</small> : null}
                  </span>
                </div>
              </div>
              <div className="essential-concealed" aria-label={`${seat.handCount} concealed tiles`}>{Array.from({ length: seat.handCount }, (_, index) => <span className="essential-tile-back" key={index} />)}</div>
              <div className="essential-exposed">{seat.melds.flatMap((meld) => meld.tiles).map((tile) => <Tile key={tile.id} t={tile} size="sm" />)}{seat.bonusTiles.map((tile) => <Tile key={tile.id} t={tile} size="sm" />)}</div>
            </article>;
          })}
        </section>
        <div className={`essential-discard-stage${showWinDeclaration ? " has-win-declaration" : ""}`}>
          <section className="essential-discards" aria-label="Discard pile">
            {(["N", "W", "S", "E"] as SeatId[]).map((seatId) => <div className={`essential-discard-row${visibleClaimSource === seatId ? " is-claim-source" : ""}`} key={seatId}><b>{seatId}</b><div>{state.seats[seatId].discards.map((tile, index, discards) => <span className={visibleClaimSource === seatId && index === discards.length - 1 ? "is-claim-tile" : undefined} key={tile.id}><Tile t={tile} size="sm" /></span>)}</div></div>)}
          </section>
          {showWinDeclaration ? (
            <section
              className="essential-win-declaration"
              aria-label={state.showdownDraw ? t("result.exhaustiveDraw") : "Winning declaration"}
            >
              {state.showdownDraw ? (
                <div className="essential-win-copy essential-draw-copy">
                  <strong lang="zh-Hant">流局</strong>
                  <span>Liu Ju</span>
                  <b>{t("result.exhaustiveDraw")}</b>
                </div>
              ) : (
                <>
                  <div className="essential-win-copy">
                    <strong lang="zh-Hant">{state.showdownWinType?.chinese ?? "胡"}</strong>
                    <span>{state.showdownWinType?.romanized ?? "Hu"}{state.showdownWinType?.english ? ` · ${state.showdownWinType.english}` : ""}</span>
                    {showdownWinner ? <b>{showdownWinner.seat === state.localSeat ? "You win" : `${showdownWinner.displayName} wins`}</b> : null}
                  </div>
                  <div className="essential-win-details">
                    {state.showdownWinningTile ? <Tile t={state.showdownWinningTile} size="lg" /> : null}
                    <span>{state.showdownWinningDiscard
                      ? `Discard win · ${state.showdownWinningDiscard.seat === state.localSeat ? "You" : state.seats[state.showdownWinningDiscard.seat].displayName} discarded ${state.showdownWinningDiscard.tile.label}`
                      : state.showdownWinningTile ? `Self-draw · ${state.showdownWinningTile.label}` : "Winning hand"}</span>
                  </div>
                  <div className="essential-revealed-hands">
                    {showdownWinners.map((winner) => <div className="essential-revealed-hand" key={winner.seat} aria-label={`${winner.displayName}'s winning hand`}><b>{winner.seat === state.localSeat ? "Your hand" : winner.displayName}</b><span>{winner.revealedHand!.map((tile) => <Tile t={tile} size="sm" key={tile.id} />)}</span></div>)}
                  </div>
                </>
              )}
            </section>
          ) : null}
        </div>
        {preferences.showActionsFeed ? <RecentActions state={state} essential /> : null}
        <section className={`essential-console${wallUrgency ? ` essential-console--wall-${wallUrgency}` : ""}`} aria-label="Information console">
          <div className="essential-console-stats">
            <strong>{state.wall.drawableRemaining}</strong><span>tiles left</span><strong>{essentialTimer}</strong><span>{state.untimed ? "move elapsed" : "turn timer"}</span>
            <span className="essential-round-info">{windName(state.prevailingWind)} round{state.continuation > 0 ? ` · Dealer repeat ×${state.continuation}` : ""}</span>
            {wallUrgency ? <strong className="essential-wall-alert" role="status">{wallUrgency === "critical" ? "Final tiles · 8 or fewer" : "Low wall · 16 or fewer"}</strong> : null}
          </div>
          <div className="essential-compass" aria-label={`${activeSeat}'s turn`}>{compassSeats.map(({ seatId, position }) => <span className={`essential-compass-${position}${seatId === activeSeat ? " is-active" : ""}`} key={seatId}>{seatId}</span>)}</div>
          <div className="essential-console-discard">{state.lastDiscard ? <><Tile t={state.lastDiscard.tile} size="lg" /><span>Last discard · {state.lastDiscard.seat}</span></> : <span>No discard yet</span>}</div>
          <p className="essential-message">{meaningfulClaimActions.length ? "Choose a claim or pass" : passAction && autoPassDelay === "off" ? t("table.passRequired") : interaction?.canDiscard ? selectedTile ? `${selectedTile.label} selected · select again to discard` : "Select a tile to discard" : `${state.seats[activeSeat].displayName}'s turn`}</p>
        </section>
        {preferences.showGuide ? <GuideLog actions={state.legalActions} /> : null}
        <section className={`essential-actions${reviewTemporaryUi && essentialActions.length === 0 && !hasManualDrawAction ? " is-layout-placeholder" : ""}`} aria-label="Available actions">
          {interaction?.canDraw ? <button type="button" onClick={interaction.onDraw} disabled={interaction.drawPending}>{interaction.drawPending ? "Drawing…" : "Draw now"}</button> : null}
          {essentialActions.map((action) => {
            const id = action.id.toLowerCase();
            const consequential = id === "pong" || id.startsWith("pong-") || id === "chow" || id.startsWith("chow-") || id === "chi" || id.startsWith("chi-") || id === "kong" || id.startsWith("kong-") || id === "gang" || id.startsWith("gang-") || id === "kang" || id.startsWith("kang-");
            const confirming = action.id === essentialConfirmingActionId;
            const claimName = id === "pong" || id.startsWith("pong-") ? "Pong" : id === "chow" || id.startsWith("chow-") || id === "chi" || id.startsWith("chi-") ? "Chi" : id === "kang" || id.startsWith("kang-") ? "Kang" : "Gang";
            const pass = id === "pass";
            return <div
              className={`essential-action-option${pass ? " essential-action-option--pass" : ""}`}
              key={action.id}
            >
              <button
                type="button"
                className={confirming ? "is-confirming" : undefined}
                onClick={() => {
                  if (consequential && !confirming) {
                    setEssentialConfirmingActionId(action.id);
                    return;
                  }
                  setEssentialConfirmingActionId(null);
                  action.onClick?.();
                }}
                disabled={action.disabled}
                aria-label={action.claimPreview ? `${action.label}: ${action.claimPreview.tiles.map((tile) => tile.label).join(", ")}` : undefined}
              >
                <span>{confirming ? `Confirm ${claimName}` : action.label}</span>
              </button>
              {action.claimPreview ? (
                <div className="essential-action-preview" aria-hidden="true">
                  <span className="essential-chow-preview">
                    {action.claimPreview.tiles.map((tile) => (
                      <span className={tile.id === action.claimPreview!.claimedTileId ? "is-claimed" : ""} key={tile.id}>
                        <Tile t={tile} size="sm" />
                      </span>
                    ))}
                  </span>
                </div>
              ) : pass && autoPassRemainingMs !== null ? (
                <div className="essential-action-preview essential-pass-countdown" role="timer" aria-live="polite">
                  <span>Auto-pass in</span>
                  <strong>{Math.max(1, Math.ceil(autoPassRemainingMs / 1000))}s</strong>
                </div>
              ) : null}
            </div>;
          })}
          {reviewTemporaryUi && essentialActions.length === 0 && !hasManualDrawAction ? <span className="essential-layout-label" aria-hidden="true">Claim actions</span> : null}
        </section>
        <section className="essential-player" aria-label="Your hand">
          <div className="essential-profile-row essential-profile-row--local">
            <div className="essential-seat-status"><strong>{local.wind}</strong>{local.isDealer ? <span>Dealer</span> : null}</div>
            <div className="essential-profile essential-profile--local"><PlayerProfileBadge profile={playerProfile ?? defaultPlayerProfile(false)} /><span className="essential-player-flags">{local.wind === state.prevailingWind ? <small>Prevailing</small> : null}{visibleClaimSource === state.localSeat ? <small>Response pending</small> : null}</span></div>
          </div>
          <div className="essential-player-public">{local.melds.flatMap((meld) => meld.tiles).map((tile) => <Tile key={tile.id} t={tile} size="sm" />)}{local.bonusTiles.map((tile) => <Tile key={tile.id} t={tile} size="sm" />)}</div>
          {state.waits.length > 0 || reviewTemporaryUi ? (
            <div className={`essential-waits${state.waits.length === 0 ? " is-layout-placeholder" : ""}`} role="group" aria-label={t("table.waitsLabel")}>
              <strong>{t("table.ready")}</strong>
              <div role="list" aria-label={t("table.winningTiles")}>
                {state.waits.map((entry) => (
                  <span className="essential-wait" role="listitem" key={entry.tile.id}>
                    <Tile t={entry.tile} size="sm" />
                    <small>{entry.visibleRemaining > 0 ? t("table.left", { count: entry.visibleRemaining }) : t("table.allVisible")}</small>
                  </span>
                ))}
              </div>
              {state.waits.length === 0 ? <span className="essential-layout-label" aria-hidden="true">Winning-tile preview</span> : null}
            </div>
          ) : null}
          <div className="essential-hand">
            <div className="essential-hand-track">
              <div className="essential-hand-settled">{settledHand.map(renderEssentialHandTile)}</div>
              <div className={`essential-draw-slot${drawnTile ? " is-filled" : ""}`}>
                {drawnTile ? renderEssentialHandTile(drawnTile) : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    );
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
        passAutomatically={autoPassDelay !== "off"}
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
        showClaimImpact={claimImpactEnabled}
        showPassOnly={autoPassDelay === "off"}
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
        drawnTileId={drawnTileId}
        tableFxEnabled={tableFxEnabled}
        onToggleTableFx={toggleTableFx}
        claimImpactEnabled={claimImpactEnabled}
        onToggleClaimImpact={toggleClaimImpact}
        autoPassDelay={autoPassDelay}
        onCycleAutoPassDelay={cycleAutoPassDelay}
        isClaimThinking={meaningfulClaimActions.length > 0}
        prevailingWind={state.prevailingWind}
        profile={playerProfile}
      />
    </div>
  );
}
