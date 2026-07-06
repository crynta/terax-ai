import { usePreferencesStore } from "@/modules/settings/preferences";
import { getActiveShellTool } from "@/modules/terminal/lib/shellToolStore";
import { useEffect, useRef } from "react";
import { matchBinding, SHORTCUTS, type ShortcutId } from "../shortcuts";

export type ShortcutHandler = (e: KeyboardEvent) => void;
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
      // Shell-tool rebinds replace the global combos while the tool runs
      // and the terminal is focused (elsewhere the globals stay in charge).
      const tool = getActiveShellTool();
      const toolOverrides =
        tool?.shortcutOverrides &&
        (e.target as HTMLElement | null)?.closest?.(".xterm")
          ? tool.shortcutOverrides
          : undefined;
      for (const s of SHORTCUTS) {
        if (e.repeat && !s.allowRepeat) continue;
        const bindings =
          toolOverrides?.[s.id] ?? (userShortcuts[s.id] || s.defaultBindings);
        const isMatch = bindings.some((b) => matchBinding(e, b, s.id));
        if (!isMatch) continue;
        if (options?.isDisabled?.(s.id, e)) return;
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
