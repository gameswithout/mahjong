import { TileFace } from "./TileFace";
import type { FounderPackStatus } from "./store";
import { t } from "./i18n";

export type StoreScreenState =
  | { status: "loading" }
  | { status: "ready"; pack: FounderPackStatus }
  | { status: "error"; message: string };

export function StoreScreen({ state, purchasing, onPurchase, onRefresh, onClose }: {
  state: StoreScreenState;
  purchasing: boolean;
  onPurchase(): void;
  onRefresh(): void;
  onClose(): void;
}) {
  const pack = state.status === "ready" ? state.pack : undefined;
  return (
    <main className="store-screen" aria-labelledby="store-title">
      <header className="store-heading">
        <div><p className="status-label">{t("header.store")}</p><h1 id="store-title">{t("store.title")}</h1></div>
        <button type="button" className="secondary-action" onClick={onClose}>{t("common.backToLobby")}</button>
      </header>
      <article className="founder-pack-card">
        <div className="founder-pack-art" aria-hidden="true"><TileFace id="founder-og" size="lg" /></div>
        <div className="founder-pack-copy">
          <p className="status-label">{t("store.limitedFounder")}</p>
          <h2>{t("store.founderPack")}</h2>
          <p>{t("store.founderDescription")}</p>
          <ul><li>{t("store.founderTile")}</li><li>{t("store.futureBenefits")}</li></ul>
          {state.status === "loading" ? <p role="status">{t("store.loading")}</p> : null}
          {state.status === "error" ? <div role="alert"><p>{state.message}</p><button type="button" className="secondary-action" onClick={onRefresh}>{t("common.retry")}</button></div> : null}
          {pack?.owned ? <p className="store-owned" role="status">✓ {t("store.owned")}</p> : null}
          {pack && !pack.owned ? (
            <button type="button" className="primary-action" disabled={!pack.checkout_available || purchasing} onClick={onPurchase}>
              {purchasing ? t("store.openingCheckout") : pack.checkout_available ? t("store.buy") : t("store.notConfigured")}
            </button>
          ) : null}
          {pack?.sandbox ? <p className="store-sandbox">{t("store.sandbox")}</p> : null}
          {pack && !pack.owned ? <button type="button" className="store-refresh" onClick={onRefresh}>{t("store.checkPurchase")}</button> : null}
        </div>
      </article>
    </main>
  );
}
