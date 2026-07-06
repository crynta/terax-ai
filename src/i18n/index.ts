import i18next, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "@/modules/settings/store";

/**
 * i18n bootstrap. Imported for its side effect from every webview entry
 * (`src/main.tsx`, `src/settings/main.tsx`) so `useTranslation`/`t` work
 * anywhere in the tree. The active language is driven by the persisted
 * `language` preference (see ThemeProvider), not by a runtime detector.
 *
 * Locale bundles live in `./locales/<lng>/<namespace>.json` and are picked up
 * automatically via Vite glob — adding a namespace is just adding a JSON file.
 */

export const FALLBACK_LANGUAGE: Language = "en";

/** Languages offered in the UI. Extend alongside the resource bundles. */
export const SUPPORTED_LANGUAGES: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "zh-CN", label: "简体中文" },
];

const modules = import.meta.glob<{ default: Record<string, unknown> }>(
  "./locales/**/*.json",
  { eager: true },
);

export const resources: Resource = {};
const namespaces = new Set<string>();
for (const [path, mod] of Object.entries(modules)) {
  // path === "./locales/<lng>/<ns>.json"
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, lng, ns] = match;
  namespaces.add(ns);
  (resources[lng] ??= {})[ns] = mod.default;
}

if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    resources,
    lng: FALLBACK_LANGUAGE,
    fallbackLng: FALLBACK_LANGUAGE,
    defaultNS: "settings",
    fallbackNS: "common",
    ns: [...namespaces],
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
