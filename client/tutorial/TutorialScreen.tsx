import { useEffect, useMemo, useRef, useState } from "react";

import { MatchTable } from "../MatchTable";
import type { MatchTableState } from "../matchTableTypes";
import {
  noopTutorialAnalytics,
  tutorialEvent,
  type TutorialAnalytics,
} from "./analytics";
import { allTutorialSteps, TUTORIAL_CHAPTERS, type TutorialStep } from "./script";

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

function stepOrdinal(location: StepLocation): number {
  return (
    TUTORIAL_CHAPTERS.slice(0, location.chapterIndex).reduce(
      (count, chapter) => count + chapter.steps.length,
      0,
    ) +
    location.stepIndex +
    1
  );
}

const START: StepLocation = { chapterIndex: 0, stepIndex: 0 };

export interface TutorialScreenProps {
  // Finishing and intentionally skipping award the same onboarding XP, but
  // the two are recorded separately so the learning path can be improved.
  onExit: (outcome: TutorialExitOutcome) => void;
  analytics?: TutorialAnalytics;
}

export function TutorialScreen({
  onExit,
  analytics = noopTutorialAnalytics,
}: TutorialScreenProps) {
  const [started, setStarted] = useState(false);
  const [location, setLocation] = useState<StepLocation>(START);
  const [attempted, setAttempted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [finished, setFinished] = useState(false);
  // Remounts the table on replay so its internal selection state starts clean
  // rather than leaving a tile selected from the previous attempt.
  const [tableEpoch, setTableEpoch] = useState(0);

  const chapter = TUTORIAL_CHAPTERS[location.chapterIndex];
  const step = stepAt(location);
  const totalSteps = allTutorialSteps().length;
  const currentStep = stepOrdinal(location);

  // Analytics is a prop, and a changing identity must not re-fire events.
  const emit = useRef(analytics);
  emit.current = analytics;

  useEffect(() => {
    emit.current(tutorialEvent("tutorial_started"));
  }, []);

  useEffect(() => {
    if (!started || finished) {
      return;
    }
    emit.current(
      tutorialEvent("tutorial_step_shown", {
        chapterId: chapter.id,
        stepId: step.id,
      }),
    );
  }, [chapter.id, step.id, finished, started, tableEpoch]);

  function beginTutorial() {
    setStarted(true);
  }

  function advance() {
    emit.current(
      tutorialEvent("tutorial_step_completed", {
        chapterId: chapter.id,
        stepId: step.id,
      }),
    );

    const next = nextLocation(location);
    const leavingChapter =
      next === null || next.chapterIndex !== location.chapterIndex;
    if (leavingChapter) {
      emit.current(
        tutorialEvent("tutorial_chapter_completed", { chapterId: chapter.id }),
      );
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

  // A correct action shows its confirmation first when one exists. Telling the
  // player what the action accomplished is part of the lesson.
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
      tutorialEvent("tutorial_step_retried", {
        chapterId: chapter.id,
        stepId: step.id,
      }),
    );
  }

  function replayStep() {
    emit.current(
      tutorialEvent("tutorial_step_replayed", {
        chapterId: chapter.id,
        stepId: step.id,
      }),
    );
    setAttempted(false);
    setConfirmed(false);
    setTableEpoch((epoch) => epoch + 1);
  }

  function skipStep() {
    emit.current(
      tutorialEvent("tutorial_skipped", {
        chapterId: chapter.id,
        fromStepId: step.id,
      }),
    );
    advance();
  }

  function skipTutorial() {
    emit.current(
      tutorialEvent("tutorial_skipped", {
        chapterId: chapter.id,
        fromStepId: step.id,
      }),
    );
    onExit("skipped");
  }

  function restart() {
    setStarted(false);
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
          attempt(
            step.expect.kind === "action" &&
              step.expect.actionId === action.id,
          ),
      })),
    }),
    // attempt closes over the current step and confirmation state, both of
    // which are already represented in this dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, confirmed],
  );

  if (!started) {
    return (
      <main
        className="tutorial-welcome-screen"
        aria-labelledby="tutorial-welcome-title"
      >
        <section className="tutorial-welcome-card">
          <p className="tutorial-eyebrow">Beginner tutorial · about 6 minutes</p>
          <h1 id="tutorial-welcome-title">Never played Mahjong? Start here.</h1>
          <p className="tutorial-welcome-lead">
            No terminology or scoring knowledge is assumed. You will use the
            real table, but every step is untimed and every mistake is safe.
          </p>

          <ol className="tutorial-roadmap" aria-label="What you will learn">
            {TUTORIAL_CHAPTERS.map((item, index) => (
              <li key={item.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.summary}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="tutorial-welcome-note">
            <strong>Your whole first-hand recipe</strong>
            <span>
              Draw one, discard one, build five groups and a pair, then choose
              Win when the game offers it.
            </span>
          </div>

          <div className="tutorial-welcome-actions">
            <button
              type="button"
              className="primary-action"
              onClick={beginTutorial}
            >
              Start with the basics
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={skipTutorial}
            >
              Skip the tutorial
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (finished) {
    return (
      <main
        className="tutorial-screen tutorial-finished-screen"
        aria-labelledby="tutorial-complete-title"
      >
        <section className="tutorial-complete">
          <p className="tutorial-eyebrow">Tutorial complete</p>
          <h1 id="tutorial-complete-title">
            You are ready for your first hand.
          </h1>
          <p>
            You do not need to memorise the full rulebook. Keep this small
            checklist beside you and let the table show the legal actions.
          </p>

          <ol className="tutorial-finish-checklist">
            <li>
              <strong>Take a turn</strong>
              <span>Draw one tile, then discard one tile.</span>
            </li>
            <li>
              <strong>Build the shape</strong>
              <span>Five groups plus one matching pair.</span>
            </li>
            <li>
              <strong>Watch the Ready panel</strong>
              <span>It lists the tiles that can complete your hand.</span>
            </li>
            <li>
              <strong>Count Tai</strong>
              <span>Add the pattern lines shown by the game; every win starts at 1.</span>
            </li>
          </ol>

          <p className="tutorial-practice-next">
            Next, choose <strong>Practice vs Bots</strong> in the lobby. It is
            untimed by default and does not affect Jade or rating.
          </p>

          <div className="tutorial-complete-actions">
            <button
              type="button"
              className="primary-action"
              onClick={() => onExit("completed")}
            >
              Finish and return to lobby
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={restart}
            >
              Replay the tutorial
            </button>
          </div>
        </section>
      </main>
    );
  }

  const waitingOnTable =
    step.expect.kind !== "read" &&
    step.expect.kind !== "answer" &&
    !confirmed;
  const waitingPrompt =
    step.expect.kind === "draw"
      ? "Use Draw now in the action bar."
      : step.expect.kind === "discard"
        ? "Use the tiles in your hand below."
        : "Use the claim buttons in the action bar.";

  return (
    <main className="tutorial-screen" aria-label="Mahjong tutorial">
      <div className="tutorial-table" key={tableEpoch}>
        <MatchTable
          state={tableState}
          interaction={{
            canDraw: step.expect.kind === "draw" && !confirmed,
            onDraw: () => attempt(step.expect.kind === "draw"),
            manualDrawOnly: step.expect.kind === "draw",
            canDiscard: step.expect.kind === "discard" && !confirmed,
            onDiscardTile: (tileId) =>
              attempt(
                step.expect.kind === "discard" &&
                  step.expect.tileId === tileId,
              ),
          }}
        />
      </div>

      <aside className="tutorial-panel" aria-label="Tutorial instruction">
        <div className="tutorial-progress-header">
          <p className="tutorial-progress">
            Lesson {location.chapterIndex + 1} of {TUTORIAL_CHAPTERS.length}
            <span>
              Step {currentStep} of {totalSteps}
            </span>
          </p>
          <button
            type="button"
            className="tutorial-text-button tutorial-exit"
            onClick={skipTutorial}
          >
            Exit tutorial
          </button>
        </div>
        <div
          className="tutorial-progress-track"
          role="progressbar"
          aria-label="Tutorial progress"
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-valuenow={currentStep}
        >
          <span style={{ width: `${(currentStep / totalSteps) * 100}%` }} />
        </div>

        <div className="tutorial-chapter-heading">
          <h2 className="tutorial-chapter-title">{chapter.title}</h2>
          <p>{chapter.summary}</p>
        </div>

        <section className="tutorial-task" aria-labelledby="tutorial-task-title">
          <p className="tutorial-task-label">Your task</p>
          <h3 id="tutorial-task-title" className="tutorial-instruction">
            {step.instruction}
          </h3>
          {step.detail && <p className="tutorial-detail">{step.detail}</p>}
        </section>

        {step.keyPoint && (
          <p className="tutorial-key-point">
            <span>Remember</span>
            {step.keyPoint}
          </p>
        )}

        {step.terms && (
          <section className="tutorial-glossary" aria-label="New words">
            <h3>New words, in plain language</h3>
            <dl>
              {step.terms.map((item) => (
                <div key={item.term}>
                  <dt>{item.term}</dt>
                  <dd>{item.meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {step.score && (
          <section className="tutorial-score" aria-label={step.score.title}>
            <h3>{step.score.title}</h3>
            <ul>
              {step.score.lines.map((line) => (
                <li key={line.label}>
                  <span>{line.label}</span>
                  <strong>+{line.tai}</strong>
                </li>
              ))}
            </ul>
            <p>
              <span>Total</span>
              <strong>{step.score.total} Tai</strong>
            </p>
          </section>
        )}

        {step.expect.kind === "answer" && !confirmed && step.answers && (
          <div
            className="tutorial-answer-grid"
            role="group"
            aria-label="Choose the Tai total"
          >
            {step.answers.map((answer) => (
              <button
                key={answer.id}
                type="button"
                className="secondary-action"
                onClick={() =>
                  attempt(
                    step.expect.kind === "answer" &&
                      step.expect.answerId === answer.id,
                  )
                }
              >
                {answer.label}
              </button>
            ))}
          </div>
        )}

        {confirmed && step.confirmation && (
          <p className="tutorial-confirmation" role="status">
            <strong>That’s it.</strong> {step.confirmation}
          </p>
        )}

        {attempted && !confirmed && step.hint && (
          <p className="tutorial-hint" role="status">
            <strong>Try this.</strong> {step.hint}
          </p>
        )}

        <div className="tutorial-actions">
          {(step.expect.kind === "read" || confirmed) && (
            <button type="button" className="primary-action" onClick={advance}>
              Continue
            </button>
          )}

          {waitingOnTable && (
            <p className="tutorial-awaiting" role="status">
              <span aria-hidden="true">↙</span> {waitingPrompt}
            </p>
          )}

          <div className="tutorial-step-tools">
            <button
              type="button"
              className="tutorial-text-button"
              onClick={replayStep}
            >
              Reset step
            </button>
            <button
              type="button"
              className="tutorial-text-button"
              onClick={skipStep}
            >
              Skip step
            </button>
          </div>
        </div>
      </aside>
    </main>
  );
}
