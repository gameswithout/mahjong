import { useState } from "react";

import type { Friend, FriendRequest, PresenceState } from "./friends";

// §10.6 friends surface. Deliberately small: a list, the two request queues,
// and one way to add someone. There is no player search — §10.6's rate limits
// exist because unsolicited requests are the abuse vector, and a search box
// over every account in the namespace is exactly that surface. Players add by
// the ID a friend gives them.

export type FriendsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "guest" }
  | {
      status: "ready";
      friends: Friend[];
      incoming: FriendRequest[];
      outgoing: FriendRequest[];
    }
  | { status: "error"; code: string; message: string };

const PRESENCE_LABEL: Record<PresenceState, string> = {
  online: "Online",
  busy: "In a match",
  invisible: "Offline",
  offline: "Offline",
};

// Short enough to read aloud, long enough to be unambiguous in a list.
function shortId(userId: string): string {
  return userId.length <= 12 ? userId : `${userId.slice(0, 8)}…${userId.slice(-4)}`;
}

export function FriendsPanel({
  state,
  ownUserId,
  onAdd,
  onAccept,
  onReject,
  onCancel,
  onUnfriend,
  onRetry,
  onInviteToParty,
  canInviteToParty,
}: {
  state: FriendsState;
  ownUserId?: string;
  onAdd: (userId: string) => void;
  onAccept: (userId: string) => void;
  onReject: (userId: string) => void;
  onCancel: (userId: string) => void;
  onUnfriend: (userId: string) => void;
  onRetry: () => void;
  onInviteToParty?: (userId: string) => void;
  canInviteToParty?: boolean;
}) {
  const [addValue, setAddValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  function submitAdd(event: React.FormEvent) {
    event.preventDefault();
    const target = addValue.trim();
    if (!target) {
      return;
    }
    // Catching this here rather than letting AGS answer it keeps a confusing
    // server error off a mistake the player can see for themselves.
    if (ownUserId && target === ownUserId) {
      setAddError("That is your own player ID.");
      return;
    }
    setAddError(null);
    setAddValue("");
    onAdd(target);
  }

  if (state.status === "guest") {
    return (
      <section className="friends-panel" aria-labelledby="friends-title">
        <p className="status-label">Friends</p>
        <h2 id="friends-title">Play with people you know</h2>
        {/* §10.1: a friend list needs a linked identity. Saying why is more
            useful than hiding the feature or letting it fail. */}
        <p className="practice-description">
          Friends need an account. Create one from the end of any match and your
          friends, party, and progress follow you to any device.
        </p>
      </section>
    );
  }

  return (
    <section className="friends-panel" aria-labelledby="friends-title">
      <p className="status-label">Friends</p>
      <h2 id="friends-title">Friends</h2>

      {state.status === "loading" && (
        <p className="session-detail" role="status" aria-live="polite">
          Loading friends…
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

      {state.status === "ready" && (
        <>
          {state.incoming.length > 0 && (
            <div className="friends-group">
              <h3 className="friends-group-title">
                Friend requests ({state.incoming.length})
              </h3>
              <ul className="friends-list">
                {state.incoming.map((request) => (
                  <li key={request.userId} className="friend-row">
                    <span className="friend-name">{shortId(request.userId)}</span>
                    <span className="friend-actions">
                      <button
                        className="secondary-action friend-action"
                        type="button"
                        onClick={() => onAccept(request.userId)}
                      >
                        Accept
                      </button>
                      <button
                        className="secondary-action friend-action"
                        type="button"
                        onClick={() => onReject(request.userId)}
                      >
                        Decline
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="friends-group">
            <h3 className="friends-group-title">
              Your friends ({state.friends.length})
            </h3>
            {state.friends.length === 0 ? (
              <p className="session-detail">
                No friends yet. Share your player ID below and add theirs.
              </p>
            ) : (
              <ul className="friends-list">
                {state.friends.map((friend) => (
                  <li key={friend.userId} className="friend-row">
                    <span className="friend-name">
                      {shortId(friend.userId)}
                      {/* Presence is text, never a coloured dot alone. */}
                      <span className={`friend-presence friend-presence-${friend.presence}`}>
                        {PRESENCE_LABEL[friend.presence]}
                      </span>
                    </span>
                    <span className="friend-actions">
                      {onInviteToParty && (
                        <button
                          className="secondary-action friend-action"
                          type="button"
                          disabled={!canInviteToParty || friend.presence === "offline"}
                          title={
                            friend.presence === "offline"
                              ? "They are offline"
                              : !canInviteToParty
                                ? "Your party is full"
                                : undefined
                          }
                          onClick={() => onInviteToParty(friend.userId)}
                        >
                          Invite
                        </button>
                      )}
                      <button
                        className="secondary-action friend-action"
                        type="button"
                        onClick={() => onUnfriend(friend.userId)}
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {state.outgoing.length > 0 && (
            <div className="friends-group">
              <h3 className="friends-group-title">Sent ({state.outgoing.length})</h3>
              <ul className="friends-list">
                {state.outgoing.map((request) => (
                  <li key={request.userId} className="friend-row">
                    <span className="friend-name">{shortId(request.userId)}</span>
                    <button
                      className="secondary-action friend-action"
                      type="button"
                      onClick={() => onCancel(request.userId)}
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form className="friends-add" onSubmit={submitAdd}>
            <label className="session-input-label" htmlFor="friend-add">
              Add a friend by player ID
            </label>
            <div className="session-join-row">
              <input
                id="friend-add"
                className="session-input"
                type="text"
                value={addValue}
                onChange={(event) => setAddValue(event.target.value)}
                placeholder="Paste their player ID"
                autoComplete="off"
              />
              <button className="secondary-action session-join-action" type="submit">
                Add
              </button>
            </div>
            {addError && (
              <p className="practice-unavailable" role="alert">
                {addError}
              </p>
            )}
          </form>

          {ownUserId && (
            <p className="friends-own-id">
              Your player ID: <code>{ownUserId}</code>
            </p>
          )}
        </>
      )}
    </section>
  );
}
