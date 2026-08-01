import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  clampTerminalPadding,
  clampTerminalPaddingSides,
  type ShellTool,
} from "@/modules/settings/store";
import { create } from "zustand";
import {
  setLeafCursorBlinkOverride,
  setLeafFontOverride,
  setLeafPaddingOverride,
} from "./rendererPool";

type State = {
  /** Per-leaf active shell tool (nvim etc.), keyed by terminal leaf id. */
  activeByLeaf: Record<number, ShellTool>;
  /** Per-leaf currently running command line (any command, not just TUIs). */
  runningByLeaf: Record<number, string>;
  /** Per-leaf progress (0-100) parsed from command output, if any. */
  progressByLeaf: Record<number, number>;
  /** Leaf of the active tab — synced from App for non-React consumers. */
  activeLeafId: number | null;
  setActive: (leafId: number, tool: ShellTool | null) => void;
  setActiveLeaf: (leafId: number | null) => void;
  setRunning: (leafId: number, command: string | null) => void;
  setProgress: (leafId: number, pct: number | null) => void;
};

/** Tool in the foreground of the active tab's terminal, for imperative
 *  consumers (the global keydown matcher). */
export function getActiveShellTool(): ShellTool | null {
  const s = useShellToolStore.getState();
  return s.activeLeafId != null
    ? (s.activeByLeaf[s.activeLeafId] ?? null)
    : null;
}

/** Reactive variant for components outside App (header, composer, …). */
export function useActiveShellTool(): ShellTool | null {
  return useShellToolStore((s) =>
    s.activeLeafId != null ? (s.activeByLeaf[s.activeLeafId] ?? null) : null,
  );
}

export const useShellToolStore = create<State>((set) => ({
  activeByLeaf: {},
  runningByLeaf: {},
  progressByLeaf: {},
  activeLeafId: null,
  setActiveLeaf: (leafId) => set({ activeLeafId: leafId }),
  setProgress: (leafId, pct) =>
    set((s) => {
      const cur = s.progressByLeaf[leafId];
      if ((cur ?? null) === (pct ?? null)) return s;
      const next = { ...s.progressByLeaf };
      if (pct !== null) next[leafId] = pct;
      else delete next[leafId];
      return { progressByLeaf: next };
    }),
  setRunning: (leafId: number, command: string | null) =>
    set((s) => {
      const cur = s.runningByLeaf[leafId];
      if ((cur ?? null) === (command ?? null)) return s;
      const next = { ...s.runningByLeaf };
      if (command) next[leafId] = command;
      else delete next[leafId];
      return { runningByLeaf: next };
    }),
  setActive: (leafId, tool) => {
    let changed = false;
    set((s) => {
      const current = s.activeByLeaf[leafId] ?? null;
      if (current === tool || (current?.id ?? null) === (tool?.id ?? null)) {
        return s;
      }
      changed = true;
      const next = { ...s.activeByLeaf };
      if (tool) next[leafId] = tool;
      else delete next[leafId];
      return { activeByLeaf: next };
    });
    if (!changed) return;
    // Per-tool overrides that live outside React: cursor blink and fonts on
    // the leaf's xterm slot. null restores the global preferences.
    setLeafCursorBlinkOverride(
      leafId,
      tool?.cursorBlink === "on"
        ? true
        : tool?.cursorBlink === "off"
          ? false
          : null,
    );
    setLeafFontOverride(
      leafId,
      tool
        ? {
            fontSize: tool.fontSize,
            fontFamily: tool.fontFamily,
            fontWeight: tool.fontWeight,
          }
        : null,
    );
    const uniform =
      tool?.padding != null ? clampTerminalPadding(tool.padding) : null;
    setLeafPaddingOverride(
      leafId,
      tool?.paddingSides
        ? clampTerminalPaddingSides(tool.paddingSides)
        : uniform !== null
          ? { top: uniform, right: uniform, bottom: uniform, left: uniform }
          : null,
    );
  },
}));

/** argv[0] basename of a command line, lowercased ("sudo nvim x" → "nvim"). */
export function commandBasename(command: string): string {
  const words = command.trim().split(/\s+/);
  // Skip common wrappers so `sudo nvim` still counts as nvim.
  const wrappers = new Set(["sudo", "doas", "command"]);
  const first = words.find((w) => !wrappers.has(w.toLowerCase())) ?? "";
  return (first.split(/[\\/]/).pop() ?? "").toLowerCase();
}

export function matchShellTool(
  command: string,
  tools: ShellTool[],
): ShellTool | null {
  const base = commandBasename(command);
  if (!base) return null;
  for (const tool of tools) {
    if (tool.patterns.some((p) => p.trim().toLowerCase() === base)) {
      return tool;
    }
  }
  return null;
}

/** Wire into the OSC 133 prompt tracker: tracks which configured shell tool
 *  is in the foreground of each terminal leaf. */
export function trackLeafCommand(
  leafId: number,
  running: boolean,
  command?: string,
): void {
  const store = useShellToolStore.getState();
  if (!running) {
    store.setActive(leafId, null);
    store.setRunning(leafId, null);
    return;
  }
  // C without a command line (some shells) — leave the current state alone.
  if (!command) return;
  store.setRunning(leafId, command);
  const tools = usePreferencesStore.getState().shellTools;
  store.setActive(leafId, matchShellTool(command, tools));
}
