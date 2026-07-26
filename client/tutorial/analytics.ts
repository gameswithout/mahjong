import { TUTORIAL_SCRIPT_VERSION } from "./script";

// Every instruction emits an event, per the P1.1 requirement. There is no
// analytics backend yet (E15), so the default sink drops them — but the call
// sites and the event shape are real, which is the part that is expensive to
// retrofit later.

export type TutorialEventName =
  | "tutorial_started"
  | "tutorial_step_shown"
  | "tutorial_step_completed"
  | "tutorial_step_retried"
  | "tutorial_step_replayed"
  | "tutorial_chapter_completed"
  | "tutorial_skipped"
  | "tutorial_completed";

export interface TutorialEvent {
  name: TutorialEventName;
  scriptVersion: string;
  chapterId?: string;
  stepId?: string;
  // Set on skip events: which step the player was on when they left. A skip at
  // step one and a skip at the last step are different problems.
  fromStepId?: string;
}

export type TutorialAnalytics = (event: TutorialEvent) => void;

export const noopTutorialAnalytics: TutorialAnalytics = () => {};

export function tutorialEvent(
  name: TutorialEventName,
  fields: Omit<TutorialEvent, "name" | "scriptVersion"> = {},
): TutorialEvent {
  return { name, scriptVersion: TUTORIAL_SCRIPT_VERSION, ...fields };
}
