import { useState } from "react";
import { NeoExperience, neoStorageKey } from "./NeoExperience";
import { GameModeMenu } from "./GameModeMenu";
import { MainMenuAdPlaceholder, MainMenuHeader, MainMenuProfile, MainMenuTabs } from "./MainMenu";
import { PlayerProfileBadge, PlayerProfileEditor } from "./PlayerProfile";
import { defaultPlayerProfile } from "./player-profile";
import { AnalyticsConsentCard } from "./AnalyticsConsentCard";
import { journeyFixture } from "./fixtures/journey";
import { JourneyScreen } from "./JourneyScreen";
export const previewConsentKey = "mahjong.neo-preview.analytics-consent";
function consentPending() {
  try { return !["accepted", "declined"].includes(localStorage.getItem(previewConsentKey) ?? ""); }
  catch { return true; }
}
export function NeoMenuPreview() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [profile, setProfile] = useState(() => defaultPlayerProfile(true));
  const [privacyPending, setPrivacyPending] = useState(consentPending);
  const [epoch, setEpoch] = useState(0);
  const [realGame, setRealGame] = useState(false);
  return <main className="bootstrap-shell"><section className="bootstrap-card bootstrap-card-lobby">
    <NeoExperience key={epoch} userId="neo-preview" onPlayUnranked={() => setRealGame(true)} nextCta={privacyPending ? <AnalyticsConsentCard onAnswer={(enabled) => { try { localStorage.setItem(previewConsentKey, enabled ? "accepted" : "declined"); } catch { /* Remember for this session if storage is unavailable. */ } setPrivacyPending(false); }} /> : null} header={<MainMenuHeader onSettings={() => alert("Settings preview — open the game for your saved settings.")} profile={<MainMenuProfile open={editorOpen} onOpenChange={setEditorOpen} badge={<PlayerProfileBadge profile={profile} />} editor={<PlayerProfileEditor profile={profile} guest founderTileUnlocked onChange={setProfile} />} />} />}>
      {({ openRanked, playUnranked }) => <>
        <div className="main-menu-play"><div className="main-menu-play-heading"><h2>Play Mahjong</h2><div className="main-menu-jade"><span aria-hidden="true">◆</span> <strong>5,000</strong> Jade</div></div>
          <GameModeMenu onPlayUnranked={playUnranked} onPlayRanked={openRanked} rankedUnavailable rankedStatus="Ranked is not available yet." />
          {realGame && <p role="status">This preview does not create live matches. <a href={import.meta.env.BASE_URL}>Open the game</a></p>}
        </div>
        <MainMenuTabs journey={<><p className="journey-fixture-notice">Design preview · sample Journey records</p><JourneyScreen embedded {...journeyFixture(12)} profile={profile} onCustomize={() => setEditorOpen(true)} onClose={() => undefined} /></>} inventory={<JourneyScreen embedded view="inventory" {...journeyFixture(12)} profile={profile} onCustomize={() => setEditorOpen(true)} onClose={() => undefined} />} chronicle={<JourneyScreen embedded view="chronicle" {...journeyFixture(12)} profile={profile} onCustomize={() => setEditorOpen(true)} onClose={() => undefined} />} social={<><h2>Party</h2><p>Friends and party play are coming later. You can play Casual now.</p></>} store={<><h2>Store</h2><p>Open the game to browse the existing Founder’s Store.</p><a href={import.meta.env.BASE_URL}>Open the game</a></>} />
        <MainMenuAdPlaceholder />
      </>}
    </NeoExperience>
    <button className="text-action" onClick={() => { localStorage.removeItem(neoStorageKey("neo-preview")); setRealGame(false); setEpoch(epoch + 1); }}>Replay NEO question</button>
    <small>Layout preview · sample Journey and Jade</small>
  </section></main>;
}
