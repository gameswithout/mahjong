import { createRoot } from "react-dom/client";
import { GameModeMenu } from "./GameModeMenu";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<main className="journey-screen"><p className="status-label">Mahjong</p><h1>Take your seat.</h1><GameModeMenu
  onPlayUnranked={() => { window.location.href = "/"; }}
  onPlayRanked={() => {}}
  rankedUnavailable
  rankedStatus="Ranked is not available yet."
/></main>);
