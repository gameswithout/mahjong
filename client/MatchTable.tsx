import { useEffect, useMemo, useRef, useState } from "react";

import { TileFace } from "./TileFace";
import type { MatchAction, MatchTableState, SeatId, SeatState, WaitEntry, WireMeld, WireTile } from "./matchTableTypes";
import { tileTypeKey, windName } from "./matchTableTypes";
import { applySort, SORT_MODES, sortModeLabel, type SortMode } from "./matchTableSort";

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
  matchesSelected = false,
}: {
  t: WireTile;
  size?: "sm" | "md" | "lg";
  faceDown?: boolean;
  matchesSelected?: boolean;
}) {
  if (faceDown) {
    return <span className={`tile tile-back tile-${size}`} aria-hidden="true" />;
  }
  return (
    <span
      className={`tile tile-${size}${matchesSelected ? " tile-match" : ""}`}
      role="img"
      aria-label={t.label}
      title={t.label}
    >
      <TileFace id={t.id} size={size} />
    </span>
  );
}

// §9.5: "Selected-tile matches receive both outline and brightness change,
// never color alone" — any other currently-visible tile of the same type as
// the one selected in the local hand (own melds, discards, opponents'
// exposed melds) gets the same treatment. matchKey is the selected tile's
// tileTypeKey(), or null when nothing is selected.
function matchesKey(id: string, matchKey: string | null): boolean {
  return matchKey !== null && tileTypeKey(id) === matchKey;
}

function MeldGroup({ meld, matchKey }: { meld: WireMeld; matchKey: string | null }) {
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
        <Tile key={item.id} t={item} size="sm" matchesSelected={matchesKey(item.id, matchKey)} />
      ))}
    </span>
  );
}

function DiscardGrid({
  discards,
  highlightId,
  claimed,
  matchKey,
  label = "Discards",
}: {
  discards: WireTile[];
  highlightId?: string;
  claimed?: boolean;
  matchKey: string | null;
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
          <Tile t={item} size="sm" matchesSelected={matchesKey(item.id, matchKey)} />
        </span>
      ))}
      {claimed && highlightId ? (
        <span className="discard-slot discard-slot-claimed" role="listitem">
          claimed
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
      <span className="takeover-badge bot-badge" title="AI-controlled seat" role="status">
        Bot
      </span>
    );
  }
  return (
    <span className="takeover-badge" title="Auto-playing (disconnected)" role="status">
      Auto-playing
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
    <div className="wait-panel" role="list" aria-label="Waiting on">
      <span className="wait-label" role="presentation">
        Ready
      </span>
      {waits.map((entry) => (
        <span key={entry.tile.id} role="listitem" className="wait-entry">
          <Tile t={entry.tile} size="sm" />
          <span className="wait-remaining">
            {entry.visibleRemaining > 0 ? `${entry.visibleRemaining} left` : "All visible"}
          </span>
        </span>
      ))}
    </div>
  );
}

function OpponentSeat({
  seat,
  slot,
  state,
  prevailingWind,
  claimSource,
  matchKey,
}: {
  seat: SeatId;
  slot: ScreenSlot;
  state: SeatState;
  prevailingWind: SeatId;
  claimSource: SeatId | null;
  matchKey: string | null;
}) {
  return (
    <section className={`seat seat-${slot}${state.isActive ? " seat-active" : ""}`} aria-label={`${windName(seat)} seat`}>
      <header className="seat-header">
        <div className="seat-identity">
          <span className="seat-avatar" aria-hidden="true">
            {state.isBot ? "🤖" : "🀄"}
          </span>
          <span className={`wind-badge${seat === prevailingWind ? " wind-badge-prevailing" : ""}`}>{windName(seat).slice(0, 1)}</span>
          <span className="seat-name">{state.displayName}</span>
          {state.isDealer ? <span className="dealer-badge" title="Dealer">D</span> : null}
        </div>
        <div className="seat-status">
          {state.isActive ? <span className="active-badge" title="Active player">●</span> : null}
          {claimSource === seat ? <span className="claim-badge" title="Claim source">claim</span> : null}
          <TakeoverBadge takenOver={state.takenOver} isBot={state.isBot} />
          <span className="hand-count" aria-label={`${state.handCount} tiles in hand`}>
            {state.handCount}
          </span>
        </div>
      </header>
      <div className="opponent-hand-backs" aria-hidden="true">
        {Array.from({ length: Math.min(state.handCount, 17) }).map((_, index) => (
          <span key={index} className="tile tile-back tile-xs" />
        ))}
      </div>
      {state.melds.length > 0 ? (
        <div className="meld-area" aria-label="Exposed melds">
          {state.melds.map((meld) => (
            <MeldGroup key={meld.id} meld={meld} matchKey={matchKey} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DiscardRiver({
  seat,
  slot,
  state,
  lastDiscardTileId,
  claimSource,
  matchKey,
}: {
  seat: SeatId;
  slot: ScreenSlot;
  state: SeatState;
  lastDiscardTileId?: string;
  claimSource: SeatId | null;
  matchKey: string | null;
}) {
  const label =
    slot === "bottom"
      ? "Your discard river"
      : `${state.displayName} · ${windName(seat)} discard river`;
  return (
    <section
      className={`discard-river discard-river-${slot}${claimSource === seat ? " discard-river-claim-source" : ""}`}
      aria-label={label}
    >
      <DiscardGrid
        discards={state.discards}
        highlightId={lastDiscardTileId}
        claimed={claimSource === seat}
        matchKey={matchKey}
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

function WallAndTurnCenter({ state }: { state: MatchTableState }) {
  const urgent = !state.untimed && state.countdownSeconds <= RED_THRESHOLD_SECONDS;
  const warn = !state.untimed && state.countdownSeconds <= AMBER_THRESHOLD_SECONDS && !urgent;
  const activeSeat = (Object.values(state.seats) as SeatState[]).find((s) => s.isActive)?.seat ?? state.localSeat;
  const fraction = state.countdownTotalSeconds > 0 ? state.countdownSeconds / state.countdownTotalSeconds : 0;

  // §9.4: "At 3 seconds it changes from neutral to amber, announces '3
  // seconds' to assistive technology... at 1 second it changes to red and
  // repeats the non-color cue." This must fire once per threshold crossing,
  // not on every per-second re-render (which aria-live="polite" on a
  // continuously-changing label would otherwise cause). None of this
  // applies to an untimed match (§5.10 Tutorial/AI Practice) — there is no
  // deadline counting down, so no threshold is ever crossed.
  const [announcement, setAnnouncement] = useState("");
  const announcedThresholdRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.untimed || state.countdownSeconds > AMBER_THRESHOLD_SECONDS) {
      announcedThresholdRef.current = null;
      return;
    }
    if (state.countdownSeconds <= RED_THRESHOLD_SECONDS && announcedThresholdRef.current !== RED_THRESHOLD_SECONDS) {
      announcedThresholdRef.current = RED_THRESHOLD_SECONDS;
      setAnnouncement("1 second remaining");
    } else if (state.countdownSeconds <= AMBER_THRESHOLD_SECONDS && announcedThresholdRef.current === null) {
      announcedThresholdRef.current = AMBER_THRESHOLD_SECONDS;
      setAnnouncement("3 seconds remaining");
    }
  }, [state.countdownSeconds, state.untimed]);

  return (
    <div
      className={`center-panel${activeSeat === state.localSeat ? " center-panel-your-turn" : ""}`}
      aria-label="Table status"
    >
      {state.untimed ? (
        <div className="countdown countdown-untimed" role="status" aria-label="No turn timer">
          <span className="countdown-untimed-icon" aria-hidden="true">
            ∞
          </span>
        </div>
      ) : (
        <div
          className={`countdown${urgent ? " countdown-urgent" : warn ? " countdown-warn" : ""}`}
          role="timer"
          aria-label={`${state.countdownSeconds} seconds remaining`}
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
      <div className="wall-outline" aria-label={`${state.wall.drawableRemaining} drawable tiles remaining`}>
        <span className="wall-outline-icon" aria-hidden="true">
          ▤
        </span>
        <span className="wall-count">{state.wall.drawableRemaining}</span>
        <span className="wall-count-label">left</span>
      </div>
      <div className="round-status">
        <span className="round-wind">Round {windName(state.prevailingWind)}</span>
        <span className="round-continuation">
          {state.continuation === 0 ? "Opening hand" : `${state.continuation} continuation${state.continuation === 1 ? "" : "s"}`}
        </span>
      </div>
      <div
        className={`active-seat-callout${activeSeat === state.localSeat ? " active-seat-callout-you" : ""}`}
        aria-live="polite"
      >
        {activeSeat === state.localSeat
          ? "Your turn"
          : `${state.seats[activeSeat].displayName} · ${windName(activeSeat)}`}
      </div>
    </div>
  );
}

function TablePlayfield({
  state,
  slots,
  matchKey,
}: {
  state: MatchTableState;
  slots: Record<ScreenSlot, SeatId>;
  matchKey: string | null;
}) {
  const lastDiscardTileId = state.lastDiscard?.tile.id;
  const activeSeat =
    (Object.values(state.seats) as SeatState[]).find((seat) => seat.isActive)?.seat ??
    state.localSeat;
  const activeSlot =
    (Object.entries(slots) as [ScreenSlot, SeatId][]).find(([, seat]) => seat === activeSeat)?.[0] ??
    "bottom";
  return (
    <div className="table-playfield">
      <span
        className={`turn-orbit-marker turn-orbit-marker-${activeSlot}`}
        aria-hidden="true"
      />
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
            matchKey={matchKey}
          />
        );
      })}
      <WallAndTurnCenter state={state} />
    </div>
  );
}

function LocalSeat({
  state,
  displayedHand,
  selectable,
  selectedTileId,
  onSelectTile,
  discardPending,
  canDraw,
  waits,
  matchKey,
  sortMode,
  onCycleSortMode,
  onMoveSelected,
  onReorderTile,
  drawnTileId,
  tableFxEnabled,
  onToggleTableFx,
}: {
  state: SeatState;
  displayedHand: WireTile[];
  selectable?: boolean;
  selectedTileId?: string | null;
  onSelectTile?: (tileId: string) => void;
  discardPending?: boolean;
  canDraw?: boolean;
  waits: WaitEntry[];
  matchKey: string | null;
  sortMode: SortMode;
  onCycleSortMode: () => void;
  onMoveSelected: (direction: "left" | "right") => void;
  onReorderTile: (tileId: string, beforeTileId: string) => void;
  drawnTileId: string | null;
  tableFxEnabled: boolean;
  onToggleTableFx: () => void;
}) {
  // §9.3 "manual reorder" reuses the same tile-select gesture already used
  // for discard selection (only active in Off mode) rather than a second,
  // parallel selection mechanism — the Move buttons act on whichever tile
  // is currently selected.
  const canReorder =
    sortMode === "off" && selectable && !!selectedTileId && selectedTileId !== drawnTileId;

  return (
    <section className={`seat seat-bottom local-seat${selectable || canDraw ? " seat-active" : ""}`} aria-label="Your seat">
      <header className="seat-header">
        <div className="seat-identity">
          <span className="seat-avatar" aria-hidden="true">
            🀄
          </span>
          <span className="wind-badge">{windName(state.wind).slice(0, 1)}</span>
          <span className="seat-name">You</span>
          {state.isDealer ? <span className="dealer-badge" title="Dealer">D</span> : null}
          <TakeoverBadge takenOver={state.takenOver} isBot={state.isBot} />
        </div>
        <div className="seat-status">
          <button
            type="button"
            className="sort-toggle-button"
            onClick={onCycleSortMode}
            aria-label={`Hand sort: ${sortModeLabel(sortMode)}. Activate to change.`}
          >
            Sort: {sortModeLabel(sortMode)}
          </button>
          <button
            type="button"
            className={`table-fx-toggle${tableFxEnabled ? " table-fx-toggle-on" : ""}`}
            onClick={onToggleTableFx}
            aria-pressed={tableFxEnabled}
            aria-label={`Table sounds and haptics ${tableFxEnabled ? "on" : "off"}`}
          >
            FX {tableFxEnabled ? "On" : "Off"}
          </button>
        </div>
      </header>
      {state.melds.length > 0 ? (
        <div className="meld-area" aria-label="Your exposed melds">
          {state.melds.map((meld) => (
            <MeldGroup key={meld.id} meld={meld} matchKey={matchKey} />
          ))}
        </div>
      ) : null}
      <WaitPanel waits={waits} />
      <div className="local-hand" role="list" aria-label="Your hand">
        {displayedHand.map((item) => {
          const selected = selectedTileId === item.id;
          const drawn = drawnTileId === item.id;
          if (!selectable) {
            return (
              <span
                key={item.id}
                role="listitem"
                className={`local-hand-tile-wrap${drawn ? " local-hand-tile-drawn" : ""}`}
              >
                <Tile t={item} size="lg" />
              </span>
            );
          }
          return (
            <button
              key={item.id}
              type="button"
              role="listitem"
              className={`local-hand-tile-wrap local-hand-tile-button${selected ? " local-hand-tile-selected" : ""}${drawn ? " local-hand-tile-drawn" : ""}`}
              aria-pressed={selected}
              aria-label={
                selected
                  ? `${item.label}, selected. Activate again or confirm to discard.`
                  : `Select ${item.label}${drawn ? ", newly drawn," : ""} to discard`
              }
              disabled={discardPending}
              draggable={sortMode === "off" && !discardPending && !drawn}
              onClick={() => onSelectTile?.(item.id)}
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
                if (!canReorder || !selected) {
                  return;
                }
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  onMoveSelected("left");
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  onMoveSelected("right");
                }
              }}
            >
              <Tile t={item} size="lg" matchesSelected={!selected && matchesKey(item.id, matchKey)} />
            </button>
          );
        })}
      </div>
      {canReorder ? (
        <div className="discard-confirm-row">
          <button type="button" className="action-button action-pass reorder-button" onClick={() => onMoveSelected("left")}>
            ← Move
          </button>
          <button type="button" className="action-button action-pass reorder-button" onClick={() => onMoveSelected("right")}>
            Move →
          </button>
        </div>
      ) : null}
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

function ClaimButtons({ actions }: { actions: MatchAction[] }) {
  return (
    <div className="action-row" role="group" aria-label="Legal actions">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={`action-button action-${action.id.toLowerCase()}`}
          onClick={action.onClick}
          disabled={action.disabled}
          title={action.preview ? winButtonTitle(action.preview) : undefined}
        >
          {action.label}
          {action.preview ? ` · ${action.preview.rawTai} Tai` : ""}
        </button>
      ))}
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
  claimTile,
  claimFromLabel,
  canDraw,
  onDraw,
  drawPending,
  canDiscard,
  selectedTile,
  onConfirmDiscard,
  discardPending,
}: {
  legalActions: MatchAction[];
  claimTile?: WireTile;
  claimFromLabel?: string;
  canDraw?: boolean;
  onDraw?: () => void;
  drawPending?: boolean;
  canDiscard?: boolean;
  selectedTile?: WireTile;
  onConfirmDiscard?: () => void;
  discardPending?: boolean;
}) {
  if (legalActions.length > 0) {
    return (
      <div className="action-bar action-bar-claim">
        <div className="action-bar-context">
          {claimTile ? <Tile t={claimTile} size="md" /> : null}
          <span className="action-bar-prompt">
            {claimFromLabel ? `${claimFromLabel} discarded — your move` : "Respond to the discard"}
          </span>
        </div>
        <ClaimButtons actions={legalActions} />
      </div>
    );
  }
  if (canDraw) {
    return (
      <div className="action-bar action-bar-draw">
        <p className="action-bar-prompt action-bar-hint" role="status" aria-live="polite">
          {drawPending ? "Drawing your tile…" : "Your tile will draw automatically"}
        </p>
        {!drawPending ? (
          <button type="button" className="action-button action-pass action-draw-fallback" onClick={onDraw}>
            Draw now
          </button>
        ) : null}
      </div>
    );
  }
  if (canDiscard) {
    return (
      <div className="action-bar">
        {selectedTile ? (
          <button
            type="button"
            className="action-button action-primary action-discard-confirm"
            onClick={onConfirmDiscard}
            disabled={discardPending}
          >
            {discardPending ? "Discarding…" : "Discard"}
            {!discardPending ? <Tile t={selectedTile} size="sm" /> : null}
          </button>
        ) : (
          <p className="action-bar-prompt action-bar-hint">Your turn — tap a tile below to discard it</p>
        )}
      </div>
    );
  }
  return null;
}

export interface MatchTableInteraction {
  canDiscard?: boolean;
  selectedTileId?: string | null;
  onSelectTile?: (tileId: string) => void;
  onConfirmDiscard?: () => void;
  discardPending?: boolean;
  canDraw?: boolean;
  onDraw?: () => void;
  drawPending?: boolean;
}

export function MatchTable({ state, interaction }: { state: MatchTableState; interaction?: MatchTableInteraction }) {
  const slots = remapSeats(state.localSeat);
  const local = state.seats[state.localSeat];
  const matchKey = interaction?.selectedTileId ? tileTypeKey(interaction.selectedTileId) : null;

  const localHand = local.hand ?? [];
  const localHandIds = localHand.map((t) => t.id).join(",");
  const selectedTileId = interaction?.selectedTileId ?? null;

  const [sortMode, setSortMode] = useState<SortMode>("off");
  const [handOrder, setHandOrder] = useState<string[]>(() => localHand.map((t) => t.id));
  const [drawnTileId, setDrawnTileId] = useState<string | null>(() =>
    interaction?.canDiscard ? (localHand.at(-1)?.id ?? null) : null,
  );
  const previousHandIdsRef = useRef(localHand.map((tile) => tile.id));
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

  // §9.3: "Auto-sort runs after deal, draw, claim, and manual toggle but
  // never while a tile is selected." Reconciles the display order against
  // whatever tiles are actually in hand now (deal/draw/discard/claim all
  // change that set), then — unless a tile is currently selected — applies
  // the active auto-sort mode on top.
  useEffect(() => {
    setHandOrder((current) => {
      const incomingIds = localHand.map((t) => t.id);
      const incomingSet = new Set(incomingIds);
      const currentSet = new Set(current);
      const kept = current.filter((id) => incomingSet.has(id));
      const added = incomingIds.filter((id) => !currentSet.has(id));
      const reconciled = [...kept, ...added];
      if (sortMode === "off" || selectedTileId) {
        return reconciled;
      }
      const byId = new Map(localHand.map((t) => [t.id, t]));
      const ordered = reconciled.map((id) => byId.get(id)).filter((t): t is WireTile => Boolean(t));
      return applySort(sortMode, ordered).map((t) => t.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localHandIds, sortMode, selectedTileId]);

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

  function moveSelected(direction: "left" | "right") {
    if (!selectedTileId) {
      return;
    }
    setHandOrder((current) => {
      const index = current.indexOf(selectedTileId);
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

  // Plain-language label for a seat: "You" for the local player, otherwise
  // the display name plus its unique wind so two same-named bots are never
  // ambiguous ("Bot · West").
  function seatLabel(seat: SeatId): string {
    if (seat === state.localSeat) {
      return "You";
    }
    return `${state.seats[seat].displayName} · ${windName(seat)}`;
  }

  const claimTile = state.claimSource ? state.lastDiscard?.tile : undefined;
  const claimFromLabel = state.claimSource ? seatLabel(state.claimSource) : undefined;
  const selectedTile = selectedTileId ? localHand.find((t) => t.id === selectedTileId) : undefined;

  return (
    <div className="match-table" data-testid="match-table">
      <OpponentSeat
        seat={slots.top}
        slot="top"
        state={state.seats[slots.top]}
        prevailingWind={state.prevailingWind}
        claimSource={state.claimSource}
        matchKey={matchKey}
      />
      <OpponentSeat
        seat={slots.left}
        slot="left"
        state={state.seats[slots.left]}
        prevailingWind={state.prevailingWind}
        claimSource={state.claimSource}
        matchKey={matchKey}
      />
      <TablePlayfield state={state} slots={slots} matchKey={matchKey} />
      <OpponentSeat
        seat={slots.right}
        slot="right"
        state={state.seats[slots.right]}
        prevailingWind={state.prevailingWind}
        claimSource={state.claimSource}
        matchKey={matchKey}
      />
      <ActionBar
        legalActions={state.legalActions}
        claimTile={claimTile}
        claimFromLabel={claimFromLabel}
        canDraw={interaction?.canDraw}
        onDraw={interaction?.onDraw}
        drawPending={interaction?.drawPending}
        canDiscard={interaction?.canDiscard}
        selectedTile={selectedTile}
        onConfirmDiscard={interaction?.onConfirmDiscard}
        discardPending={interaction?.discardPending}
      />
      <LocalSeat
        state={local}
        displayedHand={displayedHand}
        selectable={interaction?.canDiscard}
        selectedTileId={interaction?.selectedTileId}
        onSelectTile={interaction?.onSelectTile}
        discardPending={interaction?.discardPending}
        canDraw={interaction?.canDraw}
        waits={state.waits}
        matchKey={matchKey}
        sortMode={sortMode}
        onCycleSortMode={cycleSortMode}
        onMoveSelected={moveSelected}
        onReorderTile={reorderTile}
        drawnTileId={drawnTileId}
        tableFxEnabled={tableFxEnabled}
        onToggleTableFx={toggleTableFx}
      />
    </div>
  );
}
