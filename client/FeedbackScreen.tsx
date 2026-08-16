import { useState, type FormEvent } from "react";

import type { FeedbackCategory, PlayerFeedback } from "./feedback";
import { t } from "./i18n";

export function FeedbackScreen({
  sessionId,
  onSubmit,
  onClose,
}: {
  sessionId?: string;
  onSubmit(feedback: PlayerFeedback): Promise<void>;
  onClose(): void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>("gameplay");
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus("submitting");
    try {
      await onSubmit({ category, summary, details, sessionId });
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="feedback-screen" aria-labelledby="feedback-title">
      <section className="feedback-card">
        <header className="feedback-header">
          <div>
            <p className="status-label">{t("feedback.help")}</p>
            <h1 id="feedback-title">
              {sessionId ? t("feedback.report") : t("feedback.submitTitle")}
            </h1>
          </div>
          <button type="button" className="secondary-action" onClick={onClose}>{t("common.close")}</button>
        </header>

        {status === "sent" ? (
          <div className="feedback-success" role="status">
            <h2>{t("feedback.thanks")}</h2>
            <p>{t("feedback.saved")}</p>
            {sessionId && <p>{t("feedback.sessionAttached", { id: sessionId })}</p>}
            <button type="button" className="primary-action" onClick={onClose}>{t("feedback.done")}</button>
          </div>
        ) : (
          <form className="feedback-form" onSubmit={(event) => void submit(event)}>
            {sessionId && (
              <label>
                {t("feedback.sessionId")}
                <input value={sessionId} readOnly />
              </label>
            )}
            <label>
              {t("feedback.category")}
              <select value={category} onChange={(event) => setCategory(event.target.value as FeedbackCategory)}>
                <option value="gameplay">{t("feedback.gameplay")}</option>
                <option value="connection">{t("feedback.connection")}</option>
                <option value="ui">{t("feedback.ui")}</option>
                <option value="other">{t("feedback.other")}</option>
              </select>
            </label>
            <label>
              {t("feedback.summary")}
              <input
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label>
              {t("feedback.details")}
              <textarea
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                rows={7}
                maxLength={4000}
                required
              />
            </label>
            {status === "error" && (
              <p className="feedback-error" role="alert">
                {t("feedback.saveError")}
              </p>
            )}
            <button className="primary-action" type="submit" disabled={status === "submitting"}>
              {status === "submitting" ? t("feedback.submitting") : t("feedback.submit")}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
