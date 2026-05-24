import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_THEME_ID,
  EDITOR_THEMES,
  loadPreferences,
  onPreferencesChange,
  setEditorTheme as persistEditorTheme,
  setTheme as persistTheme,
  setThemeId as persistThemeId,
  type EditorThemeId,
  type ThemePref,
} from "@/modules/settings/store";
import { applyTheme, clearTheme } from "./applyTheme";
import {
  listCustomThemes,
  onCustomThemesChange,
} from "./customThemes";
import { SurfaceLayer } from "./SurfaceLayer";
import { getBuiltinTheme, getDefaultTheme } from "./themes";
import type { Theme } from "./types";

export type { Theme };
export type ThemeModePref = ThemePref;

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultMode?: ThemePref;
};

type ThemeProviderState = {
  mode: ThemePref;
  resolvedMode: "dark" | "light";
  themeId: string;
  customThemes: Theme[];
  setMode: (mode: ThemePref) => void;
  setThemeId: (id: string) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | null>(null);

const FAST_PATH_KEY = "termax-ui-theme-shadow";
const FAST_PATH_THEME_ID = "termax-ui-theme-id-shadow";

function readFastMode(fallback: ThemePref): ThemePref {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(FAST_PATH_KEY);
  return v === "dark" || v === "light" || v === "system" ? v : fallback;
}

function writeFastMode(t: ThemePref): void {
  try { window.localStorage.setItem(FAST_PATH_KEY, t); } catch { /* ignore */ }
}

function readFastThemeId(): string {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  return window.localStorage.getItem(FAST_PATH_THEME_ID) ?? DEFAULT_THEME_ID;
}

function writeFastThemeId(id: string): void {
  try { window.localStorage.setItem(FAST_PATH_THEME_ID, id); } catch { /* ignore */ }
}

function resolveTheme(id: string, custom: Theme[]): Theme {
  return custom.find((t) => t.id === id) ?? getBuiltinTheme(id) ?? getDefaultTheme();
}

export function ThemeProvider({ children, defaultMode = "system" }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemePref>(() => readFastMode(defaultMode));
  const [themeId, setThemeIdState] = useState<string>(() => readFastThemeId());
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    let alive = true;
    void loadPreferences().then((p) => {
      if (!alive) return;
      setModeState(p.theme);
      setThemeIdState(p.themeId);
      writeFastMode(p.theme);
      writeFastThemeId(p.themeId);
    });
    const unlistenP = onPreferencesChange((key, value) => {
      if (key === "theme" && (value === "system" || value === "light" || value === "dark")) {
        setModeState(value);
        writeFastMode(value);
      } else if (key === "themeId" && typeof value === "string") {
        setThemeIdState(value);
        writeFastThemeId(value);
      }
    });
    return () => {
      alive = false;
      void unlistenP.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void listCustomThemes().then((list) => { if (alive) setCustomThemes(list); });
    const unlisten = onCustomThemesChange(() => {
      void listCustomThemes().then((list) => setCustomThemes(list));
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolvedMode: "dark" | "light" =
    mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedMode);
  }, [resolvedMode]);

  const lastEditorPairRef = useRef<string | null>(null);
  useEffect(() => {
    if (themeId === DEFAULT_THEME_ID) {
      clearTheme();
      lastEditorPairRef.current = null;
      return;
    }
    const theme = resolveTheme(themeId, customThemes);
    applyTheme(theme, resolvedMode);
    const editorPair = theme.editorTheme?.[resolvedMode];
    if (
      editorPair &&
      lastEditorPairRef.current !== editorPair &&
      (EDITOR_THEMES as readonly string[]).includes(editorPair)
    ) {
      lastEditorPairRef.current = editorPair;
      void persistEditorTheme(editorPair as EditorThemeId);
    }
  }, [themeId, resolvedMode, customThemes]);

  const setMode = useCallback((next: ThemePref) => {
    setModeState(next);
    writeFastMode(next);
    void persistTheme(next);
  }, []);

  const setThemeId = useCallback((id: string) => {
    setThemeIdState(id);
    writeFastThemeId(id);
    void persistThemeId(id);
  }, []);

  const value = useMemo<ThemeProviderState>(
    () => ({ mode, resolvedMode, themeId, customThemes, setMode, setThemeId }),
    [mode, resolvedMode, themeId, customThemes, setMode, setThemeId],
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      <SurfaceLayer />
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme(): ThemeProviderState {
  const ctx = useContext(ThemeProviderContext);
  if (!ctx) throw new Error("useTheme must be used within a <ThemeProvider>");
  return ctx;
}
