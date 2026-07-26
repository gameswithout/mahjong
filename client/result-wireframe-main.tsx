import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { HandResultScreen } from "./HandResultScreen";
import { RESULT_SCENARIOS, type ResultScenarioId } from "./resultWireframeMockData";
import "./styles.css";
import "./match-table.css";

// P0.3 evidence harness: renders the real HandResultScreen against fixed
// scenarios so the result can be captured and reviewed on-device. Separate
// from the E7.F5 table wireframe because the two answer different questions
// — that one certifies the 640x360 table layout, this one certifies that the
// settlement story stays readable, including the capped case.
function ResultHarness() {
  const [scenario, setScenario] = useState<ResultScenarioId>("jade-capped");
  const active = RESULT_SCENARIOS.find((candidate) => candidate.id === scenario) ?? RESULT_SCENARIOS[0];

  return (
    <div className="result-wireframe" data-scenario={active.id}>
      <nav className="result-wireframe-switcher" aria-label="Result scenario">
        {RESULT_SCENARIOS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            data-testid={`scenario-${candidate.id}`}
            aria-pressed={candidate.id === active.id}
            onClick={() => setScenario(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </nav>
      <div data-testid="result-surface">
        <HandResultScreen
          view={active.view}
          practice={active.practice}
          onPlayAgain={() => undefined}
          onReturn={() => undefined}
        />
      </div>
    </div>
  );
}

const container = document.querySelector("#root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <ResultHarness />
    </StrictMode>,
  );
}
