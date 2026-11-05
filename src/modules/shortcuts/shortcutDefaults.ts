import type { KeyBinding, ShortcutId } from "./shortcuts";

/**
 * Default bindings, one table per platform family. A shortcut means the same
 * thing wherever focus is: nothing here depends on what has focus.
 *
 * macOS keeps Command as the primary modifier, which no terminal program uses.
 *
 * On Windows and Linux Ctrl is also the modifier of every readline and TUI
 * binding (Ctrl+P/N history, R search, E/A line ends, W/U/K/Y kill and yank, D
 * end of input, Ctrl+[ for Escape, Ctrl+] tag jump, Ctrl+- undo ...), so an
 * application default there is never a plain Ctrl chord that is a control
 * byte, never an Alt or Alt+Shift chord (Meta bindings of readline, emacs,
 * nano and tmux), never an unmodified or Shift function key (mc, htop, vim),
 * and never Ctrl+Alt+<character> (AltGr on many layouts). Commands take
 * Ctrl+Shift+<key> as Windows Terminal and VS Code's terminal do, plus Ctrl
 * with a digit, a comma or an equals sign. Ctrl+Shift+C/V are the clipboard,
 * and Ctrl+Shift+U/E belong to the GTK and IBus input methods. Editor
 * shortcuts keep their plain Ctrl chords: the host only runs them in editor
 * tabs, which never hold a terminal.
 */

export const MAC_DEFAULTS: Readonly<Record<ShortcutId, readonly KeyBinding[]>> =
  {
    "terminal.clear": [{ meta: true, key: "k" }],
    "commandPalette.open": [
      { shift: true, meta: true, key: "p" },
      { meta: true, key: "k" },
    ],
    "commandPalette.files": [{ meta: true, key: "p" }],
    "commandPalette.content": [{ shift: true, meta: true, key: "h" }],
    "settings.open": [{ meta: true, key: "," }],
    "tab.new": [{ meta: true, key: "t" }],
    "tab.newBlock": [{ shift: true, meta: true, key: "t" }],
    "tab.newPrivate": [{ meta: true, key: "r" }],
    "tab.newPreview": [{ shift: true, meta: true, key: "o" }],
    "tab.newEditor": [{ meta: true, key: "e" }],
    "tab.close": [{ meta: true, key: "w" }],
    "pane.splitRight": [{ meta: true, key: "d" }],
    "pane.splitDown": [{ shift: true, meta: true, key: "d" }],
    "pane.focusNext": [{ meta: true, key: "]" }],
    "pane.focusPrev": [{ meta: true, key: "[" }],
    "pane.swapLeft": [{ alt: true, meta: true, key: "ArrowLeft" }],
    "pane.swapRight": [{ alt: true, meta: true, key: "ArrowRight" }],
    "pane.swapUp": [{ alt: true, meta: true, key: "ArrowUp" }],
    "pane.swapDown": [{ alt: true, meta: true, key: "ArrowDown" }],
    "pane.source": [{ meta: true, key: "g" }],
    "terminal.toggleInput": [{ meta: true, key: "u" }],
    "blocks.prev": [{ meta: true, key: "ArrowUp" }],
    "blocks.next": [{ meta: true, key: "ArrowDown" }],
    "tab.next": [{ ctrl: true, key: "Tab" }],
    "tab.prev": [{ ctrl: true, shift: true, key: "Tab" }],
    "tab.selectByIndex": [{ meta: true, key: "1" }],
    "space.next": [{ shift: true, meta: true, key: "]" }],
    "space.prev": [{ shift: true, meta: true, key: "[" }],
    "space.overview": [{ shift: true, meta: true, key: "s" }],
    "explorer.search": [{ shift: true, meta: true, key: "f" }],
    "search.focus": [{ meta: true, key: "f" }],
    "ai.toggle": [{ meta: true, key: "i" }],
    "ai.toggleMini": [{ shift: true, meta: true, key: "i" }],
    "ai.askSelection": [{ meta: true, key: "j" }],
    "agent.focusAttention": [{ shift: true, meta: true, key: "a" }],
    "sidebar.toggle": [
      { meta: true, key: "b" },
      { shift: true, meta: true, key: "b" },
    ],
    "explorer.focus": [{ shift: true, meta: true, key: "e" }],
    "explorer.toggleHidden": [{ shift: true, meta: true, key: "." }],
    "view.zoomIn": [
      { meta: true, key: "=" },
      { shift: true, meta: true, key: "+" },
    ],
    "view.zoomOut": [
      { meta: true, key: "-" },
      { shift: true, meta: true, key: "_" },
    ],
    "view.zoomReset": [{ meta: true, key: "0" }],
    "view.zenMode": [{ shift: true, meta: true, key: "'" }],
    "editor.undo": [{ meta: true, key: "z" }],
    "editor.redo": [
      { meta: true, key: "y" },
      { shift: true, meta: true, key: "z" },
    ],
    "editor.save": [{ meta: true, key: "s" }],
    "editor.aiComplete": [{ alt: true, key: "\\" }],
    "editor.codeComplete": [{ ctrl: true, key: " " }],
  };

const CS = { ctrl: true, shift: true } as const;

export const WIN_LINUX_DEFAULTS: Readonly<
  Record<ShortcutId, readonly KeyBinding[]>
> = {
  "commandPalette.open": [{ ...CS, key: "p" }],
  "commandPalette.files": [{ ...CS, key: "o" }],
  "commandPalette.content": [{ ...CS, key: "h" }],
  "settings.open": [{ ctrl: true, key: "," }],
  "tab.new": [{ ...CS, key: "t" }],
  "tab.newBlock": [{ ...CS, key: "q" }],
  "tab.newPrivate": [{ ...CS, key: "r" }],
  "tab.newPreview": [{ ...CS, key: "l" }],
  "tab.newEditor": [{ ...CS, key: "n" }],
  "tab.close": [{ ...CS, key: "w" }],
  "pane.splitRight": [{ ...CS, key: "d" }],
  "pane.splitDown": [{ ...CS, key: "\\" }],
  "pane.focusNext": [{ ...CS, key: "PageDown" }],
  "pane.focusPrev": [{ ...CS, key: "PageUp" }],
  "pane.swapLeft": [{ ctrl: true, alt: true, key: "ArrowLeft" }],
  "pane.swapRight": [{ ctrl: true, alt: true, key: "ArrowRight" }],
  "pane.swapUp": [{ ctrl: true, alt: true, key: "ArrowUp" }],
  "pane.swapDown": [{ ctrl: true, alt: true, key: "ArrowDown" }],
  "pane.source": [{ ...CS, key: "g" }],
  "terminal.clear": [],
  "terminal.toggleInput": [{ ...CS, key: "y" }],
  "blocks.prev": [{ ...CS, key: "ArrowUp" }],
  "blocks.next": [{ ...CS, key: "ArrowDown" }],
  "tab.next": [{ ctrl: true, key: "Tab" }],
  "tab.prev": [{ ...CS, key: "Tab" }],
  "tab.selectByIndex": [{ ctrl: true, key: "1" }],
  "space.next": [{ ...CS, key: "]" }],
  "space.prev": [{ ...CS, key: "[" }],
  "space.overview": [{ ...CS, key: "s" }],
  "explorer.search": [{ ...CS, key: "/" }],
  "search.focus": [{ ...CS, key: "f" }],
  "ai.toggle": [{ ...CS, key: "i" }],
  "ai.toggleMini": [{ ...CS, key: "," }],
  "ai.askSelection": [{ ...CS, key: "j" }],
  "agent.focusAttention": [{ ...CS, key: "a" }],
  "sidebar.toggle": [{ ...CS, key: "b" }],
  "explorer.focus": [{ ...CS, key: "x" }],
  "explorer.toggleHidden": [{ ...CS, key: "." }],
  "view.zoomIn": [
    { ctrl: true, key: "=" },
    { ...CS, key: "+" },
  ],
  "view.zoomOut": [{ ...CS, key: "_" }],
  "view.zoomReset": [{ ctrl: true, key: "0" }],
  "view.zenMode": [{ ...CS, key: "'" }],
  "editor.undo": [{ ctrl: true, key: "z" }],
  "editor.redo": [
    { ctrl: true, key: "y" },
    { ...CS, key: "z" },
  ],
  "editor.save": [{ ctrl: true, key: "s" }],
  "editor.aiComplete": [{ alt: true, key: "\\" }],
  "editor.codeComplete": [{ ctrl: true, key: " " }],
};
