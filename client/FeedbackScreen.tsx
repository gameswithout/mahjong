import { useState, type FormEvent } from "react";

import type { FeedbackCategory, PlayerFeedback } from "./feedback";

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
            <p className="status-label">Help improve Mahjong</p>
            <h1 id="feedback-title">{sessionId ? "Report Issues" : "Submit Feedback"}</h1>
          </div>
          <button type="button" className="secondary-action" onClick={onClose}>Close</button>
        </header>

        {status === "sent" ? (
          <div className="feedback-success" role="status">
            <h2>Thank you</h2>
            <p>Your feedback was saved with your account for review.</p>
            {sessionId && <p>Session <code>{sessionId}</code> was attached automatically.</p>}
            <button type="button" className="primary-action" onClick={onClose}>Done</button>
          </div>
        ) : (
          <form className="feedback-form" onSubmit={(event) => void submit(event)}>
            {sessionId && (
              <label>
                Session ID
                <input value={sessionId} readOnly />
              </label>
            )}
            <label>
              Category
              <select value={category} onChange={(event) => setCategory(event.target.value as FeedbackCategory)}>
                <option value="gameplay">Gameplay</option>
                <option value="connection">Connection or loading</option>
                <option value="ui">UI or readability</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Short summary
              <input
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label>
              What happened?
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
                Feedback could not be saved. Please try again.
              </p>
            )}
            <button className="primary-action" type="submit" disabled={status === "submitting"}>
              {status === "submitting" ? "Submitting…" : "Submit"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
