import { useEffect, useState } from "react";

import type { RotationState } from "../protocol/envelope";
import {
  completionSummary,
  dealerName,
  formatTablePoints,
  handHeadline,
  placementLabel,
  placementNote,
  rotationProgress,
  secondsUntilNextHand,
  seatName,
  standingsForDisplay,
} from "./rotation";

export interface RotationPanelProps {
  rotation: RotationState;
  /** The viewing player, so their own row can be marked. */
  viewerUserId?: string;
  /** Resolves an AGS user ID to a display name, where one is known. */
  nameOf?: (userId: string) => string | undefined;
}

const noName = () => undefined;

/**
 * §8.4 Full Rotation standings, shown alongside the hand in play.
 *
 * Standings are listed per player rather than per seat. A player's wind turns
 * with the dealership, so a seat column would silently mean a different person
 * every hand — the one thing a running scoreboard must never do.
 */
export function RotationPanel({ rotation, viewerUserId, nameOf = noName }: RotationPanelProps) {
  const rows = standingsForDisplay(rotation, viewerUserId);
  const progress = rotationProgress(rotation);
  const dealer = dealerName(rotation, nameOf);

  return (
    <section className="rotation-panel" aria-labelledby="rotation-panel-title">
      <div className="rotation-panel-heading">
        <h2 id="rotation-panel-title" className="status-label">
          Full Rotation
        </h2>
        <p className="rotation-hand">{handHeadline(rotation, dealer)}</p>
      </div>

      {/* Progress is measured in players who have dealt, not hands played.
          §5.11 lets a winning dealer hold the deal, so a hand counter would
          claim the match was nearly over while it had barely started. */}
      <p className="rotation-progress" aria-label={progress.label}>
        {progress.label}
      </p>

      <table className="rotation-standings">
        <caption className="visually-hidden">
          Table points for each player. Points may be negative and are not Jade.
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Player</th>
            <th scope="col">Seat</th>
            <th scope="col">Table points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.user_id}
              className={row.isSelf ? "rotation-standing is-self" : "rotation-standing"}
            >
              <td>{row.rank}</td>
              <td>
                {nameOf(row.user_id) ?? seatName(row.position)}
                {row.isSelf ? <span className="rotation-you"> (you)</span> : null}
                {row.dealing ? <span className="rotation-dealing"> · dealing</span> : null}
              </td>
              {/* The wind, which is what this hand calls them, next to the
                  fixed position they keep for the whole match. */}
              <td>{seatName(row.wind)}</td>
              <td className="rotation-points">{formatTablePoints(row.table_points)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Table points are not a currency and must not be mistaken for one. */}
      <p className="rotation-footnote">
        Table points decide the ranking. Full Rotation stakes no Jade.
      </p>
    </section>
  );
}

/**
 * The pause between hands: standings, and how long until the next deal.
 *
 * The countdown is driven from the server's instant rather than a local timer
 * started on mount, so a player who reloads mid-pause sees the same moment
 * arrive as everyone else.
 */
export function InterHandCountdown({ rotation }: { rotation: RotationState }) {
  const [remaining, setRemaining] = useState(() => secondsUntilNextHand(rotation));

  useEffect(() => {
    setRemaining(secondsUntilNextHand(rotation));
    if (!rotation.next_hand_opens_at || rotation.complete) return;
    const timer = window.setInterval(() => {
      setRemaining(secondsUntilNextHand(rotation));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [rotation.next_hand_opens_at, rotation.complete, rotation]);

  if (remaining === null) return null;
  return (
    <p className="rotation-countdown" role="status">
      {remaining > 0
        ? `Next hand in ${remaining}s`
        : "Dealing the next hand…"}
    </p>
  );
}

/**
 * The end of a rotation: the podium, and why the match ended.
 *
 * The two endings are kept distinct in the copy. §8.4 treats a match stopped
 * by the 60-minute limit as structurally different from one that ran its
 * course, and a player whose rotation was cut short before they ever dealt
 * deserves to be told that rather than shown a generic result.
 */
export function RotationPodium({
  rotation,
  viewerUserId,
  nameOf = noName,
}: RotationPanelProps) {
  const placements = rotation.placements ?? [];
  if (!rotation.complete || placements.length === 0) return null;
  const summary = completionSummary(rotation);
  const award = rotation.placement_xp_award;

  return (
    <section className="rotation-podium" aria-labelledby="rotation-podium-title">
      <h2 id="rotation-podium-title">Final standings</h2>
      {summary ? <p className="rotation-podium-summary">{summary}</p> : null}
      <ol className="rotation-podium-list">
        {placements.map((placement) => {
          const note = placementNote(placement);
          const isSelf = Boolean(viewerUserId) && placement.user_id === viewerUserId;
          return (
            <li
              key={placement.user_id}
              className={isSelf ? "rotation-placement is-self" : "rotation-placement"}
            >
              <span className="rotation-placement-position">
                {placementLabel(placement.position)}
              </span>
              <span className="rotation-placement-name">
                {nameOf(placement.user_id) ?? "Player"}
                {isSelf ? <span className="rotation-you"> (you)</span> : null}
              </span>
              <span className="rotation-placement-points">
                {formatTablePoints(placement.table_points)}
              </span>
              {/* A tie is disclosed rather than hidden behind the displayed
                  order: §8.4 makes equal points a genuine tie for rating. */}
              {note ? <span className="rotation-placement-note">{note}</span> : null}
            </li>
          );
        })}
      </ol>
      {award && (award.total ?? 0) > 0 ? (
        <p className="rotation-placement-xp">
          Placement XP: +{award.total}
          {award.components?.[0]?.label ? ` · ${award.components[0].label}` : null}
        </p>
      ) : null}
    </section>
  );
}
