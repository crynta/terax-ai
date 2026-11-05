import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBindingTokens, SHORTCUTS, type ShortcutId } from "../shortcuts";
import { useInTerminalFocus } from "./focusContext";
import { effectiveBindings } from "./terminalFocusPolicy";

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** Display tokens for the binding that fires from the current focus (a
 *  terminal gives plain Ctrl chords to the shell), honoring user overrides. */
export function useShortcutLabel(id: ShortcutId): string {
  const user = usePreferencesStore((s) => s.shortcuts);
  const inTerminal = useInTerminalFocus();
  const bindings = effectiveBindings(
    id,
    BY_ID.get(id)?.defaultBindings ?? [],
    user[id],
    inTerminal,
  );
  return getBindingTokens(bindings[0]).join(" ");
}
