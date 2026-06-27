import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBindingTokens, SHORTCUTS, type ShortcutId } from "../shortcuts";

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** Display tokens for a shortcut, honoring user overrides. Non-reactive: for
 *  imperative callers (toasts) that can't use the useShortcutLabel hook. */
export function shortcutLabel(id: ShortcutId): string {
  const user = usePreferencesStore.getState().shortcuts;
  const bindings = user[id] ?? BY_ID.get(id)?.defaultBindings;
  return getBindingTokens(bindings?.[0]).join(" ");
}
