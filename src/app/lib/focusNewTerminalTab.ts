/** Delay before focusing a freshly created terminal tab (matches cdInNewTab). */
export const FOCUS_NEW_TERMINAL_DELAY_MS = 80;

export type FocusableTerminal = { focus: () => void };

export type TerminalTabLike = {
  kind: string;
  activeLeafId: number;
};

/**
 * After `newTab` / `newPrivateTab` / `newBlockTab`, the xterm slot may not be
 * bound yet — and while the slot is still in its anti-flash hide window,
 * Chromium rejects focus on a `visibility:hidden` subtree. Schedule a short
 * deferred focus (same timing as `cdInNewTab`) so typing works immediately
 * without an extra click (#411).
 */
export function scheduleFocusNewTerminalTab(
  tabId: number,
  opts: {
    getTab: (id: number) => TerminalTabLike | undefined;
    getHandle: (leafId: number) => FocusableTerminal | undefined;
    delayMs?: number;
  },
): ReturnType<typeof setTimeout> {
  const delayMs = opts.delayMs ?? FOCUS_NEW_TERMINAL_DELAY_MS;
  return setTimeout(() => {
    const tab = opts.getTab(tabId);
    if (!tab || tab.kind !== "terminal") return;
    opts.getHandle(tab.activeLeafId)?.focus();
  }, delayMs);
}
