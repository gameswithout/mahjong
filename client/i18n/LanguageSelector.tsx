import { setLocale, SUPPORTED_LOCALES, t, type Locale } from "./index";
import { useLocale } from "./useLocale";

const LABEL_KEYS = {
  en: "language.english",
  "zh-CN": "language.simplifiedChinese",
  "zh-TW": "language.traditionalChinese",
} as const;

export function LanguageSelector({ inline = false }: { inline?: boolean }) {
  const locale = useLocale();

  return (
    <label className={`language-selector${inline ? " language-selector-inline" : ""}`}>
      <span>{t("language.label")}</span>
      <select
        aria-label={t("language.label")}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        {SUPPORTED_LOCALES.map((option) => (
          <option key={option} value={option} lang={option}>
            {t(LABEL_KEYS[option])}
          </option>
        ))}
      </select>
    </label>
  );
}
