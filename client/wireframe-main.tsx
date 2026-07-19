import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { MatchTable } from "./MatchTable";
import { mockMatchTableState, mockMatchTableUrgentState } from "./matchTableMockData";
import "./match-table.css";

// E7.F5 wireframe harness: lets the two mock scenarios (normal countdown,
// urgent countdown / Pass-only claim window) be swapped for on-device
// review without needing a build per scenario.
function WireframeHarness() {
  const [urgent, setUrgent] = useState(false);
  const state = urgent ? mockMatchTableUrgentState : mockMatchTableState;
  return (
    <div style={{ background: "#000", height: "100vh", width: "100vw" }}>
      <div style={{ height: "360px", margin: "0 auto", width: "640px" }}>
        <MatchTable state={state} />
      </div>
      <button
        type="button"
        data-testid="scenario-toggle"
        onClick={() => setUrgent((value) => !value)}
        style={{ margin: "8px" }}
      >
        Toggle scenario ({urgent ? "urgent" : "normal"})
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WireframeHarness />
  </StrictMode>,
);
