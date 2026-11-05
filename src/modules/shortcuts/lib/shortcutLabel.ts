import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBindingTokens, SHORTCUTS, type ShortcutId } from "../shortcuts";
import { isTerminalFocusedNow } from "./focusContext";
import { effectiveBindings } from "./terminalFocusPolicy";

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** Display tokens for a shortcut as it fires from the current focus, honoring
 *  user overrides. Non-reactive: for imperative callers (toasts) that can't
 *  use the useShortcutLabel hook. */
export function shortcutLabel(id: ShortcutId): string {
  const user = usePreferencesStore.getState().shortcuts;
  const bindings = effectiveBindings(
    id,
    BY_ID.get(id)?.defaultBindings ?? [],
    user[id],
    isTerminalFocusedNow(),
  );
  return getBindingTokens(bindings[0]).join(" ");
}
