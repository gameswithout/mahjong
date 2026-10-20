import { useState } from "react";
import { createRoot } from "react-dom/client";
import { NeoExperience, neoStorageKey } from "./NeoExperience";
import { GameModeMenu } from "./GameModeMenu";
import { MainMenuHeader, MainMenuProfile, MainMenuTabs } from "./MainMenu";
import { PlayerProfileBadge, PlayerProfileEditor } from "./PlayerProfile";
import { defaultPlayerProfile } from "./player-profile";
import { AnalyticsConsentCard } from "./AnalyticsConsentCard";
import { JourneyScreen } from "./JourneyScreen";
import "./styles.css";
function Preview() {
  const [profile, setProfile] = useState(() => defaultPlayerProfile(true));
  const [privacyPending, setPrivacyPending] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const [realGame, setRealGame] = useState(false);
  return <main className="bootstrap-shell"><section className="bootstrap-card bootstrap-card-lobby">
    <NeoExperience key={epoch} userId="neo-preview" onPlayUnranked={() => setRealGame(true)} nextCta={privacyPending ? <AnalyticsConsentCard onAnswer={() => setPrivacyPending(false)} /> : null} header={<MainMenuHeader onSettings={() => alert("Settings preview — open the game for your saved settings.")} profile={<MainMenuProfile badge={<PlayerProfileBadge profile={profile} />} editor={<PlayerProfileEditor profile={profile} guest onChange={setProfile} />} />} />}>
      {({ openRanked, playUnranked }) => <>
        <div className="main-menu-play"><div className="main-menu-play-heading"><h2>Play Mahjong</h2><div className="main-menu-jade"><span aria-hidden="true">◆</span> <strong>5,000</strong> Jade</div></div>
          <GameModeMenu onPlayUnranked={playUnranked} onPlayRanked={openRanked} rankedUnavailable rankedStatus="Ranked is not available yet." />
          {realGame && <p role="status">This preview does not create live matches. <a href={import.meta.env.BASE_URL}>Open the game</a></p>}
        </div>
        <MainMenuTabs journey={<JourneyScreen embedded onClose={() => undefined} journey={{ completed_rotations: 12, anniversaries: [], prestige: [
          { games: 1, title: "Newcomer", chapter: "First Seat" },
          { games: 10, title: "Table Regular", chapter: "Familiar Table" },
          { games: 50, title: "Familiar Face", chapter: "A Place of Your Own" },
          { games: 100, title: "Mahjong Veteran", chapter: "Veteran’s Room" },
          { games: 500, title: "Table Elder", chapter: "Gathering Place" },
          { games: 1000, title: "Mahjong Luminary", chapter: "Hall of Memories" },
          { games: 5000, title: "Living Legend", chapter: "A Lifetime at the Table" },
        ] }} />} social={<><h2>Friends / Party</h2><p>Friends and party play are coming later. You can play Unranked now.</p></>} store={<><h2>Store</h2><p>Open the game to browse the existing Founder’s Store.</p><a href={import.meta.env.BASE_URL}>Open the game</a></>} />
      </>}
    </NeoExperience>
    <button className="text-action" onClick={() => { localStorage.removeItem(neoStorageKey("neo-preview")); setRealGame(false); setPrivacyPending(true); setEpoch(epoch + 1); }}>Reset walkthrough</button>
    <small>Layout preview · sample Journey and Jade</small>
  </section></main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
