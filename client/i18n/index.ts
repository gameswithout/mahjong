import catalogData from "./catalog.json";

export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

type CatalogEntry = {
  context: string;
  en: string;
  "zh-CN": string;
  "zh-TW": string;
  status: "ai_draft" | "professional_reviewed";
};

const catalog = catalogData as Record<string, CatalogEntry>;
const sourceCatalog = new Map<string, CatalogEntry>();
const ambiguousSources = new Set<string>();
for (const entry of Object.values(catalog)) {
  const existing = sourceCatalog.get(entry.en);
  if (
    existing &&
    (existing["zh-CN"] !== entry["zh-CN"] || existing["zh-TW"] !== entry["zh-TW"])
  ) {
    // Semantic keys can legitimately translate the same English word
    // differently (for example, the Win action versus a match-history Win).
    // Do not guess when translating server-authored source strings.
    sourceCatalog.delete(entry.en);
    ambiguousSources.add(entry.en);
  } else if (!ambiguousSources.has(entry.en)) {
    sourceCatalog.set(entry.en, entry);
  }
}
export type MessageKey = keyof typeof catalogData;
export type MessageValues = Record<string, string | number>;

export const LOCALE_STORAGE_KEY = "mahjong.locale";

function localeFromLanguageTag(languageTag: string | null | undefined): Locale {
  const normalized = languageTag?.trim().replaceAll("_", "-").toLowerCase();
  if (!normalized) return "en";
  if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-mo" || normalized.startsWith("zh-hant")) {
    return "zh-TW";
  }
  if (normalized === "zh-cn" || normalized === "zh-sg" || normalized.startsWith("zh-hans") || normalized === "zh") {
    return "zh-CN";
  }
  return "en";
}

function readInitialLocale(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (saved && (SUPPORTED_LOCALES as readonly string[]).includes(saved)) {
      return saved as Locale;
    }
  } catch {
    // Storage can be unavailable in privacy modes. Browser preference remains a safe fallback.
  }
  return localeFromLanguageTag(globalThis.navigator?.language);
}

let currentLocale = readInitialLocale();
const listeners = new Set<() => void>();

function applyDocumentLocale(locale: Locale): void {
  if (globalThis.document?.documentElement) {
    globalThis.document.documentElement.lang = locale;
  }
}

applyDocumentLocale(currentLocale);

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  applyDocumentLocale(locale);
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Locale still applies for this session when persistent storage is unavailable.
  }
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(key: MessageKey, values: MessageValues = {}): string {
  const entry = catalog[key];
  const template = entry?.[currentLocale] || entry?.en || key;
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}

export function translateSource(source: string, values: MessageValues = {}): string {
  const entry = sourceCatalog.get(source);
  const template = entry?.[currentLocale] || source;
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(currentLocale, options).format(value);
}

export function formatDateTime(value: string | number | Date): string {
  return new Intl.DateTimeFormat(currentLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function displayCountryName(regionCode: string, fallback: string): string {
  try {
    return new Intl.DisplayNames([currentLocale], { type: "region" }).of(regionCode) ?? fallback;
  } catch {
    return fallback;
  }
}

// AGS localized content endpoints use a language argument. Keep this adapter at
// the integration boundary so future Achievement/Store calls cannot drift from
// the selected UI locale or send browser-specific tags such as zh-Hant-TW.
export function getAgsLanguageTag(): Locale {
  return currentLocale;
}

export { localeFromLanguageTag };
