import { usePreferencesStore } from "@/modules/settings/preferences";
import { useEffect } from "react";
import { useTheme } from "./ThemeProvider";
import { applyVibrancy } from "./vibrancy";

/**
 * Drives the native window backdrop off the preference. Mounted only in the
 * main window: `window_set_backdrop` targets its caller, and a translucent
 * settings window is not the intent.
 */
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
