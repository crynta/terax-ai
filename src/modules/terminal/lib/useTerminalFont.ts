import { usePreferencesStore } from "@/modules/settings/preferences";
import { resolveTerminalFont, useTheme } from "@/modules/theme";
import { useMemo } from "react";

export function useTerminalFont() {
  const fontFamily = usePreferencesStore((p) => p.terminalFontFamily);
  const fontWeight = usePreferencesStore((p) => p.terminalFontWeight);
  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  const { activeTheme, resolvedMode } = useTheme();

  return useMemo(
    () =>
      resolveTerminalFont(
        { fontFamily, fontWeight, fontSize },
        activeTheme,
        resolvedMode,
      ),
    [fontFamily, fontWeight, fontSize, activeTheme, resolvedMode],
  );
}
