import { CTRL_KEY, MOD_KEY, SHIFT_KEY, TAB_KEY } from "@/lib/platform";

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
    keys: [MOD_KEY, "K"],
    group: "General",
    match: (e) => isMod(e) && e.key.toLowerCase() === "k",
  },
  {
    id: "tab.new",
    label: "New tab",
    keys: [MOD_KEY, "T"],
    group: "Tabs",
    match: (e) => isMod(e) && e.key.toLowerCase() === "t",
  },
  {
    id: "tab.newPreview",
    label: "New preview tab",
    keys: [MOD_KEY, "P"],
    group: "Tabs",
    match: (e) => isMod(e) && !e.shiftKey && e.key.toLowerCase() === "p",
  },
  {
    id: "tab.newEditor",
    label: "New editor tab",
    keys: [MOD_KEY, "E"],
    group: "Tabs",
    match: (e) => isMod(e) && !e.shiftKey && e.key.toLowerCase() === "e",
  },
  {
    id: "tab.close",
    label: "Close tab or pane",
    keys: [MOD_KEY, "W"],
    group: "Tabs",
    match: (e) => isMod(e) && e.key.toLowerCase() === "w",
  },
  {
    id: "pane.splitRight",
    label: "Split pane right",
    keys: [MOD_KEY, "D"],
    group: "Panes",
    match: (e) => isMod(e) && !e.shiftKey && e.key.toLowerCase() === "d",
  },
  {
    id: "pane.splitDown",
    label: "Split pane down",
    keys: [MOD_KEY, SHIFT_KEY, "D"],
    group: "Panes",
    match: (e) => isMod(e) && e.shiftKey && e.key.toLowerCase() === "d",
  },
  {
    id: "pane.focusNext",
    label: "Focus next pane",
    keys: [MOD_KEY, "]"],
    group: "Panes",
    match: (e) => isMod(e) && !e.shiftKey && e.key === "]",
  },
  {
    id: "pane.focusPrev",
    label: "Focus previous pane",
    keys: [MOD_KEY, "["],
    group: "Panes",
    match: (e) => isMod(e) && !e.shiftKey && e.key === "[",
  },
  {
    id: "tab.next",
    label: "Next tab",
    keys: [CTRL_KEY, TAB_KEY],
    group: "Tabs",
    // Ctrl+Tab is conventionally Ctrl-only on every platform (including macOS).
    match: (e) => e.ctrlKey && !e.shiftKey && e.key === "Tab",
  },
  {
    id: "tab.prev",
    label: "Previous tab",
    keys: [CTRL_KEY, SHIFT_KEY, TAB_KEY],
    group: "Tabs",
    match: (e) => e.ctrlKey && e.shiftKey && e.key === "Tab",
  },
  {
    id: "tab.selectByIndex",
    label: "Jump to tab 1–9",
    keys: [MOD_KEY, "1…9"],
    group: "Tabs",
    match: (e) => isMod(e) && /^[1-9]$/.test(e.key),
  },
  {
    id: "search.focus",
    label: "Find in terminal",
    keys: [MOD_KEY, "F"],
    group: "Search",
    match: (e) => isMod(e) && e.key.toLowerCase() === "f",
  },
  {
    id: "ai.toggle",
    label: "Toggle AI agent",
    keys: [MOD_KEY, "I"],
    group: "AI",
    match: (e) => isMod(e) && e.key.toLowerCase() === "i",
  },
  {
    id: "ai.askSelection",
    label: "Ask AI about selection",
    keys: [MOD_KEY, "L"],
    group: "AI",
    match: (e) => isMod(e) && e.key.toLowerCase() === "l",
  },
  {
    id: "sidebar.toggle",
    label: "Toggle file explorer",
    keys: [MOD_KEY, "B"],
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
