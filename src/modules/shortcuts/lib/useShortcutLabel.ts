import { usePreferencesStore } from "@/modules/settings/preferences";
import { useMemo } from "react";
import {
  getBindingTokens,
  resolveShortcutBindings,
  type ShortcutId,
} from "../shortcuts";

/** Shortcut chord as display text; optional `label` becomes `Label (⌘K)` style. */
export function useShortcutLabel(id: ShortcutId, label?: string): string {
  const userBindings = usePreferencesStore((s) => s.shortcuts[id]);

  return useMemo(() => {
    const bindings = resolveShortcutBindings(id, userBindings);
    if (!bindings.length) {
      return label ?? "";
    }

    const shortcutText = getBindingTokens(bindings[0]).join("");
    if (!label) return shortcutText;
    return shortcutText ? `${label} (${shortcutText})` : label;
  }, [id, label, userBindings]);
}
