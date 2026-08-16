import { BotPersonaPicker, type BotPersonaPickerState } from "./BotPersonaPicker";

export interface PracticeLaunchCardProps {
  busy: boolean;
  hasSelectedSession: boolean;
  cleanupRequired?: boolean;
  matchServiceAvailable: boolean;
  onStart: () => void;
  onLeaveSelectedSession?: () => void;
  // Optional: a caller that hasn't wired the picker (an older test fixture,
  // or a build without it configured) still gets a plain launch button —
  // choosing opponents is additive, not a new requirement to start Practice.
  personaPicker?: BotPersonaPickerState;
}

export function PracticeLaunchCard({
  busy,
  hasSelectedSession,
  cleanupRequired = false,
  matchServiceAvailable,
  onStart,
  onLeaveSelectedSession,
  personaPicker,
}: PracticeLaunchCardProps) {
  return (
    <section className="practice-card" aria-labelledby="practice-title">
      <p className="status-label">Solo Practice</p>
      <h2 id="practice-title">Play a full hand against three bots</h2>
      <p className="practice-description">
        Untimed, no queue, and no pressure. Practice does not change Jade, rating,
        levels, or achievements. Progression is earned in Online Play.
      </p>
      {personaPicker && <BotPersonaPicker state={personaPicker} />}
      <button
        className="primary-action practice-action"
        type="button"
        onClick={onStart}
        disabled={busy || hasSelectedSession || !matchServiceAvailable}
      >
        Practice vs Bots
      </button>
      {!matchServiceAvailable && (
        <p className="practice-unavailable" role="alert">
          Practice is unavailable because the match service is not configured.
        </p>
      )}
      {hasSelectedSession && (
        <div className="practice-existing-session" role={cleanupRequired ? "alert" : undefined}>
          <p className="practice-unavailable">
            {cleanupRequired
              ? "We couldn't leave your previous table. Retry before starting another."
              : "A table is already active. Leave it before starting Practice."}
          </p>
          {onLeaveSelectedSession && (
            <button
              className="secondary-action practice-leave-action"
              type="button"
              onClick={onLeaveSelectedSession}
            >
              {cleanupRequired ? "Retry leaving table" : "Leave current table"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
