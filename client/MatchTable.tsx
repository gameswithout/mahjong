import { useEffect, useMemo, useRef, useState } from "react";

import type { MatchAction, MatchTableState, SeatId, SeatState, WaitEntry, WireMeld, WireTile } from "./matchTableTypes";
import { tileTypeKey, windName } from "./matchTableTypes";
import { applySort, SORT_MODES, sortModeLabel, type SortMode } from "./matchTableSort";

// §9.2 static wireframe: proves every simultaneous-visibility element
// (tile identity, claim source, most recent discard, active player, dealer,
// seat wind, continuation count, countdown, all legal actions) fits at the
// 640x360 CSS pixel landscape minimum without opening another panel
// (E7.F5). This is a layout prototype with mock data, not the hardened
// production match table (E8) — no server wiring, no input handling beyond
// what proves the layout itself.

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
      {t.glyph}
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
}: {
  discards: WireTile[];
  highlightId?: string;
  claimed?: boolean;
  matchKey: string | null;
}) {
  return (
    <div className="discard-grid" role="list" aria-label="Discards">
      {discards.map((item) => (
        <span
          key={item.id}
          role="listitem"
          className={`discard-slot${item.id === highlightId ? " discard-slot-recent" : ""}`}
        >
          <Tile t={item} size="sm" matchesSelected={matchesKey(item.id, matchKey)} />
        </span>
      ))}
      {claimed && highlightId ? <span className="discard-slot discard-slot-claimed">claimed</span> : null}
    </div>
  );
}

// §9.4 Ting/wait-list assist: every tile type that currently completes the
// local player's hand, each with its "Visible remaining" count — zero shown
// as "All visible" rather than removed (a structurally legal but exhausted
// wait is still information the player can act on).
function WaitPanel({ waits }: { waits: WaitEntry[] }) {
  if (waits.length === 0) {
    return null;
  }
  return (
    <div className="wait-panel" role="list" aria-label="Waiting on">
      {waits.map((entry) => (
        <span key={entry.tile.id} role="listitem" className="wait-entry">
          <Tile t={entry.tile} size="sm" />
          <span className="wait-remaining">{entry.visibleRemaining > 0 ? entry.visibleRemaining : "All visible"}</span>
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
  lastDiscardTileId,
  claimSource,
  matchKey,
}: {
  seat: SeatId;
  slot: ScreenSlot;
  state: SeatState;
  prevailingWind: SeatId;
  lastDiscardTileId?: string;
  claimSource: SeatId | null;
  matchKey: string | null;
}) {
  return (
    <section className={`seat seat-${slot}`} aria-label={`${windName(seat)} seat`}>
      <header className="seat-header">
        <span className={`wind-badge${seat === prevailingWind ? " wind-badge-prevailing" : ""}`}>{windName(seat).slice(0, 1)}</span>
        {state.isDealer ? <span className="dealer-badge" title="Dealer">D</span> : null}
        {state.isActive ? <span className="active-badge" title="Active player">●</span> : null}
        {claimSource === seat ? <span className="claim-badge" title="Claim source">claim</span> : null}
        {state.takenOver ? (
          <span className="takeover-badge" title="Auto-playing (disconnected)" role="status">
            Auto-playing
          </span>
        ) : null}
        <span className="hand-count" aria-label={`${state.handCount} tiles in hand`}>
          {state.handCount}
        </span>
      </header>
      <div className="opponent-hand-backs" aria-hidden="true">
        {Array.from({ length: Math.min(state.handCount, slot === "top" ? 17 : 8) }).map((_, index) => (
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
      <DiscardGrid discards={state.discards} highlightId={lastDiscardTileId} matchKey={matchKey} />
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
  const urgent = state.countdownSeconds <= RED_THRESHOLD_SECONDS;
  const warn = state.countdownSeconds <= AMBER_THRESHOLD_SECONDS && !urgent;
  const activeSeat = (Object.values(state.seats) as SeatState[]).find((s) => s.isActive)?.seat ?? state.localSeat;
  const fraction = state.countdownTotalSeconds > 0 ? state.countdownSeconds / state.countdownTotalSeconds : 0;

  // §9.4: "At 3 seconds it changes from neutral to amber, announces '3
  // seconds' to assistive technology... at 1 second it changes to red and
  // repeats the non-color cue." This must fire once per threshold crossing,
  // not on every per-second re-render (which aria-live="polite" on a
  // continuously-changing label would otherwise cause).
  const [announcement, setAnnouncement] = useState("");
  const announcedThresholdRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.countdownSeconds > AMBER_THRESHOLD_SECONDS) {
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
  }, [state.countdownSeconds]);

  return (
    <div className="center-panel" aria-label="Table status">
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
        <span className="round-continuation">k={state.continuation}</span>
      </div>
      <div className="active-seat-callout" aria-live="polite">
        {activeSeat === state.localSeat ? "Your turn" : `${windName(activeSeat)} thinking`}
      </div>
    </div>
  );
}

function LocalSeat({
  state,
  displayedHand,
  lastDiscardTileId,
  selectable,
  selectedTileId,
  onSelectTile,
  onConfirmDiscard,
  discardPending,
  canDraw,
  onDraw,
  drawPending,
  waits,
  matchKey,
  sortMode,
  onCycleSortMode,
  onMoveSelected,
}: {
  state: SeatState;
  displayedHand: WireTile[];
  lastDiscardTileId?: string;
  selectable?: boolean;
  selectedTileId?: string | null;
  onSelectTile?: (tileId: string) => void;
  onConfirmDiscard?: () => void;
  discardPending?: boolean;
  canDraw?: boolean;
  onDraw?: () => void;
  drawPending?: boolean;
  waits: WaitEntry[];
  matchKey: string | null;
  sortMode: SortMode;
  onCycleSortMode: () => void;
  onMoveSelected: (direction: "left" | "right") => void;
}) {
  // §9.3 "manual reorder" reuses the same tile-select gesture already used
  // for discard selection (only active in Off mode) rather than a second,
  // parallel selection mechanism — the Move buttons act on whichever tile
  // is currently selected.
  const canReorder = sortMode === "off" && selectable && !!selectedTileId;

  return (
    <section className="seat seat-bottom local-seat" aria-label="Your seat">
      <header className="seat-header">
        <span className="wind-badge">{windName(state.wind).slice(0, 1)}</span>
        {state.isDealer ? <span className="dealer-badge" title="Dealer">D</span> : null}
        <span className="local-label">You</span>
        {state.takenOver ? (
          <span className="takeover-badge" title="Auto-playing (disconnected)" role="status">
            Auto-playing
          </span>
        ) : null}
        <button
          type="button"
          className="sort-toggle-button"
          onClick={onCycleSortMode}
          aria-label={`Hand sort: ${sortModeLabel(sortMode)}. Activate to change.`}
        >
          Sort: {sortModeLabel(sortMode)}
        </button>
        {canDraw ? (
          <button
            type="button"
            className="action-button action-draw local-draw-button"
            onClick={onDraw}
            disabled={drawPending}
          >
            {drawPending ? "Drawing…" : "Draw"}
          </button>
        ) : null}
      </header>
      {state.melds.length > 0 ? (
        <div className="meld-area" aria-label="Your exposed melds">
          {state.melds.map((meld) => (
            <MeldGroup key={meld.id} meld={meld} matchKey={matchKey} />
          ))}
        </div>
      ) : null}
      <WaitPanel waits={waits} />
      <DiscardGrid discards={state.discards} highlightId={lastDiscardTileId} matchKey={matchKey} />
      <div className="local-hand" role="list" aria-label="Your hand">
        {displayedHand.map((item) => {
          const selected = selectedTileId === item.id;
          if (!selectable) {
            return (
              <span key={item.id} role="listitem" className="local-hand-tile-wrap">
                <Tile t={item} size="lg" />
              </span>
            );
          }
          return (
            <button
              key={item.id}
              type="button"
              role="listitem"
              className={`local-hand-tile-wrap local-hand-tile-button${selected ? " local-hand-tile-selected" : ""}`}
              aria-pressed={selected}
              aria-label={selected ? `${item.label}, selected. Activate again or confirm to discard.` : `Select ${item.label} to discard`}
              disabled={discardPending}
              onClick={() => onSelectTile?.(item.id)}
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
      {selectable && selectedTileId ? (
        <div className="discard-confirm-row">
          {canReorder ? (
            <>
              <button type="button" className="action-button action-pass reorder-button" onClick={() => onMoveSelected("left")}>
                ← Move
              </button>
              <button type="button" className="action-button action-pass reorder-button" onClick={() => onMoveSelected("right")}>
                Move →
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="action-button action-discard-confirm"
            onClick={onConfirmDiscard}
            disabled={discardPending}
          >
            {discardPending ? "Discarding…" : "Discard"}
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

function ActionRow({ actions }: { actions: MatchAction[] }) {
  if (actions.length === 0) {
    return null;
  }
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
  const lastDiscardTileId = state.lastDiscard?.tile.id;
  const matchKey = interaction?.selectedTileId ? tileTypeKey(interaction.selectedTileId) : null;

  const localHand = local.hand ?? [];
  const localHandIds = localHand.map((t) => t.id).join(",");
  const selectedTileId = interaction?.selectedTileId ?? null;

  const [sortMode, setSortMode] = useState<SortMode>("off");
  const [handOrder, setHandOrder] = useState<string[]>(() => localHand.map((t) => t.id));

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
    return handOrder.map((id) => byId.get(id)).filter((t): t is WireTile => Boolean(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handOrder, localHandIds]);

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

  return (
    <div className="match-table" data-testid="match-table">
      <OpponentSeat
        seat={slots.top}
        slot="top"
        state={state.seats[slots.top]}
        prevailingWind={state.prevailingWind}
        lastDiscardTileId={state.lastDiscard?.seat === slots.top ? lastDiscardTileId : undefined}
        claimSource={state.claimSource}
        matchKey={matchKey}
      />
      <OpponentSeat
        seat={slots.left}
        slot="left"
        state={state.seats[slots.left]}
        prevailingWind={state.prevailingWind}
        lastDiscardTileId={state.lastDiscard?.seat === slots.left ? lastDiscardTileId : undefined}
        claimSource={state.claimSource}
        matchKey={matchKey}
      />
      <WallAndTurnCenter state={state} />
      <OpponentSeat
        seat={slots.right}
        slot="right"
        state={state.seats[slots.right]}
        prevailingWind={state.prevailingWind}
        lastDiscardTileId={state.lastDiscard?.seat === slots.right ? lastDiscardTileId : undefined}
        claimSource={state.claimSource}
        matchKey={matchKey}
      />
      <LocalSeat
        state={local}
        displayedHand={displayedHand}
        lastDiscardTileId={state.lastDiscard?.seat === state.localSeat ? lastDiscardTileId : undefined}
        selectable={interaction?.canDiscard}
        selectedTileId={interaction?.selectedTileId}
        onSelectTile={interaction?.onSelectTile}
        onConfirmDiscard={interaction?.onConfirmDiscard}
        discardPending={interaction?.discardPending}
        canDraw={interaction?.canDraw}
        onDraw={interaction?.onDraw}
        drawPending={interaction?.drawPending}
        waits={state.waits}
        matchKey={matchKey}
        sortMode={sortMode}
        onCycleSortMode={cycleSortMode}
        onMoveSelected={moveSelected}
      />
      <ActionRow actions={state.legalActions} />
    </div>
  );
}
