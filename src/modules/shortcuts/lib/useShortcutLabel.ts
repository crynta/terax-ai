import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBindingTokens, SHORTCUTS, type ShortcutId } from "../shortcuts";

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** Display tokens for a shortcut's first binding, honoring user overrides. */
export function useShortcutLabel(id: ShortcutId): string {
  const user = usePreferencesStore((s) => s.shortcuts);
  const bindings = user[id] ?? BY_ID.get(id)?.defaultBindings;
  return getBindingTokens(bindings?.[0]).join(" ");
}
