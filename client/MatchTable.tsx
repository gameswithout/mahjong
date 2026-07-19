import type { MatchTableState, SeatId, SeatState, WireMeld, WireTile } from "./matchTableTypes";
import { windName } from "./matchTableTypes";

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

function Tile({ t, size = "md", faceDown = false }: { t: WireTile; size?: "sm" | "md" | "lg"; faceDown?: boolean }) {
  if (faceDown) {
    return <span className={`tile tile-back tile-${size}`} aria-hidden="true" />;
  }
  return (
    <span className={`tile tile-${size}`} role="img" aria-label={t.label} title={t.label}>
      {t.glyph}
    </span>
  );
}

function MeldGroup({ meld }: { meld: WireMeld }) {
  return (
    <span className="meld" aria-label={`${meld.concealed ? "concealed " : ""}${meld.type} of ${meld.tiles.map((item) => item.label).join(", ")}`}>
      {meld.tiles.map((item) => (
        <Tile key={item.id} t={item} size="sm" />
      ))}
    </span>
  );
}

function DiscardGrid({ discards, highlightId, claimed }: { discards: WireTile[]; highlightId?: string; claimed?: boolean }) {
  return (
    <div className="discard-grid" role="list" aria-label="Discards">
      {discards.map((item) => (
        <span
          key={item.id}
          role="listitem"
          className={`discard-slot${item.id === highlightId ? " discard-slot-recent" : ""}`}
        >
          <Tile t={item} size="sm" />
        </span>
      ))}
      {claimed && highlightId ? <span className="discard-slot discard-slot-claimed">claimed</span> : null}
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
}: {
  seat: SeatId;
  slot: ScreenSlot;
  state: SeatState;
  prevailingWind: SeatId;
  lastDiscardTileId?: string;
  claimSource: SeatId | null;
}) {
  return (
    <section className={`seat seat-${slot}`} aria-label={`${windName(seat)} seat`}>
      <header className="seat-header">
        <span className={`wind-badge${seat === prevailingWind ? " wind-badge-prevailing" : ""}`}>{windName(seat).slice(0, 1)}</span>
        {state.isDealer ? <span className="dealer-badge" title="Dealer">D</span> : null}
        {state.isActive ? <span className="active-badge" title="Active player">●</span> : null}
        {claimSource === seat ? <span className="claim-badge" title="Claim source">claim</span> : null}
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
            <MeldGroup key={meld.id} meld={meld} />
          ))}
        </div>
      ) : null}
      <DiscardGrid discards={state.discards} highlightId={lastDiscardTileId} />
    </section>
  );
}

function WallAndTurnCenter({ state }: { state: MatchTableState }) {
  const urgent = state.countdownSeconds <= 3;
  const warn = state.countdownSeconds <= 5 && !urgent;
  const activeSeat = (Object.values(state.seats) as SeatState[]).find((s) => s.isActive)?.seat ?? state.localSeat;
  const fraction = state.countdownTotalSeconds > 0 ? state.countdownSeconds / state.countdownTotalSeconds : 0;
  return (
    <div className="center-panel" aria-label="Table status">
      <div
        className={`countdown${urgent ? " countdown-urgent" : warn ? " countdown-warn" : ""}`}
        role="timer"
        aria-live="polite"
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

function LocalSeat({ state, lastDiscardTileId }: { state: SeatState; lastDiscardTileId?: string }) {
  return (
    <section className="seat seat-bottom local-seat" aria-label="Your seat">
      <header className="seat-header">
        <span className="wind-badge">{windName(state.wind).slice(0, 1)}</span>
        {state.isDealer ? <span className="dealer-badge" title="Dealer">D</span> : null}
        <span className="local-label">You</span>
      </header>
      {state.melds.length > 0 ? (
        <div className="meld-area" aria-label="Your exposed melds">
          {state.melds.map((meld) => (
            <MeldGroup key={meld.id} meld={meld} />
          ))}
        </div>
      ) : null}
      <DiscardGrid discards={state.discards} highlightId={lastDiscardTileId} />
      <div className="local-hand" role="list" aria-label="Your hand">
        {(state.hand ?? []).map((item) => (
          <span key={item.id} role="listitem" className="local-hand-tile-wrap">
            <Tile t={item} size="lg" />
          </span>
        ))}
      </div>
    </section>
  );
}

function ActionRow({ actions }: { actions: string[] }) {
  return (
    <div className="action-row" role="group" aria-label="Legal actions">
      {actions.map((action) => (
        <button key={action} type="button" className={`action-button action-${action.toLowerCase()}`}>
          {action}
        </button>
      ))}
    </div>
  );
}

export function MatchTable({ state }: { state: MatchTableState }) {
  const slots = remapSeats(state.localSeat);
  const local = state.seats[state.localSeat];
  const lastDiscardTileId = state.lastDiscard?.tile.id;

  return (
    <div className="match-table" data-testid="match-table">
      <OpponentSeat
        seat={slots.top}
        slot="top"
        state={state.seats[slots.top]}
        prevailingWind={state.prevailingWind}
        lastDiscardTileId={state.lastDiscard?.seat === slots.top ? lastDiscardTileId : undefined}
        claimSource={state.claimSource}
      />
      <OpponentSeat
        seat={slots.left}
        slot="left"
        state={state.seats[slots.left]}
        prevailingWind={state.prevailingWind}
        lastDiscardTileId={state.lastDiscard?.seat === slots.left ? lastDiscardTileId : undefined}
        claimSource={state.claimSource}
      />
      <WallAndTurnCenter state={state} />
      <OpponentSeat
        seat={slots.right}
        slot="right"
        state={state.seats[slots.right]}
        prevailingWind={state.prevailingWind}
        lastDiscardTileId={state.lastDiscard?.seat === slots.right ? lastDiscardTileId : undefined}
        claimSource={state.claimSource}
      />
      <LocalSeat state={local} lastDiscardTileId={state.lastDiscard?.seat === state.localSeat ? lastDiscardTileId : undefined} />
      <ActionRow actions={state.legalActions} />
    </div>
  );
}
