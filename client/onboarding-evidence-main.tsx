import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import {
  OnboardingEvidence,
  type OnboardingEvidenceScenario,
} from "./OnboardingEvidence";
import "./styles.css";
import "./match-table.css";
import "./onboarding-evidence.css";

const SCENARIOS: OnboardingEvidenceScenario[] = [
  "lobby",
  "queue-normal",
  "queue-slow",
  "tutorial",
];

function selectedScenario(): OnboardingEvidenceScenario {
  const requested = new URLSearchParams(window.location.search).get("scenario");
  return SCENARIOS.includes(requested as OnboardingEvidenceScenario)
    ? (requested as OnboardingEvidenceScenario)
    : "lobby";
}

function Harness() {
  const scenario = selectedScenario();
  const capture = new URLSearchParams(window.location.search).has("capture");
  return (
    <>
      {!capture ? (
        <nav className="onboarding-evidence-nav" aria-label="Evidence scenario">
          {SCENARIOS.map((candidate) => (
            <a
              key={candidate}
              href={`?scenario=${candidate}`}
              aria-current={candidate === scenario ? "page" : undefined}
            >
              {candidate.replace("-", " ")}
            </a>
          ))}
        </nav>
      ) : null}
      <div data-evidence-scenario={scenario}>
        <OnboardingEvidence scenario={scenario} />
      </div>
    </>
  );
}

const container = document.querySelector("#root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
