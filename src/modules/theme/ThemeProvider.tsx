import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  loadPreferences,
  onPreferencesChange,
  setTheme as persistTheme,
  type ThemePref,
} from "@/modules/settings/store";

export type Theme = ThemePref;

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
};

type ThemeProviderState = {
  theme: Theme;
  resolvedTheme: "dark" | "light";
  setTheme: (theme: Theme) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | null>(null);

// Synchronous fast-path so the initial paint isn't unstyled. The persistent
// preference (in tauri-plugin-store) overwrites this on mount; we keep a
// localStorage shadow of the *last applied* theme just for first-paint fidelity.
const FAST_PATH_KEY = "terax-ui-theme-shadow";

function readFastTheme(fallback: Theme): Theme {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(FAST_PATH_KEY);
  return v === "dark" || v === "light" || v === "system" ? v : fallback;
}

function writeFastTheme(t: Theme): void {
  try {
    window.localStorage.setItem(FAST_PATH_KEY, t);
  } catch {
    // ignore
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() =>
    readFastTheme(defaultTheme),
  );
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  // Hydrate from the persistent store (cross-window source of truth).
  useEffect(() => {
    let alive = true;
    void loadPreferences().then((p) => {
      if (!alive) return;
      setThemeState(p.theme);
      writeFastTheme(p.theme);
    });
    const unlistenP = onPreferencesChange((key, value) => {
      if (
        key === "theme" &&
        (value === "system" || value === "light" || value === "dark")
      ) {
        setThemeState(value);
        writeFastTheme(value);
      }
    });
    return () => {
      alive = false;
      void unlistenP.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme: "dark" | "light" =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    writeFastTheme(next);
    void persistTheme(next);
  }, []);

  const value = useMemo<ThemeProviderState>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme(): ThemeProviderState {
  const ctx = useContext(ThemeProviderContext);
  if (!ctx) throw new Error("useTheme must be used within a <ThemeProvider>");
  return ctx;
}
