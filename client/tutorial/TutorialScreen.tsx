import { useEffect, useMemo, useRef, useState } from "react";

import { MatchTable } from "../MatchTable";
import type { MatchTableState } from "../matchTableTypes";
import { t, translateSource } from "../i18n";
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
    // Reset locally before notifying the parent. Besides making the control
    // resilient to a delayed parent transition, this removes the busy table
    // immediately so the exit always has visible feedback.
    setStarted(false);
    setLocation(START);
    setAttempted(false);
    setConfirmed(false);
    setFinished(false);
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
          <p className="tutorial-eyebrow">{t("tutorial.welcomeEyebrow")}</p>
          <h1 id="tutorial-welcome-title">{t("tutorial.welcomeTitle")}</h1>
          <p className="tutorial-welcome-lead">{t("tutorial.welcomeLead")}</p>

          <ol className="tutorial-roadmap" aria-label={t("tutorial.learnLabel")}>
            {TUTORIAL_CHAPTERS.map((item, index) => (
              <li key={item.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{translateSource(item.title)}</strong>
                  <p>{translateSource(item.summary)}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="tutorial-welcome-note">
            <strong>{t("tutorial.recipeTitle")}</strong>
            <span>{t("tutorial.recipe")}</span>
          </div>

          <div className="tutorial-welcome-actions">
            <button
              type="button"
              className="primary-action"
              onClick={beginTutorial}
            >
              {t("tutorial.start")}
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={skipTutorial}
            >
              {t("tutorial.skip")}
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
          <p className="tutorial-eyebrow">{t("tutorial.complete")}</p>
          <h1 id="tutorial-complete-title">{t("tutorial.ready")}</h1>
          <p>{t("tutorial.completeLead")}</p>

          <ol className="tutorial-finish-checklist">
            <li>
              <strong>{t("tutorial.takeTurn")}</strong>
              <span>{t("tutorial.takeTurnDetail")}</span>
            </li>
            <li>
              <strong>{t("tutorial.buildShape")}</strong>
              <span>{t("tutorial.buildShapeDetail")}</span>
            </li>
            <li>
              <strong>{t("tutorial.watchReady")}</strong>
              <span>{t("tutorial.watchReadyDetail")}</span>
            </li>
            <li>
              <strong>{t("tutorial.countTai")}</strong>
              <span>{t("tutorial.countTaiDetail")}</span>
            </li>
          </ol>

          <p className="tutorial-practice-next">{t("tutorial.practiceNext")}</p>

          <div className="tutorial-complete-actions">
            <button
              type="button"
              className="primary-action"
              onClick={() => onExit("completed")}
            >
              {t("tutorial.finish")}
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={restart}
            >
              {t("lobby.replayTutorial")}
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
      ? t("tutorial.waitDraw")
      : step.expect.kind === "discard"
        ? t("tutorial.waitDiscard")
        : t("tutorial.waitClaim");

  return (
    <main className="tutorial-screen" aria-label={t("tutorial.screenLabel")}>
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

      <aside className="tutorial-panel" aria-label={t("tutorial.instructionLabel")}>
        <div className="tutorial-progress-header">
          <p className="tutorial-progress">
            {t("tutorial.lessonProgress", {
              lesson: location.chapterIndex + 1,
              lessons: TUTORIAL_CHAPTERS.length,
            })}
            <span>
              {t("tutorial.stepProgress", { step: currentStep, steps: totalSteps })}
            </span>
          </p>
          <button
            type="button"
            className="tutorial-text-button tutorial-exit"
            onClick={skipTutorial}
          >
            {t("tutorial.exit")}
          </button>
        </div>
        <div
          className="tutorial-progress-track"
          role="progressbar"
          aria-label={t("tutorial.progressLabel")}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-valuenow={currentStep}
        >
          <span style={{ width: `${(currentStep / totalSteps) * 100}%` }} />
        </div>

        <div className="tutorial-chapter-heading">
          <h1 className="tutorial-chapter-title">{translateSource(chapter.title)}</h1>
          <p>{translateSource(chapter.summary)}</p>
        </div>

        <section className="tutorial-task" aria-labelledby="tutorial-task-title">
          <p className="tutorial-task-label">{t("tutorial.task")}</p>
          <h3 id="tutorial-task-title" className="tutorial-instruction">
            {translateSource(step.instruction)}
          </h3>
          {step.detail && <p className="tutorial-detail">{translateSource(step.detail)}</p>}
        </section>

        {step.keyPoint && (
          <p className="tutorial-key-point">
            <span>{t("tutorial.remember")}</span>
            {translateSource(step.keyPoint)}
          </p>
        )}

        {step.terms && (
          <section className="tutorial-glossary" aria-label={t("tutorial.wordsLabel")}>
            <h3>{t("tutorial.wordsTitle")}</h3>
            <dl>
              {step.terms.map((item) => (
                <div key={item.term}>
                  <dt>{translateSource(item.term)}</dt>
                  <dd>{translateSource(item.meaning)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {step.score && (
          <section className="tutorial-score" aria-label={translateSource(step.score.title)}>
            <h3>{translateSource(step.score.title)}</h3>
            <ul>
              {step.score.lines.map((line) => (
                <li key={line.label}>
                  <span>{translateSource(line.label)}</span>
                  <strong>+{line.tai}</strong>
                </li>
              ))}
            </ul>
            <p>
              <span>{t("tutorial.total")}</span>
              <strong>{t("tutorial.taiValue", { count: step.score.total })}</strong>
            </p>
          </section>
        )}

        {step.expect.kind === "answer" && !confirmed && step.answers && (
          <div
            className="tutorial-answer-grid"
            role="group"
            aria-label={t("tutorial.chooseTai")}
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
                {translateSource(answer.label)}
              </button>
            ))}
          </div>
        )}

        {confirmed && step.confirmation && (
          <p className="tutorial-confirmation" role="status">
            <strong>{t("tutorial.correctPrefix")}</strong> {translateSource(step.confirmation)}
          </p>
        )}

        {attempted && !confirmed && step.hint && (
          <p className="tutorial-hint" role="status">
            <strong>{t("tutorial.hintPrefix")}</strong> {translateSource(step.hint)}
          </p>
        )}

        <div className="tutorial-actions">
          {(step.expect.kind === "read" || confirmed) && (
            <button type="button" className="primary-action" onClick={advance}>
              {t("tutorial.continue")}
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
              {t("tutorial.resetStep")}
            </button>
            <button
              type="button"
              className="tutorial-text-button"
              onClick={skipStep}
            >
              {t("tutorial.skipStep")}
            </button>
          </div>
        </div>
      </aside>
    </main>
  );
}
