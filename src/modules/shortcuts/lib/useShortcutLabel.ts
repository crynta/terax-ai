import { useMemo } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBindingTokens, SHORTCUTS, type ShortcutId } from "../shortcuts";

export function useShortcutLabel(id: ShortcutId, label?: string): string {
  // Subscribe only to the one shortcut key we care about.
  const userBindings = usePreferencesStore((s) => s.shortcuts[id]);

  return useMemo(() => {
    const s = SHORTCUTS.find((s) => s.id === id);
    if (!s) return label ?? "";

    const bindings = userBindings ?? s.defaultBindings;
    if (!bindings || bindings.length === 0) return label ?? "";

    const shortcutText = getBindingTokens(bindings[0]).join("");
    if (!label) return shortcutText;
    return shortcutText ? `${label} (${shortcutText})` : label;
  }, [id, label, userBindings]);
}

