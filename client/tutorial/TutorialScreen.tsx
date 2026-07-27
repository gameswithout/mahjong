import { useEffect, useMemo, useRef, useState } from "react";

import { MatchTable } from "../MatchTable";
import type { MatchTableState } from "../matchTableTypes";
import {
  noopTutorialAnalytics,
  tutorialEvent,
  type TutorialAnalytics,
} from "./analytics";
import { TUTORIAL_CHAPTERS, type TutorialStep } from "./script";

export type TutorialExitOutcome = "completed" | "skipped";

interface StepLocation {
  chapterIndex: number;
  stepIndex: number;
}

function stepAt(location: StepLocation): TutorialStep {
  return TUTORIAL_CHAPTERS[location.chapterIndex].steps[location.stepIndex];
}

function nextLocation(location: StepLocation): StepLocation | null {
  const chapter = TUTORIAL_CHAPTERS[location.chapterIndex];
  if (location.stepIndex + 1 < chapter.steps.length) {
    return { ...location, stepIndex: location.stepIndex + 1 };
  }
  if (location.chapterIndex + 1 < TUTORIAL_CHAPTERS.length) {
    return { chapterIndex: location.chapterIndex + 1, stepIndex: 0 };
  }
  return null;
}

const START: StepLocation = { chapterIndex: 0, stepIndex: 0 };

export interface TutorialScreenProps {
  // §10.4 pays the same onboarding XP for finishing and for skipping, but the
  // two are recorded separately — a tutorial most players skip is a different
  // problem from one most players finish.
  onExit: (outcome: TutorialExitOutcome) => void;
  analytics?: TutorialAnalytics;
}

export function TutorialScreen({ onExit, analytics = noopTutorialAnalytics }: TutorialScreenProps) {
  const [location, setLocation] = useState<StepLocation>(START);
  const [attempted, setAttempted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [finished, setFinished] = useState(false);
  // Remounts the table on replay so its own internal selection state (the
  // inspect-then-activate discard) starts clean rather than mid-gesture.
  const [tableEpoch, setTableEpoch] = useState(0);

  const chapter = TUTORIAL_CHAPTERS[location.chapterIndex];
  const step = stepAt(location);

  // Analytics is a prop, and a changing identity must not re-fire step_shown.
  const emit = useRef(analytics);
  emit.current = analytics;

  useEffect(() => {
    emit.current(tutorialEvent("tutorial_started"));
  }, []);

  useEffect(() => {
    if (finished) {
      return;
    }
    emit.current(
      tutorialEvent("tutorial_step_shown", { chapterId: chapter.id, stepId: step.id }),
    );
  }, [chapter.id, step.id, finished, tableEpoch]);

  function advance() {
    emit.current(
      tutorialEvent("tutorial_step_completed", { chapterId: chapter.id, stepId: step.id }),
    );

    const next = nextLocation(location);
    const leavingChapter = next === null || next.chapterIndex !== location.chapterIndex;
    if (leavingChapter) {
      emit.current(tutorialEvent("tutorial_chapter_completed", { chapterId: chapter.id }));
    }

    setAttempted(false);
    setConfirmed(false);
    setTableEpoch((epoch) => epoch + 1);

    if (next === null) {
      emit.current(tutorialEvent("tutorial_completed"));
      setFinished(true);
      return;
    }
    setLocation(next);
  }

  // A correct action shows its confirmation first: the player did a thing, and
  // being told what it accomplished is the actual lesson.
  function satisfy() {
    if (step.confirmation) {
      setConfirmed(true);
      return;
    }
    advance();
  }

  function attempt(matches: boolean) {
    if (confirmed) {
      return;
    }
    if (matches) {
      satisfy();
      return;
    }
    setAttempted(true);
    emit.current(
      tutorialEvent("tutorial_step_retried", { chapterId: chapter.id, stepId: step.id }),
    );
  }

  function replayStep() {
    emit.current(
      tutorialEvent("tutorial_step_replayed", { chapterId: chapter.id, stepId: step.id }),
    );
    setAttempted(false);
    setConfirmed(false);
    setTableEpoch((epoch) => epoch + 1);
  }

  function skipStep() {
    emit.current(
      tutorialEvent("tutorial_skipped", { chapterId: chapter.id, fromStepId: step.id }),
    );
    advance();
  }

  function skipTutorial() {
    emit.current(
      tutorialEvent("tutorial_skipped", { chapterId: chapter.id, fromStepId: step.id }),
    );
    onExit("skipped");
  }

  function restart() {
    setLocation(START);
    setAttempted(false);
    setConfirmed(false);
    setFinished(false);
    setTableEpoch((epoch) => epoch + 1);
  }

  // Legal-action buttons come from the fixture without handlers; the screen
  // supplies them so a scripted table stays a data file.
  const tableState: MatchTableState = useMemo(
    () => ({
      ...step.table,
      legalActions: step.table.legalActions.map((action) => ({
        ...action,
        onClick: () =>
          attempt(step.expect.kind === "action" && step.expect.actionId === action.id),
      })),
    }),
    // attempt closes over the current step and confirmation state, both of
    // which are already in this dependency list by way of step/confirmed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, confirmed],
  );

  if (finished) {
    return (
      <div className="tutorial-screen" role="region" aria-label="Tutorial complete">
        <div className="tutorial-complete">
          <h2>You know enough to play.</h2>
          <p>
            Five sets and a pair; claim what helps; watch the discards before you let a tile go.
            The rest is practice.
          </p>
          <div className="tutorial-complete-actions">
            <button type="button" className="primary-action" onClick={() => onExit("completed")}>
              Play a hand
            </button>
            <button type="button" className="secondary-action" onClick={restart}>
              Replay the tutorial
            </button>
          </div>
        </div>
      </div>
    );
  }

  const stepNumber = location.stepIndex + 1;
  const waitingOnAction = step.expect.kind !== "read" && !confirmed;

  return (
    <div className="tutorial-screen" role="region" aria-label="Tutorial">
      <div className="tutorial-table" key={tableEpoch}>
        <MatchTable
          state={tableState}
          interaction={{
            canDiscard: step.expect.kind === "discard" && !confirmed,
            onDiscardTile: (tileId) =>
              attempt(step.expect.kind === "discard" && step.expect.tileId === tileId),
          }}
        />
      </div>

      <aside className="tutorial-panel" aria-label="Tutorial instruction">
        <p className="tutorial-progress">
          Chapter {location.chapterIndex + 1} of {TUTORIAL_CHAPTERS.length} · Step {stepNumber} of{" "}
          {chapter.steps.length}
        </p>
        <h2 className="tutorial-chapter-title">{chapter.title}</h2>

        <p className="tutorial-instruction">{step.instruction}</p>
        {step.detail && <p className="tutorial-detail">{step.detail}</p>}

        {confirmed && step.confirmation && (
          <p className="tutorial-confirmation" role="status">
            {step.confirmation}
          </p>
        )}

        {attempted && !confirmed && step.hint && (
          <p className="tutorial-hint" role="status">
            {step.hint}
          </p>
        )}

        <div className="tutorial-actions">
          {(step.expect.kind === "read" || confirmed) && (
            <button type="button" className="primary-action" onClick={advance}>
              Continue
            </button>
          )}

          {waitingOnAction && (
            <p className="tutorial-awaiting" role="status">
              Your move.
            </p>
          )}

          <button type="button" className="secondary-action" onClick={replayStep}>
            Replay this step
          </button>
          <button type="button" className="secondary-action" onClick={skipStep}>
            Skip this step
          </button>
          <button type="button" className="secondary-action tutorial-exit" onClick={skipTutorial}>
            Skip the tutorial
          </button>
        </div>
      </aside>
    </div>
  );
}
