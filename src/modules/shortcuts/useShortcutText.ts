import { KEY_SEP } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useMemo } from "react";
import { getBindingTokens, SHORTCUTS, type ShortcutId } from "./shortcuts";

/** Display text for a shortcut's first binding, honoring user remaps. */
export function useShortcutText(id: ShortcutId | undefined): string {
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);
  return useMemo(() => {
    if (!id) return "";
    const def = SHORTCUTS.find((s) => s.id === id);
    const bindings = userShortcuts[id] || def?.defaultBindings;
    if (!bindings || bindings.length === 0) return "";
    return getBindingTokens(bindings[0]).join(KEY_SEP);
  }, [id, userShortcuts]);
}
