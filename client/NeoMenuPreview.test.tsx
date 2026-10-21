import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { NeoMenuPreview, previewConsentKey } from "./NeoMenuPreview";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup = () => {};
beforeEach(() => localStorage.clear());
afterEach(() => cleanup());
function mount() {
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  act(() => root.render(<NeoMenuPreview />));
  cleanup = () => { act(() => root.unmount()); node.remove(); };
  return { node, click: (label: string) => {
    const button = [...node.querySelectorAll("button")].find((item) => item.textContent === label)!;
    expect(button).toBeTruthy(); act(() => button.click());
  } };
}
for (const answer of ["No thanks", "Share analytics"]) {
  it(`remembers ${answer} across reloads and replays NEO independently`, () => {
    let preview = mount();
    expect(preview.node.querySelector(".neo-familiarity")).not.toBeNull();
    expect(preview.node.querySelector(".analytics-consent-card")).toBeNull();
    preview.click("Not now");
    expect(preview.node.querySelector(".analytics-consent-card")).not.toBeNull();
    preview.click(answer);
    expect(localStorage.getItem(previewConsentKey)).toBe(answer === "No thanks" ? "declined" : "accepted");
    cleanup(); preview = mount();
    expect(preview.node.querySelector(".neo-familiarity")).toBeNull();
    expect(preview.node.querySelector(".analytics-consent-card")).toBeNull();
    preview.click("Replay NEO question");
    expect(preview.node.querySelector(".neo-familiarity")).not.toBeNull();
    preview.click("Casual Player"); preview.click("Got it");
    expect(preview.node.querySelector(".analytics-consent-card")).toBeNull();
  });
}
