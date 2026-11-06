import { create } from "zustand";
import type { ClaudeActivity } from "./claudeActivity";
import type { ClaudeDialog } from "./claudeDialog";
import type { ClaudeFooter, PermissionMode } from "./claudeFooter";
import type { ClaudePanel } from "./claudePanel";

type ScreenState = {
  /** Claude Code's footer per pane leaf, as last read off its screen. */
  footers: Record<number, ClaudeFooter | null>;
  /** Claude Code's activity (spinner) line per pane leaf. */
  activities: Record<number, ClaudeActivity | null>;
  /** The dialog Claude Code shows per pane leaf (permission, choice, plan). */
  dialogs: Record<number, ClaudeDialog | null>;
  /** The interactive panel (`/usage`, `/mcp`, `/config`…) open per pane leaf. */
  panels: Record<number, ClaudePanel | null>;
  setPanel: (leafId: number, panel: ClaudePanel | null) => void;
  setFooter: (leafId: number, footer: ClaudeFooter | null) => void;
  setActivity: (leafId: number, activity: ClaudeActivity | null) => void;
  setDialog: (leafId: number, dialog: ClaudeDialog | null) => void;
};

/** What the Reader reads off each Claude pane's screen. */
export const useScreenStore = create<ScreenState>((set) => ({
  footers: {},
  activities: {},
  dialogs: {},
  panels: {},
  setPanel: (leafId, panel) =>
    set((s) =>
      (s.panels[leafId] ?? null) === panel
        ? s
        : { panels: { ...s.panels, [leafId]: panel } },
    ),
  setDialog: (leafId, dialog) =>
    set((s) =>
      (s.dialogs[leafId] ?? null) === dialog
        ? s
        : { dialogs: { ...s.dialogs, [leafId]: dialog } },
    ),
  setFooter: (leafId, footer) =>
    set((s) =>
      s.footers[leafId] === footer
        ? s
        : { footers: { ...s.footers, [leafId]: footer } },
    ),
  setActivity: (leafId, activity) =>
    set((s) =>
      s.activities[leafId] === activity
        ? s
        : { activities: { ...s.activities, [leafId]: activity } },
    ),
}));

/** The pane's Claude Code footer, or null when it isn't on screen. */
export function useClaudeFooter(leafId: number): ClaudeFooter | null {
  return useScreenStore((s) => s.footers[leafId] ?? null);
}

/** The pane's Claude Code activity line, or null when none is on screen. */
export function useClaudeActivity(leafId: number): ClaudeActivity | null {
  return useScreenStore((s) => s.activities[leafId] ?? null);
}

/** The dialog on the pane's screen, or null; the one the composer's Action card answers. */
export function useClaudeDialog(leafId: number): ClaudeDialog | null {
  return useScreenStore((s) => s.dialogs[leafId] ?? null);
}

/** The interactive panel on the pane's screen, or null when the prompt shows. */
export function useClaudePanel(leafId: number): ClaudePanel | null {
  return useScreenStore((s) => s.panels[leafId] ?? null);
}

/** The pane's Claude Code permission mode, or null when the footer isn't visible. */
export function useClaudeMode(leafId: number): PermissionMode | null {
  return useScreenStore((s) => s.footers[leafId]?.mode ?? null);
}

/** Non-React read of the same mode, for commands and the palette. */
export function claudeModeFor(leafId: number): PermissionMode | null {
  return useScreenStore.getState().footers[leafId]?.mode ?? null;
}
