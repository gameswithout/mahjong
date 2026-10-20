import { createRoot } from "react-dom/client";
import { JourneyScreen } from "./JourneyScreen";
import "./styles.css";

// Visual fixture only. Production uses the authenticated server projection.
const games = Number(new URLSearchParams(location.search).get("games") ?? 325);
createRoot(document.getElementById("root")!).render(<JourneyScreen onClose={() => history.back()} journey={{
  completed_rotations: games,
  first_completed_at: games > 0 ? "2020-07-01T12:00:00Z" : undefined,
  anniversaries: games > 0 ? [{ year: 5, earned_at: "2025-07-01", material: "Wood", cosmetic_code: "anniversary-5" }] : [],
  prestige: [
    { games: 1, title: "Newcomer", chapter: "First Seat" },
    { games: 10, title: "Table Regular", chapter: "Familiar Table" },
    { games: 50, title: "Familiar Face", chapter: "A Place of Your Own" },
    { games: 100, title: "Mahjong Veteran", chapter: "Veteran’s Room" },
    { games: 500, title: "Table Elder", chapter: "Gathering Place" },
    { games: 1000, title: "Mahjong Luminary", chapter: "Hall of Memories" },
    { games: 5000, title: "Living Legend", chapter: "A Lifetime at the Table" },
  ],
}} />);
