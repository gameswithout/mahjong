import { createRoot } from "react-dom/client";

import { MatchTable } from "./MatchTable";
import { mockMatchTableState } from "./matchTableMockData";
import "./match-table.css";

createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100vh", width: "100vw" }}>
    <MatchTable
      state={mockMatchTableState}
      interaction={{ canDiscard: true, onDiscardTile: () => {} }}
    />
  </div>,
);
