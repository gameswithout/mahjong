import { useState } from "react";
import { createRoot } from "react-dom/client";
import { NeoExperience, neoStorageKey } from "./NeoExperience";
import { GameModeMenu } from "./GameModeMenu";
import "./styles.css";
function Preview() {
  const [epoch,setEpoch]=useState(0);
  const [realGame,setRealGame]=useState(false);
  return <main className="journey-screen"><button className="text-action" onClick={()=>{localStorage.removeItem(neoStorageKey("neo-preview"));setRealGame(false);setEpoch(epoch+1);}}>Reset walkthrough</button>
    {realGame ? <><h1>Real Unranked play</h1><p>This preview does not create live matches.</p><a href={import.meta.env.BASE_URL}>Open the game</a></> : <NeoExperience key={epoch} userId="neo-preview" onPlayUnranked={()=>setRealGame(true)}>{({openRanked,playUnranked})=><><h1>Take your seat.</h1><GameModeMenu onPlayUnranked={playUnranked} onPlayRanked={openRanked} rankedUnavailable rankedStatus="Ranked is not available yet." /></>}</NeoExperience>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
