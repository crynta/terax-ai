export type ShortcutId =
  | "tab.new"
  | "tab.close"
  | "tab.next"
  | "tab.prev"
  | "tab.selectByIndex"
  | "search.focus"
  | "ai.toggle"
  | "shortcuts.open";

export type Shortcut = {
  id: ShortcutId;
  label: string;
  keys: string[];
  group: "General" | "Tabs" | "Search" | "AI";
};

export const SHORTCUTS: Shortcut[] = [
  { id: "shortcuts.open", label: "Show keyboard shortcuts", keys: ["⌘", "K"], group: "General" },
  { id: "tab.new", label: "New tab", keys: ["⌘", "T"], group: "Tabs" },
  { id: "tab.close", label: "Close tab", keys: ["⌘", "W"], group: "Tabs" },
  { id: "tab.next", label: "Next tab", keys: ["⌃", "⇥"], group: "Tabs" },
  { id: "tab.prev", label: "Previous tab", keys: ["⌃", "⇧", "⇥"], group: "Tabs" },
  { id: "tab.selectByIndex", label: "Jump to tab 1–9", keys: ["⌘", "1…9"], group: "Tabs" },
  { id: "search.focus", label: "Find in terminal", keys: ["⌘", "F"], group: "Search" },
  { id: "ai.toggle", label: "Toggle AI agent", keys: ["⌘", "I"], group: "AI" },
];

export const SHORTCUT_GROUPS = ["General", "Tabs", "Search", "AI"] as const;
