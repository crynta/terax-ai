import { create } from "zustand";
import { persist } from "zustand/middleware";

import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

export type Locale = "en" | "zh-CN";

const locales: Record<Locale, typeof en> = {
  en,
  "zh-CN": zhCN,
};

type NestedKeyOf<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}.${NestedKeyOf<T[K]>}`
          : K
        : never;
    }[keyof T]
  : never;

export type TranslationKey = NestedKeyOf<typeof en>;

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      locale: "en",
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: "terax-i18n",
    },
  ),
);

function getNestedValue(obj: unknown, path: string): string | undefined {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * Returns a translation function for the current locale.
 * 
 * Usage:
 *   const t = useTranslation();
 *   t("general.title")           // → "通用"
 *   t("general.vimModeDesc")     // → "在代码编辑器中启用 Vim 按键绑定。"
 */
export function useTranslation() {
  const locale = useI18nStore((s) => s.locale);
  const messages = locales[locale] ?? locales.en;

  return (key: string): string => {
    const value = getNestedValue(messages, key);
    if (value !== undefined) return value;
    // Fallback to English
    const enValue = getNestedValue(locales.en, key);
    return enValue ?? key;
  };
}

/**
 * Direct translation function that doesn't require React hooks.
 * Useful for non-component files or one-time lookups.
 */
export function translate(key: string, locale?: Locale): string {
  const messages = locales[locale ?? useI18nStore.getState().locale] ?? locales.en;
  const value = getNestedValue(messages, key);
  if (value !== undefined) return value;
  const enValue = getNestedValue(locales.en, key);
  return enValue ?? key;
}

/**
 * Available locales for language selection UI.
 */
export const AVAILABLE_LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
];
