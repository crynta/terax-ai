import { useEffect, useRef } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { isTerminalSurfaceTarget } from "@/modules/terminal/lib/terminalSurfaceTarget";
import {
  SHORTCUTS,
  matchBinding,
  type ShortcutId,
  shouldDeferForTerminalFocus,
} from "../shortcuts";

type ShortcutHandler = (e: KeyboardEvent) => void;
export type ShortcutHandlers = Partial<Record<ShortcutId, ShortcutHandler>>;

export type UseGlobalShortcutsOptions = {
  isDisabled?: (id: ShortcutId, e: KeyboardEvent) => boolean;
};

export function useGlobalShortcuts(
  handlers: ShortcutHandlers,
  options?: UseGlobalShortcutsOptions,
) {
  const latest = useRef({ handlers, options });
  latest.current = { handlers, options };

  // Access the shortcuts from the store
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { handlers, options } = latest.current;
      for (const s of SHORTCUTS) {
        if (e.repeat && !s.allowRepeat) continue;
        const bindings = userShortcuts[s.id] || s.defaultBindings;
        const isMatch = bindings.some((b) => matchBinding(e, b, s.id));
        if (!isMatch) continue;
        // Read the pref at keypress time (not a render closure) so a quick
        // F6 toggle is never computed from a stale value.
        const inTerminal = isTerminalSurfaceTarget(
          e.target ?? document.activeElement,
        );
        // Skip, don't stop: a later shortcut may share the binding (⌘K).
        if (
          shouldDeferForTerminalFocus(s, e, {
            enabled: usePreferencesStore.getState().terminalTuiFocus,
            inTerminal,
          })
        )
          continue;
        if (options?.isDisabled?.(s.id, e)) continue;
        const h = handlers[s.id];
        if (!h) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        h(e);
        return;
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [userShortcuts]);
}
