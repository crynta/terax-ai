import { IS_MAC } from "@/lib/platform";
import { MAC_DEFAULTS, WIN_LINUX_DEFAULTS } from "./shortcutDefaults";

/**
 * Single source of truth for keyboard shortcuts.
 */

export type ShortcutId =
  | "commandPalette.open"
  | "commandPalette.files"
  | "commandPalette.content"
  | "tab.new"
  | "tab.newBlock"
  | "tab.newPrivate"
  | "tab.newPreview"
  | "tab.newEditor"
  | "tab.close"
  | "tab.next"
  | "tab.prev"
  | "tab.selectByIndex"
  | "space.next"
  | "space.prev"
  | "space.overview"
  | "pane.splitRight"
  | "pane.splitDown"
  | "pane.focusNext"
  | "pane.focusPrev"
  | "pane.swapLeft"
  | "pane.swapRight"
  | "pane.swapUp"
  | "pane.swapDown"
  | "pane.source"
  | "terminal.clear"
  | "terminal.passwordManager"
  | "terminal.toggleInput"
  | "blocks.prev"
  | "blocks.next"
  | "search.focus"
  | "explorer.search"
  | "explorer.focus"
  | "explorer.toggleHidden"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "view.zenMode"
  | "ai.toggle"
  | "ai.toggleMini"
  | "ai.askSelection"
  | "agent.focusAttention"
  | "settings.open"
  | "sidebar.toggle"
  | "editor.undo"
  | "editor.redo"
  | "editor.save"
  | "editor.aiComplete"
  | "editor.codeComplete";

export type ShortcutGroup =
  | "General"
  | "Tabs"
  | "Spaces"
  | "Panes"
  | "Terminal"
  | "Search"
  | "AI"
  | "View"
  | "Editor";

export type KeyBinding = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export type Shortcut = {
  id: ShortcutId;
  label: string;
  group: ShortcutGroup;
  defaultBindings: KeyBinding[];
  allowRepeat?: boolean;
};

// Matching walks this list in order and skips a shortcut its host disables, so
// terminal.clear stays ahead of commandPalette.open: on macOS ⌘K clears a
// focused terminal and opens the palette everywhere else.
const SHORTCUT_META: Omit<Shortcut, "defaultBindings">[] = [
  {
    id: "terminal.clear",
    label: "Clear terminal",
    group: "Terminal",
  },
  {
    id: "commandPalette.open",
    label: "Open command palette",
    group: "General",
  },
  {
    id: "commandPalette.files",
    label: "Go to file",
    group: "General",
  },
  {
    id: "commandPalette.content",
    label: "Find in files",
    group: "General",
  },
  {
    id: "settings.open",
    label: "Open settings",
    group: "General",
  },
  {
    id: "tab.new",
    label: "New tab",
    group: "Tabs",
  },
  {
    id: "tab.newBlock",
    label: "New Blocks terminal",
    group: "Tabs",
  },
  {
    id: "tab.newPrivate",
    label: "New private terminal",
    group: "Tabs",
  },
  {
    id: "tab.newPreview",
    label: "New web preview",
    group: "Tabs",
  },
  {
    id: "tab.newEditor",
    label: "New editor tab",
    group: "Tabs",
  },
  {
    id: "tab.close",
    label: "Close tab or pane",
    group: "Tabs",
  },
  {
    id: "pane.splitRight",
    label: "Split pane right",
    group: "Panes",
  },
  {
    id: "pane.splitDown",
    label: "Split pane down",
    group: "Panes",
  },
  {
    id: "pane.focusNext",
    label: "Focus next pane",
    group: "Panes",
  },
  {
    id: "pane.focusPrev",
    label: "Focus previous pane",
    group: "Panes",
  },
  {
    id: "pane.swapLeft",
    label: "Swap pane left",
    group: "Panes",
  },
  {
    id: "pane.swapRight",
    label: "Swap pane right",
    group: "Panes",
  },
  {
    id: "pane.swapUp",
    label: "Swap pane up",
    group: "Panes",
  },
  {
    id: "pane.swapDown",
    label: "Swap pane down",
    group: "Panes",
  },
  {
    id: "pane.source",
    label: "Toggle source panel",
    group: "Panes",
  },
  {
    id: "terminal.passwordManager",
    label: "Insert terminal password",
    group: "Terminal",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "l" }],
  },
  {
    id: "terminal.toggleInput",
    label: "Toggle Shell / AI input",
    group: "Terminal",
  },
  {
    id: "blocks.prev",
    label: "Previous command block",
    group: "Terminal",
    allowRepeat: true,
  },
  {
    id: "blocks.next",
    label: "Next command block",
    group: "Terminal",
    allowRepeat: true,
  },
  {
    id: "tab.next",
    label: "Next tab",
    group: "Tabs",
    allowRepeat: true,
  },
  {
    id: "tab.prev",
    label: "Previous tab",
    group: "Tabs",
    allowRepeat: true,
  },
  {
    id: "tab.selectByIndex",
    label: "Jump to tab 1\u20139",
    group: "Tabs",
  },
  {
    id: "space.next",
    label: "Next space",
    group: "Spaces",
  },
  {
    id: "space.prev",
    label: "Previous space",
    group: "Spaces",
  },
  {
    id: "space.overview",
    label: "Open spaces",
    group: "Spaces",
  },
  {
    id: "explorer.search",
    label: "Search files",
    group: "Search",
  },
  {
    id: "search.focus",
    label: "Find in tab",
    group: "Search",
  },
  {
    id: "ai.toggle",
    label: "Toggle AI agent",
    group: "AI",
  },
  {
    id: "ai.toggleMini",
    label: "Toggle AI chat window",
    group: "AI",
  },
  {
    id: "ai.askSelection",
    label: "Ask AI about selection",
    group: "AI",
  },
  {
    id: "agent.focusAttention",
    label: "Jump to agent needing attention",
    group: "AI",
  },
  {
    id: "sidebar.toggle",
    label: "Toggle file explorer",
    group: "View",
  },
  {
    id: "explorer.focus",
    label: "Toggle file explorer focus",
    group: "View",
  },
  {
    id: "explorer.toggleHidden",
    label: "Toggle hidden files",
    group: "View",
  },
  {
    id: "view.zoomIn",
    label: "Zoom in",
    group: "View",
    allowRepeat: true,
  },
  {
    id: "view.zoomOut",
    label: "Zoom out",
    group: "View",
    allowRepeat: true,
  },
  {
    id: "view.zoomReset",
    label: "Reset zoom",
    group: "View",
  },
  {
    id: "view.zenMode",
    label: "Toggle zen mode",
    group: "View",
  },
  {
    id: "editor.undo",
    label: "Undo",
    group: "Editor",
  },
  {
    id: "editor.redo",
    label: "Redo",
    group: "Editor",
  },
  {
    id: "editor.save",
    label: "Save file",
    group: "Editor",
  },
  {
    id: "editor.aiComplete",
    label: "Trigger AI completion",
    group: "Editor",
  },
  {
    id: "editor.codeComplete",
    label: "Trigger code completion",
    group: "Editor",
  },
];

export function buildShortcuts(isMac: boolean): Shortcut[] {
  const defaults = isMac ? MAC_DEFAULTS : WIN_LINUX_DEFAULTS;
  return SHORTCUT_META.map((meta) => ({
    ...meta,
    defaultBindings: [...defaults[meta.id]],
  }));
}

export const SHORTCUTS: Shortcut[] = buildShortcuts(IS_MAC);

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  "General",
  "Tabs",
  "Panes",
  "Terminal",
  "View",
  "Search",
  "AI",
  "Editor",
];

/**
 * Matching logic: checks if a KeyboardEvent matches a KeyBinding.
 */
const CODE_TO_KEY: Record<string, string> = {
  Backslash: "\\",
  Slash: "/",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Space: " ",
};

const UNSHIFTED_PUNCTUATION: Record<string, string> = {
  "~": "`",
  _: "-",
  "+": "=",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
};
const PUNCTUATION_BASE_KEYS = new Set(Object.values(UNSHIFTED_PUNCTUATION));

// Option and Shift combinations rewrite e.key (macOS Option gives "«", "…",
// dead keys; Shift turns "." into ">"); the physical key survives in e.code.
function keyFromCode(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  return CODE_TO_KEY[code] ?? null;
}

/**
 * The digit 1 to 9 a Jump to tab press names. Under Shift the key is a symbol
 * (`!`, `@`), so the physical digit key is read instead.
 */
export function tabDigit(
  e: Pick<KeyboardEvent, "key" | "code">,
  byCode: boolean,
): number | null {
  const digit = byCode
    ? /^Digit([1-9])$/.exec(e.code)?.[1]
    : /^[1-9]$/.exec(e.key)?.[0];
  return digit === undefined ? null : Number(digit);
}

export function matchBinding(
  e: KeyboardEvent,
  binding: KeyBinding,
  id?: ShortcutId,
  recorded = false,
): boolean {
  const eventKey = e.key.toLowerCase();
  const bindingKey = binding.key.toLowerCase();

  // Special case for Jump to Tab 1-9
  if (id === "tab.selectByIndex") {
    if (tabDigit(e, !!binding.shift) === null) return false;
  } else if (recorded) {
    // The recorder stores KeyboardEvent.key verbatim, including layout symbols.
    if (eventKey !== bindingKey) return false;
  } else if (binding.shift && !binding.alt && UNSHIFTED_PUNCTUATION[eventKey]) {
    // Recognized shifted punctuation names its logical key, even on Dvorak.
    if (
      UNSHIFTED_PUNCTUATION[eventKey] !==
      (UNSHIFTED_PUNCTUATION[bindingKey] ?? bindingKey)
    )
      return false;
  } else if (
    eventKey !== bindingKey ||
    (binding.shift && !binding.alt && PUNCTUATION_BASE_KEYS.has(bindingKey))
  ) {
    if (!binding.alt && !binding.shift) return false;
    // A Latin letter is the layout's own answer (Dvorak, Colemak).
    if (/^[a-z]$/.test(eventKey)) return false;
    // Shift alone cannot turn punctuation into a letter shortcut.
    if (
      !binding.alt &&
      /^[a-z]$/.test(bindingKey) &&
      eventKey.length === 1 &&
      !/^\p{L}$/u.test(eventKey)
    )
      return false;
    if (keyFromCode(e.code) !== bindingKey) return false;
  }

  return (
    !!e.ctrlKey === !!binding.ctrl &&
    !!e.shiftKey === !!binding.shift &&
    !!e.altKey === !!binding.alt &&
    !!e.metaKey === !!binding.meta
  );
}

/**
 * Display helpers
 */
export function getBindingTokens(binding?: KeyBinding): string[] {
  if (!binding) return [];
  const tokens: string[] = [];
  if (IS_MAC) {
    if (binding.ctrl) tokens.push("⌃");
    if (binding.alt) tokens.push("⌥");
    if (binding.shift) tokens.push("⇧");
    if (binding.meta) tokens.push("⌘");
  } else {
    if (binding.ctrl) tokens.push("Ctrl");
    if (binding.alt) tokens.push("Alt");
    if (binding.shift) tokens.push("Shift");
    if (binding.meta) tokens.push("Win");
  }

  let keyLabel = binding.key;
  if (keyLabel === " ") keyLabel = "Space";
  else if (keyLabel === "ArrowUp") keyLabel = "↑";
  else if (keyLabel === "ArrowDown") keyLabel = "↓";
  else if (keyLabel === "ArrowLeft") keyLabel = "←";
  else if (keyLabel === "ArrowRight") keyLabel = "→";
  else if (keyLabel.length === 1) keyLabel = keyLabel.toUpperCase();

  tokens.push(keyLabel);
  return tokens;
}
