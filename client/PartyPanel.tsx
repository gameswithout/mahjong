import { useState } from "react";

import { activeMembers, partyIsFull, seatedCount, type Party } from "./party";

// §8.6 party surface. A party exists for one reason here: to enter matchmaking
// as a group. Everything on this panel serves that — who is in, how to get
// someone else in, and how to leave.

export type PartyState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "none" }
  | { status: "ready"; party: Party }
  | { status: "error"; code: string; message: string };

function shortId(userId: string): string {
  return userId.length <= 12 ? userId : `${userId.slice(0, 8)}…${userId.slice(-4)}`;
}

export function PartyPanel({
  state,
  ownUserId,
  onCreate,
  onLeave,
  onJoinByCode,
  onGenerateCode,
  onKick,
  onRetry,
  busy,
}: {
  state: PartyState;
  ownUserId?: string;
  onCreate: () => void;
  onLeave: () => void;
  onJoinByCode: (code: string) => void;
  onGenerateCode: () => void;
  onKick: (userId: string) => void;
  onRetry: () => void;
  busy?: boolean;
}) {
  const [codeValue, setCodeValue] = useState("");

  function submitCode(event: React.FormEvent) {
    event.preventDefault();
    const code = codeValue.trim();
    if (!code) {
      return;
    }
    setCodeValue("");
    onJoinByCode(code);
  }

  return (
    <section className="party-panel" aria-labelledby="party-title">
      <p className="status-label">Party</p>
      <h2 id="party-title">Play together</h2>

      {state.status === "loading" && (
        <p className="session-detail" role="status" aria-live="polite">
          Loading party…
        </p>
      )}

      {state.status === "error" && (
        <div className="session-error" role="alert">
          <p>{state.message}</p>
          <button className="secondary-action session-action" type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {(state.status === "none" || state.status === "idle") && (
        <>
          <p className="practice-description">
            Start a party and invite friends, and you will all be seated at the
            same table. A party of four fills a table on its own.
          </p>
          <button
            className="secondary-action session-action"
            type="button"
            onClick={onCreate}
            disabled={busy}
          >
            {busy ? "Starting…" : "Start a party"}
          </button>

          <form className="party-join" onSubmit={submitCode}>
            <label className="session-input-label" htmlFor="party-code">
              Or join with an invite code
            </label>
            <div className="session-join-row">
              <input
                id="party-code"
                className="session-input"
                type="text"
                value={codeValue}
                onChange={(event) => setCodeValue(event.target.value)}
                placeholder="Enter code"
                autoComplete="off"
                maxLength={12}
              />
              <button className="secondary-action session-join-action" type="submit">
                Join
              </button>
            </div>
          </form>
        </>
      )}

      {state.status === "ready" && (
        <>
          <p className="session-detail">
            {seatedCount(state.party)} of 4 seats taken
            {partyIsFull(state.party) ? " · full" : ""}
          </p>

          <ul className="party-members">
            {state.party.members
              .filter((member) => member.status !== "LEFT" && member.status !== "KICKED")
              .map((member) => {
                const isLeader = member.userId === state.party.leaderId;
                const isSelf = member.userId === ownUserId;
                const pending = member.status === "INVITED";
                return (
                  <li key={member.userId} className="party-member">
                    <span className="party-member-name">
                      {isSelf ? "You" : shortId(member.userId)}
                      {isLeader && <span className="party-role">Leader</span>}
                      {/* An unanswered invite still holds a seat, so it has to
                          be visible or the seat count looks wrong. */}
                      {pending && <span className="party-role">Invited</span>}
                    </span>
                    {ownUserId === state.party.leaderId && !isSelf && (
                      <button
                        className="secondary-action friend-action"
                        type="button"
                        onClick={() => onKick(member.userId)}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>

          {activeMembers(state.party).length < 4 && (
            <p className="session-detail">
              Invite friends from the list below, or share the code.
            </p>
          )}

          <div className="party-actions">
            {state.party.code ? (
              <p className="party-code">
                Invite code: <code>{state.party.code}</code>
              </p>
            ) : (
              <button
                className="secondary-action session-action"
                type="button"
                onClick={onGenerateCode}
                disabled={busy}
              >
                Get an invite code
              </button>
            )}
            <button
              className="secondary-action session-action"
              type="button"
              onClick={onLeave}
              disabled={busy}
            >
              Leave party
            </button>
          </div>
        </>
      )}
    </section>
  );
}
