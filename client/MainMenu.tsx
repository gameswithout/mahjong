import { useEffect, useRef, useState, type ReactNode } from "react";
import { JourneyPreviewProvider } from "./journey-preview-context";
import { translateSource as tr } from "./i18n";

export type MenuTab = "journey" | "inventory" | "chronicle" | "social" | "store";
const tabs: { id: MenuTab; label: string }[] = [
  { id: "journey", label: "Journey" },
  { id: "inventory", label: "Inventory" },
  { id: "chronicle", label: "Chronicle" },
  { id: "social", label: "Party" },
  { id: "store", label: "Store" },
];

export function MainMenuTabs({ journey, inventory, chronicle, social, store, onSelect }: {
  journey: ReactNode;
  inventory?: ReactNode;
  chronicle?: ReactNode;
  social: ReactNode;
  store: ReactNode;
  onSelect?: (tab: MenuTab) => void;
}) {
  const [selected, setSelected] = useState<MenuTab>("journey");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (id: MenuTab) => { setSelected(id); onSelect?.(id); };
  return <JourneyPreviewProvider><section className="main-menu-explore" aria-label={tr("Explore Mahjong")}>
    <div className="main-menu-tabs" role="tablist" aria-orientation="horizontal" aria-label={tr("Main menu sections")}>
      {tabs.map((tab, index) => <button key={tab.id} ref={(node) => { refs.current[index] = node; }} type="button" role="tab"
        id={`menu-tab-${tab.id}`} aria-controls={`menu-panel-${tab.id}`} aria-selected={selected === tab.id}
        tabIndex={selected === tab.id ? 0 : -1} onClick={() => select(tab.id)}
        onKeyDown={(event) => {
          const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
          const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : delta ? (index + delta + tabs.length) % tabs.length : -1;
          if (next < 0) return;
          event.preventDefault(); select(tabs[next].id); refs.current[next]?.focus();
        }}>{tr(tab.label)}</button>)}
    </div>
    {tabs.map((tab) => <div key={tab.id} role="tabpanel" id={`menu-panel-${tab.id}`} aria-labelledby={`menu-tab-${tab.id}`}
      hidden={selected !== tab.id} tabIndex={0} className="main-menu-tab-content">
      {{ journey, inventory, chronicle, social, store }[tab.id]}
    </div>)}
  </section></JourneyPreviewProvider>;
}

export function MenuIcon({ name }: { name: "settings" | "mail" | "edit" }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "mail" ? <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></> : name === "edit" ? <><path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z" /></> : <><path d="m9 3-.6 3-2 .9-2.7-.9-2 3.5L4 11v2l-2.3 1.5 2 3.5 2.7-.9 2 .9.6 3h6l.6-3 2-.9 2.7.9 2-3.5L20 13v-2l2.3-1.5-2-3.5-2.7.9-2-.9L15 3z" /><circle cx="12" cy="12" r="3" /></>}
  </svg>;
}

export function MainMenuProfile({ badge, editor, open: controlledOpen, onOpenChange }: { badge: ReactNode; editor: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) {
      const dialog = dialogRef.current;
      if (dialog?.showModal) dialog.showModal();
      else dialog?.setAttribute("open", "");
      return () => triggerRef.current?.focus();
    }
  }, [open]);
  return <div className="main-menu-profile">
    {badge}
    <button ref={triggerRef} type="button" className="menu-icon-button" aria-label={tr("Edit player profile")} onClick={() => setOpen(true)}><MenuIcon name="edit" /></button>
    {open && <dialog ref={dialogRef} className="menu-profile-dialog" aria-label={tr("Edit player profile")} onClose={() => setOpen(false)} onCancel={() => setOpen(false)}>
      <button type="button" className="menu-icon-button profile-overlay-close" aria-label={tr("Close profile editor")} autoFocus onClick={() => setOpen(false)}>×</button>
      {editor}
    </dialog>}
  </div>;
}

export function MainMenuHeader({ profile, onSettings, connection = "connected", unreadCount = 0 }: {
  profile: ReactNode;
  onSettings: () => void;
  connection?: "connected" | "connecting" | "reconnecting";
  unreadCount?: number;
}) {
  const unread = Math.max(0, Math.floor(unreadCount));
  return <header className="main-menu-header">
    <div className="main-menu-brand"><span aria-hidden="true" data-artwork-id="menu-brand-mark">中</span><div><strong>{tr("Mahjong")}</strong><small role={connection !== "connected" ? "status" : undefined}>{tr(connection === "connecting" ? "Connecting…" : connection === "reconnecting" ? "Reconnecting…" : "Take your seat.")}</small></div></div>
    <nav aria-label={tr("Player menu")}>
      <button className="menu-icon-button" type="button" onClick={onSettings} aria-label={tr("Settings")}><MenuIcon name="settings" /></button>
      <details className="menu-notifications"><summary className="menu-icon-button" aria-label={`${tr("Notifications")}: ${unread} ${tr("unread")}`}><MenuIcon name="mail" /><span className="menu-unread-count" aria-hidden="true">{unread > 99 ? "99+" : unread}</span></summary><div><strong>{tr("Notifications")}</strong><p>{tr("Notifications and messages are coming later.")}</p></div></details>
      {profile}
    </nav>
  </header>;
}

export function MainMenuAdPlaceholder() {
  return <footer className="main-menu-ad-footer" aria-label={tr("Advertisement placeholder")}>
    <p className="main-menu-ad-label">{tr("Advertisement")}</p>
    <div className="main-menu-ad-frame">
      <span>{tr("Ad space placeholder")}</span>
      <small className="ad-size-desktop">728 × 90</small>
      <small className="ad-size-mobile">320 × 100</small>
    </div>
  </footer>;
}
