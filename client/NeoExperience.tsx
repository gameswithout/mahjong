import { useEffect, useRef, useState, type ReactNode } from "react";
import { translateSource as tr } from "./i18n";

export type NeoPath = "new" | "casual" | "experienced";
export interface NeoRecord {
  path?: NeoPath;
  step: "question" | "tutorial" | "home";
  rankedIntroSeen?: boolean;
}
export const neoStorageKey = (userId: string) => `mahjong.neo.v1:${userId}`;
const isPath = (value: unknown): value is NeoPath => value === "new" || value === "casual" || value === "experienced";

export function readNeo(userId: string): NeoRecord {
  try {
    const value = JSON.parse(localStorage.getItem(neoStorageKey(userId)) ?? "null");
    if (value && isPath(value.path)) {
      // Completed choices from the earlier prototype stay completed. Its
      // unfinished multi-step lessons return to the simpler menu widget.
      const step = value.step === "home" ? "home" : value.step === "tutorial" ? "tutorial" : "question";
      return { path: step === "question" && value.step !== "question" ? undefined : value.path, step, rankedIntroSeen: value.rankedIntroSeen === true };
    }
  } catch { /* Storage failure must not block the main menu. */ }
  return { step: "question" };
}

const descriptions = {
  casual: "You know the rules. Get comfortable with this game's controls and Taiwanese scoring. Unranked is the best place to start.",
  experienced: "You're ready to compete. Start with Ranked for a full dealer rotation against other human players. Unranked is always available too.",
};

export function NeoExperience({ userId, onPlayUnranked, onEvent, children }: {
  userId: string;
  onPlayUnranked: () => void;
  onEvent?: (event: string, path?: NeoPath) => void;
  children: (controls: { openRanked: () => void; playUnranked: () => void }) => ReactNode;
}) {
  const [record, setRecord] = useState<NeoRecord>(() => readNeo(userId));
  const [highlight, setHighlight] = useState<"unranked" | "ranked" | null>(null);
  const [rankedOpen, setRankedOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!highlight) return;
    const card = menuRef.current?.querySelector<HTMLElement>(`[aria-labelledby="${highlight}-title"]`);
    card?.scrollIntoView?.({ block: "nearest" });
    card?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [highlight]);
  const save = (next: NeoRecord) => {
    setRecord(next);
    try { localStorage.setItem(neoStorageKey(userId), JSON.stringify(next)); } catch { /* Keep the current session usable. */ }
  };
  const complete = () => {
    if (!record.path) return;
    save({ ...record, step: "home" });
    onEvent?.("neo_completed", record.path);
  };
  const choose = (path: NeoPath) => {
    save({ ...record, path, step: path === "new" ? "tutorial" : "question" });
    setHighlight(path === "new" ? null : path === "casual" ? "unranked" : "ranked");
    onEvent?.("neo_path_selected", path);
  };
  if (record.step === "tutorial") return <section className="neo-blank" aria-label={tr("Scripted tutorial placeholder")}>
    <button className="secondary-action" onClick={complete}>{tr("Back to main menu")}</button>
  </section>;
  if (rankedOpen) return <RankedPreview introSeen={record.rankedIntroSeen === true}
    onConfirm={() => save({ ...record, rankedIntroSeen: true })} onClose={() => setRankedOpen(false)} />;
  return <div ref={menuRef} className="neo-menu" data-neo-highlight={highlight ?? undefined}>
    {record.step !== "home" && <aside className="neo-familiarity" aria-labelledby="neo-question">
      <h2 id="neo-question">{tr("What is your familiarity with Mahjong?")}</h2>
      <div className="neo-path-actions">
        {(["new", "casual", "experienced"] as const).map((path) => <button key={path} className="secondary-action" aria-pressed={record.path === path} onClick={() => choose(path)}>
          {tr(path === "new" ? "New Player" : path === "casual" ? "Casual Player" : "Experienced Player")}
        </button>)}
      </div>
      {(record.path === "casual" || record.path === "experienced") && <div className="neo-path-description" role="status">
        <p>{tr(descriptions[record.path])}</p>
        <button className="text-action" onClick={complete}>{tr("Got it")}</button>
      </div>}
    </aside>}
    {children({
      playUnranked: () => { complete(); setHighlight(null); onPlayUnranked(); },
      openRanked: () => { complete(); setHighlight(null); setRankedOpen(true); },
    })}
  </div>;
}

function RankedPreview({ introSeen, onConfirm, onClose }: { introSeen: boolean; onConfirm: () => void; onClose: () => void }) {
  const [step, setStep] = useState(introSeen ? "ranked-preview" : "ranked-confirm");
  return <section className="neo-page" aria-labelledby="ranked-preview-title">
    <button className="text-action" onClick={onClose}>{tr("Go to main menu")}</button>
    <h1 id="ranked-preview-title">{tr(step === "ranked-confirm" ? "Before your first Ranked game" : step === "ranked-preview" ? "Your Ranked table" : "Your first competitive result")}</h1>
    {step !== "ranked-confirm" && <p className="neo-placeholder">{tr("Interactive placeholder — sample play only. No Jade, Elo, XP, or achievements are awarded.")}</p>}
    {step === "ranked-confirm" && <><p>{tr("These are the approved Ranked rules. This walkthrough uses a sample match and does not spend Jade.")}</p><ul><li>{tr("100 Jade entry per player; 400 Jade total pool.")}</li><li>{tr("Eligible positive net Tai shares the pool proportionally. A positive result can still pay less than your entry. If all net Tai is zero, entries are refunded.")}</li><li>{tr("Solo matchmaking, four humans, one full dealer rotation. Elo can rise or fall.")}</li><li>{tr("Leaving forfeits payout. Three timed-out turns while connected, or three consecutive qualifying missed opportunities, also cause forfeiture. Disconnects have a three-minute grace period with temporary bot play; reconnect to resume before permanent takeover.")}</li><li>{tr("Forfeits rank below completing players. Cooldowns within seven days are 5 minutes, 15 minutes, 1 hour, then 24 hours. Server outages void the match, refund stakes, and prevent Elo changes.")}</li></ul><button className="primary-action" onClick={() => { onConfirm(); setStep("ranked-preview"); }}>{tr("Enter Ranked preview")}</button><button className="secondary-action" onClick={onClose}>{tr("Choose Unranked instead")}</button></>}
    {step === "ranked-preview" && <><p>{tr("Four human seats. A full dealer rotation. This is a placeholder for matchmaking and competitive play, with no real rating or wallet changes.")}</p><div className="neo-rotation" data-artwork-id="neo-ranked-table-placeholder">{["You", "Player 2", "Player 3", "Player 4"].map((label) => <span key={label}>{tr(label)}</span>)}</div><button className="primary-action" onClick={() => setStep("ranked-result")}>{tr("Complete sample Ranked match")}</button></>}
    {step === "ranked-result" && <><p>{tr("Sample match complete. The final experience will show standings, Tai payouts, Elo changes, and a path into your Skill history in My Mahjong Journey.")}</p><button className="primary-action" onClick={onClose}>{tr("Continue to Mahjong")}</button></>}  </section>;
}
