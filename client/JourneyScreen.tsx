import { MatchHistoryTable, displayMatchMode } from "./MatchHistoryTable";
import type { MatchHistoryEntry } from "./match-history";
import { SIMULATED_HIGHLIGHTS, simulationJourney, simulationTiles, useProgressionSimulation } from "./progression-simulator";
import { useEffect, useRef, useState } from "react";
import type { PlayerJourney, PlayerProgression } from "../protocol/envelope";
import type { PlayerStatSummary } from "./player-stats";
import type { PlayerProfileConfig } from "./player-profile";
import { TileFace } from "./TileFace";
import { useJourneyPreviewDraft } from "./journey-preview-context";
import { PlayerProfileBadge } from "./PlayerProfile";
import { formatNumber, t, translateSource as tr } from "./i18n";
import {
  CHRONICLE_STAGES, DEFAULT_SHOWCASE_CAPACITY,
  SKILL_CANDIDATES, chronicleStage, legacyAchievements,
  prestigeProgress, publicProfilePreview, selectShowcase,
  type JourneyAchievement, type JourneyCollection, type JourneyCosmetic,
} from "./journey-model";

export interface JourneyScreenProps {
  journey?: PlayerJourney;
  matches?: readonly MatchHistoryEntry[];
  historyStatus?: "loading" | "ready" | "error";
  onRetryHistory?: () => void;
  view?: "journey" | "inventory" | "chronicle";
  progression?: PlayerProgression;
  profile?: PlayerProfileConfig;
  statistics?: PlayerStatSummary;
  inventory?: readonly JourneyCosmetic[];
  inventoryStatus?: "loading" | "ready" | "error";
  loadState?: "loading" | "ready" | "error";
  onRetry?: () => void;
  onRefreshInventory?: () => void;
  onCustomize?: () => void;
  embedded?: boolean;
  onClose: () => void;
}

const number = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) ? formatNumber(value) : "—";

export function JourneyScreen({ view = "journey", journey, matches = [], historyStatus = "ready", onRetryHistory, profile, statistics, inventory, inventoryStatus = "ready", loadState = "ready", onRetry, onRefreshInventory, onCustomize, onClose, embedded = false }: JourneyScreenProps) {
  const simulation = useProgressionSimulation();
  if (simulation) {
    journey = simulationJourney(simulation);
    inventory = simulationTiles(simulation).map((tile) => ({ id: tile.id, name: tile.label, type: "profile_tile", source: "Achievement simulation", owned: true, compatibleDisplays: ["showcase"] }));
    loadState = "ready"; inventoryStatus = "ready";
    matches = simulation.matches; historyStatus = "ready";
  }
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const selectedMatch = matches.find((match) => match.matchId === selectedMatchId);
  useEffect(() => {
    if (selectedMatch) document.getElementById("journey-match-detail")?.focus();
  }, [selectedMatch]);
  const [chapter, setChapter] = useState<number | null>(null);
  const [collection, setCollection] = useState<JourneyCollection>("legacy");
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!previewOpen) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const dialog = previewDialog.current;
    if (dialog?.showModal) dialog.showModal(); else dialog?.setAttribute("open", "");
    return () => returnFocus?.focus();
  }, [previewOpen]);
  const [showcased, setShowcased] = useJourneyPreviewDraft();
  const [cosmeticType, setCosmeticType] = useState("all");
  const [cosmeticSource, setCosmeticSource] = useState("all");
  const [showcaseError, setShowcaseError] = useState("");
  const progress = journey ? prestigeProgress(journey) : undefined;
  const games = journey?.completed_rotations;
  const { earned = [], steps = [], current, next } = progress ?? {};
  const selected = earned.find((step) => step.games === chapter) ?? current;
  const selectedStage = chronicleStage(selected ? steps.indexOf(selected) : -1);
  const currentStage = chronicleStage(earned.length - 1);
  const upcomingStage = CHRONICLE_STAGES.find((stage) => stage.milestoneIndex > earned.length - 1 && steps[stage.milestoneIndex]);
  const achievements = journey ? legacyAchievements(journey) : [];
  const preview = journey ? publicProfilePreview(profile, journey, inventory ?? [], showcased) : undefined;
  const owned = (inventory ?? []).filter((item) => item.owned === true);
  const filtered = owned.filter((item) => (cosmeticType === "all" || item.type === cosmeticType) && (cosmeticSource === "all" || item.source === cosmeticSource));
  const title = view === "inventory" ? "Inventory" : view === "chronicle" ? "Chronicle" : "My Mahjong Journey";
  const titleId = view === "journey" ? "journey-title" : `${view}-title`;
  const previewId = `${view}-public-preview`;
  const Root = embedded ? "section" : "main";

  function toggleShowcase(id: string) {
    try { setShowcased(selectShowcase(showcased, id, inventory ?? [])); setShowcaseError(""); }
    catch (error) { setShowcaseError(error instanceof Error ? error.message : "Showcase selection is unavailable."); }
  }

  return <Root className={`journey-screen${embedded ? " journey-embedded" : ""}`} aria-labelledby={titleId} data-journey-view={view} aria-busy={loadState === "loading" && view !== "inventory"}>
    <header className="journey-header">
      <div><p className="status-label">{tr("Your place at the table")}</p><h1 id={titleId}>{tr(title)}</h1></div>
      {!embedded && <button className="secondary-action" onClick={onClose}>{t("progression.back")}</button>}
    </header>
    <p className="journey-intro">{tr(view === "inventory" ? "Your collection. Choose what you bring to the table." : view === "chronicle" ? "Your Mahjong home and the story you share." : "Your history, your achievements, your place in Mahjong. At your own pace.")}</p>
    {loadState === "loading" && view !== "inventory" ? <div className="journey-empty" role="status">{tr("Loading your Journey…")}</div> : <>
      {view === "journey" && <>
      {simulation && <p role="status">Local progression simulation · placeholder rewards and draft rating</p>}
      {loadState === "error" && <p role="alert">Saved progress could not be loaded. {onRetry && <button className="text-action" onClick={onRetry}>Retry Journey</button>}</p>}
      <section className="journey-overview journey-scoreboard" aria-label={tr("Journey overview")}>
        <JourneyScoreCard title="Legacy" kpi={number(games)} unit="completed rotations"
          highlight={current?.title ?? "Your first seat awaits"}
          action={next ? `Next: ${next.title} · ${number(Math.max(0, next.games - (games ?? 0)))} rotations to go` : "View Prestige achievements"} onAction={() => { setCollection("legacy"); document.getElementById("journey-collections-title")?.scrollIntoView?.({ behavior: "smooth" }); }}
          explanation="Dedication and longevity: completed rotations build Prestige titles and your Living Chronicle. Anniversary and Community achievements also belong to Legacy." />
        <JourneyScoreCard title="Skill" kpi={simulation ? number(simulation.elo) : "—"} unit="Elo" highlight={simulation ? "Preview rating" : "Unrated"}
          action={simulation?.rankedWins ? "Next: explore Ranked achievement goals" : "Next: First Ranked Victory"} onAction={() => { setCollection("skill"); document.getElementById("journey-collections-title")?.scrollIntoView?.({ behavior: "smooth" }); }}
          explanation="Build your competitive record in Ranked. Ratings will appear when Ranked is available." />
        <JourneyScoreCard title="Highlights" kpi={simulation ? number(new Set(simulation.highlights.map((event) => event.id)).size) : "—"} unit={simulation ? "sample achievements" : "verified moments"} highlight={simulation?.highlights.length ? SIMULATED_HIGHLIGHTS.find((item) => item.id === simulation.highlights.at(-1)?.id)?.name ?? "Your extraordinary moments" : "Your extraordinary moments"}
          action="Explore Highlight achievements" onAction={() => { setCollection("highlights"); document.getElementById("journey-collections-title")?.scrollIntoView?.({ behavior: "smooth" }); }}
          explanation={simulation ? "Random sample Highlights from simulated rotations. Names, frequency, and eligibility are provisional; these are not verified game events." : "Commemorate extraordinary hands, high Tai, and unusual Mahjong feats. Verified Highlight tracking and achievement definitions are still being designed."} />
      </section>
      <p className="journey-note">Legacy celebrates dedication and longevity. Skill recognizes competitive performance. Highlights commemorate extraordinary Mahjong moments.</p>
      </>}
      {view === "chronicle" && <section className="journey-section" aria-labelledby="journey-chronicle-title">
        <div className="journey-section-heading"><div><p className="status-label">{tr("Your Mahjong home")}</p><h2 id="journey-chronicle-title">{tr("Living Mahjong Chronicle")}</h2></div><div className="journey-owner-actions">
          {onCustomize && <button className="secondary-action" onClick={onCustomize}>{tr("Customize identity")}</button>}
          <button className="secondary-action" disabled={!journey} aria-expanded={previewOpen} aria-controls={previewId} onClick={() => setPreviewOpen(!previewOpen)}>{tr(previewOpen ? "Close profile preview" : "Preview public profile")}</button>
        </div></div>
        <div className="journey-chronicle-layout">
          <ChronicleIllustration stage={selectedStage?.artworkStage ?? 0} title={selectedStage?.title} />
          <div className="journey-chronicle-copy"><span className="status-label">{tr(selected && selected !== current ? "Viewing an earned chapter" : "Your earned chapter")}</span><h3>{tr(selectedStage?.title ?? "A story waiting to begin")}</h3>
            <p>{tr("A Mahjong home that grows with every milestone.")}</p>
            <p>{tr("Your current chapter")}: <strong>{tr(currentStage?.title ?? "Awaiting your first rotation")}</strong></p>
            {upcomingStage && <p>{tr("Next chapter")}: {tr(upcomingStage.title)} · {number(steps[upcomingStage.milestoneIndex].games)} {tr("completed games")}</p>}
            <small>{tr("Four illustrated stages are planned. Chapter mapping and artwork are provisional. Cosmetics cannot unlock higher stages.")}</small>
          </div>
        </div>
        <ol className="journey-chapters">{steps.map((step) => <li key={step.games} className={journey && journey.completed_rotations >= step.games ? "is-earned" : ""}>
          <button disabled={!journey || journey.completed_rotations < step.games} aria-pressed={selected?.games === step.games} onClick={() => setChapter(step.games)}>
            <span>{number(step.games)} {tr("games")}</span><strong>{tr(step.title)}</strong><span>{tr(chronicleStage(steps.indexOf(step))?.title ?? step.chapter)}</span><small>{tr(journey && journey.completed_rotations >= step.games ? "Unlocked · view chapter" : "Chapter ahead")}</small>
          </button>
        </li>)}</ol>
        <p className="journey-note">{tr("One game is a completed full dealer rotation. Ranked, Casual, and bot-supported games count equally. Wins and losses both count; incomplete rotations and individual hands do not.")}</p>
        <section className="journey-section" aria-labelledby="chronicle-showcase-title"><h2 id="chronicle-showcase-title">{tr("Customize your showcase")}</h2>
          <p>{tr("Choose owned cosmetics for your public-facing Mahjong home. These choices are independent of gameplay equipment.")}</p>
          {inventoryStatus === "loading" ? <p role="status">{tr("Loading your connected collection…")}</p> : inventoryStatus === "error" ? <p role="alert">{tr("Your collection could not be verified. Refresh Inventory to try again.")}</p> : <div className="journey-achievement-grid">{owned.filter((item) => item.compatibleDisplays.includes("showcase")).map((item) => <article className="journey-cosmetic" key={item.id}><h3>{tr(item.name)}</h3><p>{tr(item.source)}</p><button className="secondary-action" aria-pressed={preview?.showcasedCosmetics.some((selected) => selected.id === item.id) ?? false} onClick={() => toggleShowcase(item.id)}>{tr(preview?.showcasedCosmetics.some((selected) => selected.id === item.id) ? "Remove from preview" : "Showcase in preview")}</button></article>)}</div>}
          {!owned.length && inventoryStatus === "ready" && <p className="journey-muted">{tr("Owned, compatible cosmetics will appear here when your collection is connected.")}</p>}
          {showcaseError && <p role="alert">{tr(showcaseError)}</p>}
          <p className="journey-muted">{tr("Showcase selections are a private preview only and are not saved or published.")} {tr("Temporary showcase capacity")}: {DEFAULT_SHOWCASE_CAPACITY}.</p>
          <button className="secondary-action" disabled={!journey} onClick={() => setPreviewOpen(true)}>{tr("Preview showcase")}</button>
        </section>
      </section>}

      {view === "journey" && <>
      <section className="journey-section" aria-labelledby="journey-collections-title">
        <div className="journey-section-heading"><div><p className="status-label">{tr("What makes your story unique")}</p><h2 id="journey-collections-title">{tr("Achievement collections")}</h2></div></div>
        <div className="journey-collection-tabs" role="tablist" aria-label={tr("Achievement collections")}>
          {(["legacy", "skill", "highlights"] as const).map((id, index, all) => <button key={id} id={`journey-collection-${id}`} role="tab" aria-selected={collection === id} aria-controls={`journey-collection-panel-${id}`} tabIndex={collection === id ? 0 : -1} onClick={() => setCollection(id)} onKeyDown={(event) => {
            const nextIndex = event.key === "ArrowRight" ? (index + 1) % all.length : event.key === "ArrowLeft" ? (index + all.length - 1) % all.length : event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 : -1;
            if (nextIndex < 0) return; event.preventDefault(); setCollection(all[nextIndex]); document.getElementById(`journey-collection-${all[nextIndex]}`)?.focus();
          }}>{tr(id === "legacy" ? "Legacy" : id === "skill" ? "Skill" : "Highlights")}</button>)}
        </div>
        {(["legacy", "skill", "highlights"] as const).map((id) => <div key={id} role="tabpanel" id={`journey-collection-panel-${id}`} aria-labelledby={`journey-collection-${id}`} hidden={collection !== id} tabIndex={0}>
          {id === "legacy" ? <>{["Games Played", "Anniversaries", "Community"].map((category) => <section className="journey-achievement-group" key={category}><h3>{tr(category)}</h3>
            <div className="journey-achievement-grid">{achievements.filter((item) => item.category === category).filter((item, index, all) => category !== "Anniversaries" || index === all.length - 1).map((item) => <AchievementCard key={item.id} achievement={item} />)}</div>
            {category === "Games Played" && !achievements.length && <p className="journey-muted">{tr("Verified rotation progress is not available yet.")}</p>}
            {category === "Anniversaries" && !journey?.anniversaries.length && <p className="journey-muted">{tr("Annual badges unlock automatically from your first completed rotation, with material-themed cosmetics at major anniversaries. No activity or login streak is required.")}</p>}
            {category === "Community" && !journey && <p className="journey-muted">{tr("Friend of Mahjong recognizes three verified referrals. Tracking is not connected yet.")}</p>}
          </section>)}</> : id === "skill" ? <><div className="journey-empty"><strong>{tr("Your competitive story is ahead")}</strong><p>{tr("Ranked progression is separate from Legacy. Current ratings may fall; personal peaks will remain.")}</p></div>
            <details className="journey-candidate-definitions"><summary>{tr("Proposed Skill achievements · not active")}</summary><p>{tr("These are candidates for review. No unlocks or rewards are issued for them.")}</p><div className="journey-achievement-grid">{SKILL_CANDIDATES.map((item) => <AchievementCard key={item.id} achievement={item} />)}</div></details>
          </> : simulation ? <><p>Simulation only · provisional achievement examples. A rotation can contain a memorable hand even when you lose overall.</p><div className="journey-achievement-grid">{SIMULATED_HIGHLIGHTS.map((definition) => {
            const events = simulation.highlights.filter((event) => event.id === definition.id);
            const latest = events.at(-1);
            return <article className={`journey-achievement-card ${events.length ? "is-earned" : ""}`} key={definition.id}>
              <small>{events.length ? "Unlocked · simulation" : "Not yet simulated"}</small><h4>{definition.name}</h4><p>{definition.description}</p>
              {latest && <><span className="achievement-tile-face">{definition.name}</span><p>{events.length} sample moments · latest rotation {latest.rotation} · {displayMatchMode(latest.mode)} · {latest.humanSeats} humans · {latest.botSeats} Bots</p><p>Placeholder profile tile unlocked · equip it in your profile editor.</p><ul>{events.map((event) => <li key={event.matchId}><button className="text-action" onClick={() => setSelectedMatchId(event.matchId)}>View match · rotation {event.rotation}</button></li>)}</ul></>}
            </article>;
          })}</div></> : <div className="journey-empty"><strong>{tr("Memorable hands belong here")}</strong><p>{tr("Verified Highlights will include the hand, Tai, game mode, and human/Bot composition. Personal recognition can include bot-supported play.")}</p><p>{tr("No verified Highlight records are available from the connected service. Pattern eligibility and rarity are still being designed.")}</p></div>}
        </div>)}
      </section>

      <section className="journey-section" aria-labelledby="journey-records-title"><p className="status-label">{tr("Your own benchmarks")}</p><h2 id="journey-records-title">{tr("Personal records")}</h2>
        <dl className="journey-records"><Record label="Completed rotations" value={number(games)} /><Record label="Completed hands" value={number(statistics?.handsPlayed)} /><Record label="Highest recorded Tai" value={statistics?.hasPlayed && statistics.bestHandTai > 0 ? number(statistics.bestHandTai) : "—"} /><Record label="Current Elo" value="—" /><Record label="Peak Elo" value="—" /><Record label="Highest Ranked tier" value="—" /></dl>
        <small>{tr("Only connected, authoritative records are shown. A dash means unavailable, not zero. Completed hands are tracked separately from full rotations.")}</small>
      </section>

      <section className="journey-section" aria-labelledby="journey-history-title"><h2 id="journey-history-title">{tr("Match History")}</h2>
        {simulation && <p>Sample matches · simulation only. Tai is a generated sample hand value, independent of the rotation result.</p>}
        {historyStatus === "loading" ? <p role="status">Loading match history…</p> : historyStatus === "error" ? <p role="alert">Match history could not be loaded. {onRetryHistory && <button className="text-action" onClick={onRetryHistory}>Retry match history</button>}</p> : <MatchHistoryTable matches={matches} onSelect={setSelectedMatchId} />}
        {!simulation && <small>Recorded matches may include individual hands. Only completed full dealer rotations advance Prestige.</small>}
        {selectedMatch && <article id="journey-match-detail" tabIndex={-1} className="journey-match-detail" aria-label="Match details"><h3>Match {selectedMatch.matchId}</h3><p>{displayMatchMode(selectedMatch.mode)} · {selectedMatch.result} · {selectedMatch.rawTai} Tai</p><time dateTime={selectedMatch.completedAt}>{new Date(selectedMatch.completedAt).toLocaleString()}</time>
          {simulation && <><p>Sample completed rotation · simulation only</p><h4>Highlights from this match</h4><ul>{simulation.highlights.filter((event) => event.matchId === selectedMatch.matchId).map((event) => <li key={event.id}>{SIMULATED_HIGHLIGHTS.find((definition) => definition.id === event.id)?.name}</li>)}</ul></>}
          <button className="text-action" onClick={() => setSelectedMatchId(null)}>Close match details</button>
        </article>}
      </section>

      </>}
      {view === "inventory" && <section className="journey-section" aria-labelledby="journey-cosmetics-title"><div className="journey-section-heading"><div><p className="status-label">{tr("Owned, equipped, showcased")}</p><h2 id="journey-cosmetics-title">{tr("Cosmetic collection")}</h2></div>{onRefreshInventory && <button className="secondary-action" onClick={onRefreshInventory}>{tr("Refresh collection")}</button>}</div>
        <p>{tr("Browse your owned cosmetics and manage your gameplay identity. Public display choices live in Chronicle.")}</p>
        {inventoryStatus === "loading" ? <p role="status">{tr("Loading your connected collection…")}</p> : inventoryStatus === "error" ? <p role="alert">{tr("Your collection could not be verified. Refresh to try again.")}</p> : !inventory ? <p className="journey-empty">{tr("The cosmetic inventory service is not connected yet. No ownership is inferred from XP or anniversary eligibility.")}</p> : <>
          <div className="journey-cosmetic-filters"><label>{tr("Type")}<select value={cosmeticType} onChange={(event) => setCosmeticType(event.target.value)}><option value="all">{tr("All types")}</option>{[...new Set(owned.map((item) => item.type))].map((type) => <option key={type} value={type}>{tr(type.replaceAll("_", " "))}</option>)}</select></label>
            <label>{tr("Source")}<select value={cosmeticSource} onChange={(event) => setCosmeticSource(event.target.value)}><option value="all">{tr("All sources")}</option>{[...new Set(owned.map((item) => item.source))].map((source) => <option key={source} value={source}>{tr(source)}</option>)}</select></label>
          </div>
          <div className="journey-achievement-grid">{filtered.map((item) => <article className="journey-cosmetic" key={item.id}><span className="journey-cosmetic-placeholder" aria-hidden="true" data-artwork-id={`cosmetic-${item.id}`}>{item.id === "founder-og" ? <TileFace id="founder-og" size="sm" /> : <span className="achievement-tile-face">{item.name}</span>}</span><h3>{tr(item.name)}</h3><p>{tr(item.source)} · {tr(item.type.replaceAll("_", " "))}</p><span>{tr(simulation ? "Unlocked · simulation placeholder" : "Owned · verified entitlement")}</span>
            {onCustomize && item.type === "profile_tile" && <button className="secondary-action" onClick={onCustomize}>{tr("Use in gameplay profile")}</button>}
          </article>)}</div>
          {!filtered.length && <p className="journey-empty">{tr("No cosmetics match the connected collection and filters.")}</p>}
        </>}
        {onCustomize && <button className="secondary-action" onClick={onCustomize}>{tr("Edit gameplay profile")}</button>}
      </section>}
      {previewOpen && preview && <dialog ref={previewDialog} className="journey-public-preview" id={previewId} aria-labelledby={`${previewId}-title`} onClose={() => setPreviewOpen(false)} onCancel={() => setPreviewOpen(false)}>
        <button className="secondary-action journey-preview-close" autoFocus onClick={() => setPreviewOpen(false)}>{tr("Close preview")}</button><p className="status-label">{tr("Owner preview · not published")}</p><h2 id={`${previewId}-title`}>{tr("Public profile preview")}</h2>
        {profile ? <PlayerProfileBadge profile={{ nickname: preview.displayName, tileSlotIds: profile.tileSlotIds }} /> : <h3>{preview.displayName}</h3>}
        <p>{tr(preview.prestigeTitle ?? "A Mahjong story waiting to begin")}</p><ChronicleIllustration stage={currentStage?.artworkStage ?? 0} title={preview.chronicleTitle} />
        <h3>{tr("Cosmetic showcase")}</h3><ol className="journey-showcase-slots" aria-label={tr("Cosmetic showcase slots")}>{Array.from({ length: DEFAULT_SHOWCASE_CAPACITY }, (_, index) => {
          const item = preview.showcasedCosmetics[index];
          return <li key={index}><span aria-hidden="true">{item?.id === "founder-og" ? <TileFace id="founder-og" size="sm" /> : item ? "◇" : "+"}</span><strong>{item ? tr(item.name) : `${tr("Empty slot")} ${index + 1}`}</strong></li>;
        })}</ol>{!preview.showcasedCosmetics.length && <p>{tr("Select owned cosmetics above to preview your showcase.")}</p>}
        <p>{tr("Public links, visibility settings, saved showcases, and featured Highlights need the public profile service. This preview is visible only here.")}</p>
      </dialog>}
    </>}
  </Root>;
}

function Record({ label, value }: { label: string; value: string }) {
  return <div><dt>{tr(label)}</dt><dd>{tr(value)}</dd></div>;
}

export function ChronicleIllustration({ stage, title }: { stage: number; title?: string }) {
  return <div className="journey-chronicle" data-chapter={stage} data-artwork-id={`chronicle-${String(stage).padStart(2, "0")}`}>
    <div className="chronicle-room" role="img" aria-label={tr(title ? `Living Chronicle: ${title}` : "An empty Mahjong room awaiting your first completed rotation")}>
      <span className="chronicle-window" /><span className="chronicle-table">中</span>
      {stage >= 1 && <span className="chronicle-chair" aria-hidden="true" />}
      {stage >= 2 && <span className="chronicle-tea" aria-hidden="true">茶</span>}
      {stage >= 4 && <><span className="chronicle-shelf" aria-hidden="true">一 二 三</span><span className="chronicle-scroll" aria-hidden="true">和</span></>}
      {stage >= 7 && <><span className="chronicle-plant" aria-hidden="true">竹</span><span className="chronicle-lantern" aria-hidden="true">福</span><span className="chronicle-keepsake" aria-hidden="true">發</span></>}
    </div><p className="artwork-placeholder-note">{tr("Illustration placeholder")}</p>
  </div>;
}

export function AchievementCard({ achievement: item }: { achievement: JourneyAchievement }) {
  const status = item.status === "proposed" ? "Proposed · not active" : item.unlocked ? "Unlocked" : item.unavailableReason ? "Tracking unavailable" : "Locked";
  return <article className={`journey-achievement-card ${item.unlocked ? "is-earned" : ""}`} data-definition-status={item.status}>
    <div className="journey-achievement-state"><span aria-hidden="true" data-artwork-id={`achievement-${item.id}`}>{item.unlocked ? "◆" : "◇"}</span><small>{tr(status)}</small></div>
    <h4>{tr(item.name)}</h4><p>{tr(item.description)}</p>
    {item.current !== undefined && item.target !== undefined && <><progress max={item.target} value={Math.min(item.current, item.target)} aria-label={tr(`${item.name} progress`)} /><p className="journey-achievement-progress">{number(Math.min(item.current, item.target))} / {number(item.target)}</p></>}
    {item.unavailableReason && <p className="journey-muted">{tr(item.unavailableReason)}</p>}
    <details><summary>{tr("Achievement details")}</summary>
      {item.unlocked && <p>{item.unlockedAt ? <>{tr("Unlocked")}: <time dateTime={item.unlockedAt}>{item.unlockedAt.slice(0, 10)}</time></> : tr("Unlock date not recorded")}</p>}
      {item.reward && <p>{tr("Recognition")}: {tr(item.reward)}</p>}
      {item.provenance && <p>{tr(item.provenance.mode)} · {item.provenance.humanSeats} {tr("humans")} · {item.provenance.botSeats} {tr("Bots")}</p>}
    </details>
  </article>;
}

function JourneyScoreCard({ title, kpi, unit, highlight, explanation, action, onAction }: { title: string; kpi: string; unit: string; highlight: string; explanation: string; action: string; onAction: () => void }) {
  return <article className={`journey-score-card journey-score-${title.toLowerCase()}`} aria-label={tr(title)}>
    <h2>{tr(title)}</h2>
    <p className="journey-score-kpi"><strong>{kpi}</strong>{" "}<span>{tr(unit)}</span></p>
    <p className="journey-score-highlight">{tr(highlight)}</p>
    <p className="journey-score-explanation">{tr(explanation)}</p>
    <button className="secondary-action" onClick={onAction}>{tr(action)}</button>
  </article>;
}
