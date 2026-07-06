import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "@/modules/settings/store";
import enSettings from "./locales/en/settings.json";
import zhCNSettings from "./locales/zh-CN/settings.json";

/**
 * i18n bootstrap. Imported for its side effect from every webview entry
 * (`src/main.tsx`, `src/settings/main.tsx`) so `useTranslation`/`t` work
 * anywhere in the tree. The active language is driven by the persisted
 * `language` preference (see ThemeProvider), not by a runtime detector.
 */

export const FALLBACK_LANGUAGE: Language = "en";

/** Languages offered in the UI. Extend alongside the resource bundles. */
export const SUPPORTED_LANGUAGES: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "zh-CN", label: "简体中文" },
];

export const resources = {
  en: { settings: enSettings },
  "zh-CN": { settings: zhCNSettings },
} as const;

if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    resources,
    lng: FALLBACK_LANGUAGE,
    fallbackLng: FALLBACK_LANGUAGE,
    defaultNS: "settings",
    ns: ["settings"],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

/**
 * Switch the active UI language and reflect it on the document element.
 * Called from ThemeProvider on load and whenever the `language` pref changes.
 */
export function setI18nLanguage(lng: Language): void {
  if (i18next.language !== lng) {
    void i18next.changeLanguage(lng);
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
}

export default i18next;
