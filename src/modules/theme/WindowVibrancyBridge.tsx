import { usePreferencesStore } from "@/modules/settings/preferences";
import { useEffect } from "react";
import { useTheme } from "./ThemeProvider";
import { applyVibrancy } from "./vibrancy";

/** Main window only: `window_set_backdrop` targets its caller. */
export function WindowVibrancyBridge() {
  const enabled = usePreferencesStore((s) => s.windowVibrancy);
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const { resolvedMode } = useTheme();

  useEffect(() => {
    if (!hydrated) return;
    void applyVibrancy(enabled, resolvedMode === "dark");
  }, [enabled, hydrated, resolvedMode]);

  return null;
}
