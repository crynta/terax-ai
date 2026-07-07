import i18next, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "@/modules/settings/store";

// ---- eager core en bundles (always-visible UI chrome) -----------------------
import enCommon from "./locales/en/common.json";
import enSettings from "./locales/en/settings.json";
import enShortcuts from "./locales/en/shortcuts.json";
import enCommandPalette from "./locales/en/commandPalette.json";
import enApp from "./locales/en/app.json";
import enHeader from "./locales/en/header.json";
import enStatusbar from "./locales/en/statusbar.json";
import enTabs from "./locales/en/tabs.json";
import enTerminal from "./locales/en/terminal.json";
import enEditor from "./locales/en/editor.json";
import enSpaces from "./locales/en/spaces.json";
import enSidebar from "./locales/en/sidebar.json";

// ---- lazy panel en bundles (AI, explorer, git, preview, updater…) ----------
const enPanelModules = import.meta.glob<{ default: Record<string, unknown> }>(
  "./locales/en/*.json",
);

// ---- lazy zh-CN (all namespaces) -------------------------------------------
const zhCNModules = import.meta.glob<{ default: Record<string, unknown> }>(
  "./locales/zh-CN/*.json",
);

/** Languages offered in the UI. */
export const SUPPORTED_LANGUAGES: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "zh-CN", label: "简体中文" },
];

export const FALLBACK_LANGUAGE: Language = "en";

const CORE_EN: Record<string, Record<string, unknown>> = {
  common: enCommon,
  settings: enSettings,
  shortcuts: enShortcuts,
  commandPalette: enCommandPalette,
  app: enApp,
  header: enHeader,
  statusbar: enStatusbar,
  tabs: enTabs,
  terminal: enTerminal,
  editor: enEditor,
  spaces: enSpaces,
  sidebar: enSidebar,
};

// ---- build resources & lazy loaders ----------------------------------------
function extractNs(path: string): string | null {
  const m = path.match(/\.\/locales\/[^/]+\/(.+)\.json$/);
  return m ? m[1] : null;
}

const enPanelLoaders = new Map<string, () => Promise<Record<string, unknown>>>();
for (const [path, loader] of Object.entries(enPanelModules)) {
  const ns = extractNs(path);
  if (!ns || CORE_EN[ns]) continue; // core already loaded eagerly
  enPanelLoaders.set(ns, async () => {
    const mod = await loader();
    return mod.default as Record<string, unknown>;
  });
}

const zhCNLoaders = new Map<string, () => Promise<Record<string, unknown>>>();
for (const [path, loader] of Object.entries(zhCNModules)) {
  const ns = extractNs(path);
  if (!ns) continue;
  zhCNLoaders.set(ns, async () => {
    const mod = await loader();
    return mod.default as Record<string, unknown>;
  });
}

export const resources: Resource = { en: { ...CORE_EN } };
const allNs = new Set(Object.keys(CORE_EN));
for (const ns of enPanelLoaders.keys()) allNs.add(ns);
for (const ns of zhCNLoaders.keys()) allNs.add(ns);

if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    resources,
    lng: FALLBACK_LANGUAGE,
    fallbackLng: FALLBACK_LANGUAGE,
    defaultNS: "settings",
    fallbackNS: "common",
    ns: [...allNs],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

// ---- public API ------------------------------------------------------------

/** Preload panel en namespaces (call at app boot, non-blocking). */
export async function preloadEn(): Promise<void> {
  await Promise.all(
    [...enPanelLoaders].map(async ([ns, loader]) => {
      const bundle = await loader();
      (resources.en as Record<string, unknown>)[ns] = bundle;
      i18next.addResourceBundle("en", ns, bundle, true, true);
    }),
  );
}

/** Load zh-CN (call once on first language switch). */
async function ensureZhCN(): Promise<void> {
  if (resources["zh-CN"]) return;
  resources["zh-CN"] = {};
  await Promise.all(
    [...zhCNLoaders].map(async ([ns, loader]) => {
      const bundle = await loader();
      resources["zh-CN"]![ns] = bundle;
      i18next.addResourceBundle("zh-CN", ns, bundle, true, true);
    }),
  );
}

/**
 * Switch the active UI language and reflect it on the document element.
 * Called from ThemeProvider on load and whenever the `language` pref changes.
 */
export async function setI18nLanguage(lng: Language): Promise<void> {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
  if (lng === "zh-CN") await ensureZhCN();
  if (i18next.language !== lng) {
    await i18next.changeLanguage(lng);
  }
}

export default i18next;
