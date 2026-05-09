/**
 * Single source of truth for keyboard shortcuts. Each entry carries:
 * - `keys`: display tokens for the cheat-sheet dialog.
 * - `match`: predicate over the live KeyboardEvent used by `useGlobalShortcuts`.
 *
 * Keeping both on the same record means the dialog can never lie about a
 * binding the runtime no longer matches (or vice-versa).
 */

export type ShortcutId =
  | "tab.new"
  | "tab.newPreview"
  | "tab.newEditor"
  | "tab.close"
  | "tab.next"
  | "tab.prev"
  | "tab.selectByIndex"
  | "pane.splitRight"
  | "pane.splitDown"
  | "pane.focusNext"
  | "pane.focusPrev"
  | "search.focus"
  | "ai.toggle"
  | "ai.askSelection"
  | "shortcuts.open"
  | "sidebar.toggle";

export type ShortcutGroup =
  | "General"
  | "Tabs"
  | "Panes"
  | "Search"
  | "AI"
  | "View";

export type Shortcut = {
  id: ShortcutId;
  label: string;
  keys: string[];
  group: ShortcutGroup;
  match: (e: KeyboardEvent) => boolean;
};

const isMod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;

export const SHORTCUTS: Shortcut[] = [
  {
    id: "shortcuts.open",
    label: "Show keyboard shortcuts",
    keys: ["⌘", "K"],
    group: "General",
    match: (e) => isMod(e) && e.key.toLowerCase() === "k",
  },
  {
    id: "tab.new",
    label: "New tab",
    keys: ["⌘", "T"],
    group: "Tabs",
    match: (e) => isMod(e) && e.key.toLowerCase() === "t",
  },
  {
    id: "tab.newPreview",
    label: "New preview tab",
    keys: ["⌘", "P"],
    group: "Tabs",
    match: (e) => isMod(e) && !e.shiftKey && e.key.toLowerCase() === "p",
  },
  {
    id: "tab.newEditor",
    label: "New editor tab",
    keys: ["⌘", "E"],
    group: "Tabs",
    match: (e) => isMod(e) && !e.shiftKey && e.key.toLowerCase() === "e",
  },
  {
    id: "tab.close",
    label: "Close tab or pane",
    keys: ["⌘", "W"],
    group: "Tabs",
    match: (e) => isMod(e) && e.key.toLowerCase() === "w",
  },
  {
    id: "pane.splitRight",
    label: "Split pane right",
    keys: ["⌘", "D"],
    group: "Panes",
    match: (e) => isMod(e) && !e.shiftKey && e.key.toLowerCase() === "d",
  },
  {
    id: "pane.splitDown",
    label: "Split pane down",
    keys: ["⌘", "⇧", "D"],
    group: "Panes",
    match: (e) => isMod(e) && e.shiftKey && e.key.toLowerCase() === "d",
  },
  {
    id: "pane.focusNext",
    label: "Focus next pane",
    keys: ["⌘", "]"],
    group: "Panes",
    match: (e) => isMod(e) && !e.shiftKey && e.key === "]",
  },
  {
    id: "pane.focusPrev",
    label: "Focus previous pane",
    keys: ["⌘", "["],
    group: "Panes",
    match: (e) => isMod(e) && !e.shiftKey && e.key === "[",
  },
  {
    id: "tab.next",
    label: "Next tab",
    keys: ["⌃", "⇥"],
    group: "Tabs",
    // Ctrl+Tab is conventionally Ctrl-only on every platform (including macOS).
    match: (e) => e.ctrlKey && !e.shiftKey && e.key === "Tab",
  },
  {
    id: "tab.prev",
    label: "Previous tab",
    keys: ["⌃", "⇧", "⇥"],
    group: "Tabs",
    match: (e) => e.ctrlKey && e.shiftKey && e.key === "Tab",
  },
  {
    id: "tab.selectByIndex",
    label: "Jump to tab 1–9",
    keys: ["⌘", "1…9"],
    group: "Tabs",
    match: (e) => isMod(e) && /^[1-9]$/.test(e.key),
  },
  {
    id: "search.focus",
    label: "Find in terminal",
    keys: ["⌘", "F"],
    group: "Search",
    match: (e) => isMod(e) && e.key.toLowerCase() === "f",
  },
  {
    id: "ai.toggle",
    label: "Toggle AI agent",
    keys: ["⌘", "I"],
    group: "AI",
    match: (e) => isMod(e) && e.key.toLowerCase() === "i",
  },
  {
    id: "ai.askSelection",
    label: "Ask AI about selection",
    keys: ["⌘", "L"],
    group: "AI",
    match: (e) => isMod(e) && e.key.toLowerCase() === "l",
  },
  {
    id: "sidebar.toggle",
    label: "Toggle file explorer",
    keys: ["⌘", "B"],
    group: "View",
    match: (e) => isMod(e) && e.key.toLowerCase() === "b",
  },
];

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  "General",
  "Tabs",
  "Panes",
  "View",
  "Search",
  "AI",
];
