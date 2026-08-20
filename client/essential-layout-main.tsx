import { createRoot } from "react-dom/client";

import { MatchTable } from "./MatchTable";
import { mockMatchTableState } from "./matchTableMockData";
import "./styles.css";
import "./match-table.css";

const scenario = new URLSearchParams(window.location.search).get("scenario") ?? "review";
const stalled = scenario === "stalled";

function LayoutHarness() {
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
        state={{ ...mockMatchTableState, waits: [], legalActions: [] }}
        preferences={{ expertHud: false, autoPassDelay: "off", claimImpactAnalysis: false, experimentalTableUi: true, tableLayoutOutlines: true }}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<LayoutHarness />);
