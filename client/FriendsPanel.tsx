import { useState } from "react";

import type { Friend, FriendRequest, PresenceState } from "./friends";
import { t, type MessageKey } from "./i18n";

// §10.6 friends surface. Deliberately small: a list, the two request queues,
// and one way to add someone. There is no player search — §10.6's rate limits
// exist because unsolicited requests are the abuse vector, and a search box
// over every account in the namespace is exactly that surface. Players add by
// the ID a friend gives them.

export type FriendsState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      friends: Friend[];
      incoming: FriendRequest[];
      outgoing: FriendRequest[];
    }
  | { status: "error"; code: string; message: string };

const PRESENCE_LABEL: Record<PresenceState, MessageKey> = {
  online: "friends.online",
  busy: "friends.inMatch",
  invisible: "friends.offline",
  offline: "friends.offline",
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
      setAddError(t("friends.ownIdError"));
      return;
    }
    setAddError(null);
    setAddValue("");
    onAdd(target);
  }

  return (
    <section className="friends-panel" aria-labelledby="friends-title">
      <p className="status-label">{t("friends.title")}</p>
      <h2 id="friends-title">{t("friends.title")}</h2>

      {state.status === "loading" && (
        <p className="session-detail" role="status" aria-live="polite">
          {t("friends.loading")}
        </p>
      )}

      {state.status === "error" && (
        <div className="session-error" role="alert">
          <p>{state.message}</p>
          <button className="secondary-action session-action" type="button" onClick={onRetry}>
            {t("common.retry")}
          </button>
        </div>
      )}

      {state.status === "ready" && (
        <>
          {state.incoming.length > 0 && (
            <div className="friends-group">
              <h3 className="friends-group-title">
                {t("friends.requests", { count: state.incoming.length })}
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
                        {t("friends.accept")}
                      </button>
                      <button
                        className="secondary-action friend-action"
                        type="button"
                        onClick={() => onReject(request.userId)}
                      >
                        {t("friends.decline")}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="friends-group">
            <h3 className="friends-group-title">
              {t("friends.yours", { count: state.friends.length })}
            </h3>
            {state.friends.length === 0 ? (
              <p className="session-detail">
                {t("friends.empty")}
              </p>
            ) : (
              <ul className="friends-list">
                {state.friends.map((friend) => (
                  <li key={friend.userId} className="friend-row">
                    <span className="friend-name">
                      {shortId(friend.userId)}
                      {/* Presence is text, never a coloured dot alone. */}
                      <span className={`friend-presence friend-presence-${friend.presence}`}>
                        {t(PRESENCE_LABEL[friend.presence])}
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
                              ? t("friends.offlineTitle")
                              : !canInviteToParty
                                ? t("friends.partyFullTitle")
                                : undefined
                          }
                          onClick={() => onInviteToParty(friend.userId)}
                        >
                          {t("friends.invite")}
                        </button>
                      )}
                      <button
                        className="secondary-action friend-action"
                        type="button"
                        onClick={() => onUnfriend(friend.userId)}
                      >
                        {t("common.remove")}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {state.outgoing.length > 0 && (
            <div className="friends-group">
              <h3 className="friends-group-title">
                {t("friends.sent", { count: state.outgoing.length })}
              </h3>
              <ul className="friends-list">
                {state.outgoing.map((request) => (
                  <li key={request.userId} className="friend-row">
                    <span className="friend-name">{shortId(request.userId)}</span>
                    <button
                      className="secondary-action friend-action"
                      type="button"
                      onClick={() => onCancel(request.userId)}
                    >
                      {t("common.cancel")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form className="friends-add" onSubmit={submitAdd}>
            <label className="session-input-label" htmlFor="friend-add">
              {t("friends.addById")}
            </label>
            <div className="session-join-row">
              <input
                id="friend-add"
                className="session-input"
                type="text"
                value={addValue}
                onChange={(event) => setAddValue(event.target.value)}
                placeholder={t("friends.pasteId")}
                autoComplete="off"
              />
              <button className="secondary-action session-join-action" type="submit">
                {t("friends.add")}
              </button>
            </div>
            {addError && (
              <p className="practice-unavailable" role="alert">
                {addError}
              </p>
            )}
          </form>

          {ownUserId && (
            <p className="friends-own-id">{t("friends.yourId", { id: ownUserId })}</p>
          )}
        </>
      )}
    </section>
  );
}
