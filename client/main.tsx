import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { LanguageSelector } from "./i18n/LanguageSelector";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageSelector />
    <App />
  </StrictMode>,
);
