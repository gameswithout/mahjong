import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

type Draft = [string[], Dispatch<SetStateAction<string[]>>];
const JourneyPreviewContext = createContext<Draft | undefined>(undefined);

// Inventory and Chronicle share an unsaved presentation draft. Equipment and
// server-owned inventory are never changed by this state.
export function JourneyPreviewProvider({ children }: { children: ReactNode }) {
  const draft = useState<string[]>([]);
  return <JourneyPreviewContext.Provider value={draft}>{children}</JourneyPreviewContext.Provider>;
}

export function useJourneyPreviewDraft(): Draft {
  const shared = useContext(JourneyPreviewContext);
  const local = useState<string[]>([]);
  return shared ?? local;
}
