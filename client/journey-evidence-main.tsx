import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MainMenuTabs } from "./MainMenu";
import { JourneyScreen } from "./JourneyScreen";
import { journeyFixture } from "./fixtures/journey";
import "./styles.css";

function Evidence() {
  const params = new URLSearchParams(location.search);
  const [state, setState] = useState(params.get("state") ?? "populated");
  const fixture = journeyFixture(state === "empty" ? 0 : Number(params.get("games") ?? 325));
  const renderView = (view: "journey" | "inventory" | "chronicle") => <JourneyScreen embedded view={view} {...fixture}
    journey={state === "error" || state === "unavailable" ? undefined : fixture.journey}
    progression={state === "error" || state === "unavailable" ? undefined : fixture.progression}
    loadState={state === "loading" ? "loading" : state === "error" ? "error" : "ready"}
    onRetry={() => setState("populated")} onClose={() => undefined} />;
  return <main className="journey-evidence-shell">
    <aside className="journey-fixture-notice"><strong>Design preview · sample data</strong><p>Nothing here grants XP, Jade, cosmetics, or achievements. Public profile and showcase previews are not published.</p>
      <label>Preview state <select value={state} onChange={(event) => setState(event.target.value)}>{["populated", "empty", "loading", "error", "unavailable"].map((value) => <option key={value}>{value}</option>)}</select></label>
    </aside>
    <MainMenuTabs key={state}
      journey={renderView("journey")}
      inventory={renderView("inventory")}
      chronicle={renderView("chronicle")}
      social={<p>Social preview is available in the main menu.</p>}
      store={<p>Store preview is available in the main menu.</p>}
    />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Evidence />);
