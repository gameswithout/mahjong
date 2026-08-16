import { useState } from "react";

import { activeMembers, partyIsFull, seatedCount, type Party } from "./party";
import { t } from "./i18n";

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
      <p className="status-label">{t("party.eyebrow")}</p>
      <h2 id="party-title">{t("party.title")}</h2>

      {state.status === "loading" && (
        <p className="session-detail" role="status" aria-live="polite">
          {t("party.loading")}
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

      {(state.status === "none" || state.status === "idle") && (
        <>
          <p className="practice-description">{t("party.description")}</p>
          <button
            className="secondary-action session-action"
            type="button"
            onClick={onCreate}
            disabled={busy}
          >
            {busy ? t("party.starting") : t("party.start")}
          </button>

          <form className="party-join" onSubmit={submitCode}>
            <label className="session-input-label" htmlFor="party-code">
              {t("party.joinCode")}
            </label>
            <div className="session-join-row">
              <input
                id="party-code"
                className="session-input"
                type="text"
                value={codeValue}
                onChange={(event) => setCodeValue(event.target.value)}
                placeholder={t("party.enterCode")}
                autoComplete="off"
                maxLength={12}
              />
              <button className="secondary-action session-join-action" type="submit">
                {t("common.join")}
              </button>
            </div>
          </form>
        </>
      )}

      {state.status === "ready" && (
        <>
          <p className="session-detail">
            {t("party.seats", {
              count: seatedCount(state.party),
              full: partyIsFull(state.party) ? t("party.full") : "",
            })}
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
                      {isSelf ? t("common.you") : shortId(member.userId)}
                      {isLeader && <span className="party-role">{t("party.leader")}</span>}
                      {/* An unanswered invite still holds a seat, so it has to
                          be visible or the seat count looks wrong. */}
                      {pending && <span className="party-role">{t("party.invited")}</span>}
                    </span>
                    {ownUserId === state.party.leaderId && !isSelf && (
                      <button
                        className="secondary-action friend-action"
                        type="button"
                        onClick={() => onKick(member.userId)}
                      >
                        {t("common.remove")}
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>

          {activeMembers(state.party).length < 4 && (
            <p className="session-detail">{t("party.inviteHelp")}</p>
          )}

          <div className="party-actions">
            {state.party.code ? (
              <p className="party-code">
                {t("party.inviteCode", { code: state.party.code })}
              </p>
            ) : (
              <button
                className="secondary-action session-action"
                type="button"
                onClick={onGenerateCode}
                disabled={busy}
              >
                {t("party.getCode")}
              </button>
            )}
            <button
              className="secondary-action session-action"
              type="button"
              onClick={onLeave}
              disabled={busy}
            >
              {t("party.leave")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
