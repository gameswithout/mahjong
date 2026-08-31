import { createRoot } from "react-dom/client";

import { MatchTable } from "./MatchTable";
import { mockMatchTableState } from "./matchTableMockData";
import { tile } from "./matchTableTypes";
import "./styles.css";
import "./match-table.css";

const scenario = new URLSearchParams(window.location.search).get("scenario") ?? "review";
const stalled = scenario === "stalled";
const active = scenario === "active";
const passOnly = scenario === "pass-only";
const maximumActions = scenario === "maximum-actions";
const sidePanels = scenario === "side-panels";
const win = scenario === "win";
const draw = scenario === "draw";

const maximumActionSet = [
  { id: "win", label: "Win" },
  {
    id: "kong",
    label: "Gang",
    claimPreview: { tiles: ["dots-6-1", "dots-6-2", "dots-6-3", "dots-6-4"].map(tile), claimedTileId: "dots-6-2" },
  },
  {
    id: "pong",
    label: "Pong",
    claimPreview: { tiles: ["dots-6-1", "dots-6-2", "dots-6-3"].map(tile), claimedTileId: "dots-6-2" },
  },
  ...[
    ["dots-4-1", "dots-5-1", "dots-6-2"],
    ["dots-5-1", "dots-6-2", "dots-7-1"],
    ["dots-6-2", "dots-7-1", "dots-8-1"],
  ].map((ids, index) => ({
    id: `chow-${index}`,
    label: `Chow ${index + 1}`,
    claimPreview: { tiles: ids.map(tile), claimedTileId: "dots-6-2" },
  })),
  { id: "pass", label: "Pass" },
];

function LayoutHarness() {
  const baseState = maximumActions
    ? { ...mockMatchTableState, legalActions: maximumActionSet }
    : active || sidePanels
      ? mockMatchTableState
      : passOnly
        ? { ...mockMatchTableState, legalActions: mockMatchTableState.legalActions.filter((action) => action.id.toLowerCase() === "pass") }
        : { ...mockMatchTableState, waits: [], legalActions: [] };
  const tableState = win
    ? { ...mockMatchTableState, showdown: true, legalActions: [], showdownWinningTile: mockMatchTableState.lastDiscard?.tile, showdownWinType: { chinese: "胡", romanized: "Hu" }, seats: { ...mockMatchTableState.seats, S: { ...mockMatchTableState.seats.S, revealedHand: mockMatchTableState.seats.S.hand } } }
    : draw
      ? { ...mockMatchTableState, showdown: true, showdownDraw: true, legalActions: [] }
      : baseState;
  return (
    <main className="game-screen" style={{ height: "100dvh", minHeight: 0 }}>
      <div className="game-screen-fullscreen" data-layout-region="fullscreen">
        <p className="fullscreen-help is-layout-placeholder" aria-hidden="true">Fullscreen help</p>
        <button className="fullscreen-match-button" type="button">⛶ Full screen</button>
      </div>
      <div className="game-screen-topbar" data-layout-region="system-controls">
        <button className="leave-match-button" type="button">Leave match</button>
        <section className={`system-alerts${stalled ? "" : " is-layout-placeholder"}`} aria-label="System Alerts">
          <strong className="system-alerts-title">System Alerts</strong>
          <p className={`system-alert${stalled ? " system-alert--error" : ""}`}>{stalled ? "Connection lost. Retry in progress." : "Disconnection and retry status"}</p>
          {!stalled ? <p className="system-alert system-alert--success">Connection restored status</p> : null}
        </section>
      </div>
      <MatchTable
        state={tableState}
        preferences={{ expertHud: false, autoPassDelay: "off", claimImpactAnalysis: false, showGuide: sidePanels, showActionsFeed: sidePanels, experimentalTableUi: true, tableLayoutOutlines: !active && !passOnly && !maximumActions && !sidePanels }}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<LayoutHarness />);
