import { afterEach, describe, expect, it } from "vitest";

import catalog from "./catalog.json";
import {
  LOCALE_STORAGE_KEY,
  getAgsLanguageTag,
  localeFromLanguageTag,
  setLocale,
  t,
  translateSource,
} from "./index";

afterEach(() => {
  setLocale("en");
  localStorage.removeItem(LOCALE_STORAGE_KEY);
});

describe("localization", () => {
  it("maps common Chinese browser tags to the supported script locale", () => {
    expect(localeFromLanguageTag("zh-Hans-SG")).toBe("zh-CN");
    expect(localeFromLanguageTag("zh-Hant-HK")).toBe("zh-TW");
    expect(localeFromLanguageTag("en-US")).toBe("en");
  });

  it("switches catalogs, interpolates values, and exposes the AGS language tag", () => {
    setLocale("zh-TW");
    expect(t("header.level", { level: 8 })).toBe("等級 8");
    expect(translateSource("Friends")).toBe("好友");
    expect(getAgsLanguageTag()).toBe("zh-TW");
    expect(document.documentElement.lang).toBe("zh-TW");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-TW");
  });

  it("does not guess when one English source has context-dependent translations", () => {
    setLocale("zh-CN");
    expect(translateSource("Win")).toBe("Win");
    expect(t("game.actionWin")).toBe("胡牌");
    expect(t("statistics.resultWin")).toBe("获胜");
  });

  it("keeps every draft complete and preserves interpolation placeholders", () => {
    for (const [key, message] of Object.entries(catalog)) {
      expect(message.en, `${key} English source`).not.toBe("");
      expect(message["zh-CN"], `${key} Simplified Chinese`).not.toBe("");
      expect(message["zh-TW"], `${key} Traditional Chinese`).not.toBe("");
      expect(["ai_draft", "professional_reviewed"], `${key} review status`).toContain(message.status);

      const placeholders = (value: string) => [...value.matchAll(/\{[^}]+\}/g)].map(([item]) => item).sort();
      expect(placeholders(message["zh-CN"]), `${key} zh-CN placeholders`).toEqual(placeholders(message.en));
      expect(placeholders(message["zh-TW"]), `${key} zh-TW placeholders`).toEqual(placeholders(message.en));
    }
  });
});
