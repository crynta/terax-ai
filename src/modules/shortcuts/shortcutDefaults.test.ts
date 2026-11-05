import { describe, expect, it } from "vitest";
import { MAC_DEFAULTS, WIN_LINUX_DEFAULTS } from "./shortcutDefaults";
import {
  type KeyBinding,
  matchBinding,
  SHORTCUTS,
  type ShortcutId,
} from "./shortcuts";

// Both tables are tested regardless of the platform the tests run on.

const MAC_EXPECTED = `commandPalette.open: Cmd+p
commandPalette.content: Shift+Cmd+p
settings.open: Cmd+,
tab.new: Cmd+t
tab.newBlock: Shift+Cmd+t
tab.newPrivate: Cmd+r
tab.newPreview: Shift+Cmd+o
tab.newEditor: Cmd+e
tab.close: Cmd+w
pane.splitRight: Cmd+d
pane.splitDown: Shift+Cmd+d
pane.focusNext: Cmd+]
pane.focusPrev: Cmd+[
pane.swapLeft: Alt+Cmd+ArrowLeft
pane.swapRight: Alt+Cmd+ArrowRight
pane.swapUp: Alt+Cmd+ArrowUp
pane.swapDown: Alt+Cmd+ArrowDown
pane.source: Cmd+g
terminal.clear: Cmd+k
terminal.toggleInput: Cmd+u
blocks.prev: Cmd+ArrowUp
blocks.next: Cmd+ArrowDown
tab.next: Ctrl+Tab
tab.prev: Ctrl+Shift+Tab
tab.selectByIndex: Cmd+1
space.next: Shift+Cmd+]
space.prev: Shift+Cmd+[
space.overview: Shift+Cmd+s
explorer.search: Shift+Cmd+f
search.focus: Cmd+f
ai.toggle: Cmd+i
ai.toggleMini: Shift+Cmd+i
ai.askSelection: Cmd+j
agent.focusAttention: Shift+Cmd+a
sidebar.toggle: Cmd+b, Shift+Cmd+b
explorer.focus: Shift+Cmd+e
explorer.toggleHidden: Shift+Cmd+.
view.zoomIn: Cmd+=, Shift+Cmd++
view.zoomOut: Cmd+-, Shift+Cmd+_
view.zoomReset: Cmd+0
view.zenMode: Shift+Cmd+'
editor.undo: Cmd+z
editor.redo: Cmd+y, Shift+Cmd+z
editor.save: Cmd+s
editor.aiComplete: Alt+\\
editor.codeComplete: Ctrl+ `;

const describeBinding = (b: KeyBinding): string =>
  [b.ctrl && "Ctrl", b.alt && "Alt", b.shift && "Shift", b.meta && "Cmd", b.key]
    .filter(Boolean)
    .join("+");

/** Shifted symbols and their unshifted keys: one physical chord. */
const SHIFTED: Record<string, string> = {
  _: "-",
  "+": "=",
  "?": "/",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "~": "`",
  "{": "[",
  "}": "]",
};

const chord = (b: KeyBinding): string =>
  [
    !!b.ctrl,
    !!b.shift,
    !!b.alt,
    !!b.meta,
    SHIFTED[b.key] ?? b.key.toLowerCase(),
  ].join("|");

const group = (id: string) => SHORTCUTS.find((s) => s.id === id)?.group;
const isEditor = (id: string) => group(id) === "Editor";

describe("macOS defaults", () => {
  it("are exactly what shipped before the Windows and Linux map was split", () => {
    const text = SHORTCUTS.map(
      (s) => `${s.id}: ${MAC_DEFAULTS[s.id].map(describeBinding).join(", ")}`,
    ).join("\n");
    expect(text).toBe(MAC_EXPECTED);
  });
});

/** Chords a terminal program reads: readline, emacs, vim, nano, tmux, less, mc, htop. */
const TUI_EVENTS: { name: string; event: Partial<KeyboardEvent> }[] = [
  ..."abcdefghijklmnopqrstuvwxyz".split("").map((key) => ({
    name: `Ctrl+${key}`,
    event: { key, code: `Key${key.toUpperCase()}`, ctrlKey: true },
  })),
  ...[
    ["[", "BracketLeft"],
    ["]", "BracketRight"],
    ["\\", "Backslash"],
    ["-", "Minus"],
    ["/", "Slash"],
    [" ", "Space"],
    ["@", "Digit2"],
    ["^", "Digit6"],
    ["_", "Minus"],
  ].map(([key, code]) => ({
    name: `Ctrl+${JSON.stringify(key)}`,
    event: { key, code, ctrlKey: true },
  })),
  // Meta bindings: M-b, M-f, M-d, M-., M-<, M->, M-{, M-}, M-Backspace, M-digit
  ..."abcdefghijklmnopqrstuvwxyz0123456789.<>{}[]".split("").flatMap((key) => [
    { name: `Alt+${key}`, event: { key, code: "", altKey: true } },
    {
      name: `Alt+Shift+${key}`,
      event: { key, code: "", altKey: true, shiftKey: true },
    },
  ]),
  ...[
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Backspace",
    "Enter",
  ].flatMap((key) => [
    { name: `Alt+${key}`, event: { key, code: key, altKey: true } },
    { name: `Ctrl+${key}`, event: { key, code: key, ctrlKey: true } },
  ]),
  ...["Home", "End", "PageUp", "PageDown", "Delete", "Insert"].map((key) => ({
    name: `Ctrl+${key}`,
    event: { key, code: key, ctrlKey: true },
  })),
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`).flatMap(
    (key) => [
      { name: key, event: { key, code: key } },
      { name: `Shift+${key}`, event: { key, code: key, shiftKey: true } },
      { name: `Ctrl+${key}`, event: { key, code: key, ctrlKey: true } },
    ],
  ),
];

/** Claimed by the OS, the clipboard or an input method. */
const RESERVED: KeyBinding[] = [
  { ctrl: true, shift: true, key: "c" },
  { ctrl: true, shift: true, key: "v" },
  { ctrl: true, shift: true, key: "u" },
  { ctrl: true, shift: true, key: "e" },
  { ctrl: true, shift: true, key: " " },
  { ctrl: true, key: " ", shift: false },
  { alt: true, key: "Tab" },
  { alt: true, key: "F4" },
];

const eventOf = (b: KeyBinding): KeyboardEvent =>
  ({
    key: b.key,
    code: "",
    ctrlKey: !!b.ctrl,
    shiftKey: !!b.shift,
    altKey: !!b.alt,
    metaKey: !!b.meta,
  }) as KeyboardEvent;

const ids = SHORTCUTS.map((s) => s.id);

describe("Windows and Linux defaults", () => {
  const table = WIN_LINUX_DEFAULTS;
  /** More than one chord on purpose: the shifted symbol of a key on the US layout. */
  const TWO_BINDINGS: ReadonlySet<ShortcutId> = new Set([
    "view.zoomIn",
    "editor.redo",
  ]);
  /** Deliberately unbound: Ctrl+K is readline's kill-line. */
  const UNBOUND: ReadonlySet<ShortcutId> = new Set(["terminal.clear"]);

  it("covers every shortcut", () => {
    expect(Object.keys(table).sort()).toEqual([...ids].sort());
  });

  it("gives every shortcut exactly one default (zoom in and redo have the shifted spelling too)", () => {
    for (const id of ids) {
      if (UNBOUND.has(id)) {
        expect(table[id], id).toEqual([]);
        continue;
      }
      expect(table[id].length, id).toBe(TWO_BINDINGS.has(id) ? 2 : 1);
    }
  });

  it("never repeats a chord anywhere in the app", () => {
    const owners = new Map<string, string>();
    for (const id of ids)
      for (const binding of table[id]) {
        const key = chord(binding);
        const other = owners.get(key);
        expect(
          other === undefined || other === id,
          `${describeBinding(binding)}: ${other} and ${id}`,
        ).toBe(true);
        owners.set(key, id);
      }
  });

  it("never uses a chord a terminal program reads", () => {
    for (const id of ids) {
      if (isEditor(id)) continue;
      for (const binding of table[id]) {
        for (const tui of TUI_EVENTS)
          expect(
            matchBinding(tui.event as KeyboardEvent, binding, id),
            `${id} (${describeBinding(binding)}) collides with ${tui.name}`,
          ).toBe(false);
      }
    }
  });

  it("never uses a plain Ctrl control byte, an Alt chord or Ctrl+Alt+character outside the editor", () => {
    for (const id of ids) {
      if (isEditor(id)) continue;
      for (const binding of table[id]) {
        const text = `${id}: ${describeBinding(binding)}`;
        const plainCtrl =
          !!binding.ctrl && !binding.shift && !binding.alt && !binding.meta;
        expect(
          plainCtrl && /^[a-z@[\\\]^_/\- ]$/i.test(binding.key),
          text,
        ).toBe(false);
        expect(!!binding.alt && !binding.ctrl, `${text} is a Meta chord`).toBe(
          false,
        );
        expect(
          !!binding.alt && !!binding.ctrl && binding.key.length === 1,
          `${text} is AltGr on many layouts`,
        ).toBe(false);
        expect(/^F\d+$/.test(binding.key), `${text} is a function key`).toBe(
          false,
        );
      }
    }
  });

  it("stays clear of OS, clipboard and input method chords", () => {
    for (const id of ids)
      for (const binding of isEditor(id) ? [] : table[id])
        for (const reserved of RESERVED)
          expect(
            chord(binding) === chord(reserved),
            `${id}: ${describeBinding(binding)}`,
          ).toBe(false);
  });

  it("fires each default for its own shortcut only", () => {
    for (const id of ids)
      for (const binding of table[id]) {
        const matches = SHORTCUTS.filter((shortcut) =>
          table[shortcut.id].some((b) =>
            matchBinding(
              {
                ...eventOf(binding),
                code: codeOf(binding.key),
              } as KeyboardEvent,
              b,
              shortcut.id,
            ),
          ),
        ).map((shortcut) => shortcut.id);
        expect(matches, describeBinding(binding)).toEqual([id]);
      }
  });

  it("matches the keys the layout types for the symbol chords", () => {
    const hit = (event: Partial<KeyboardEvent>, id: ShortcutId) =>
      table[id].some((b) =>
        matchBinding(
          {
            ctrlKey: false,
            shiftKey: true,
            altKey: false,
            metaKey: false,
            ...event,
          } as KeyboardEvent,
          b,
          id,
        ),
      );
    const ctrl = { ctrlKey: true };
    expect(
      hit({ ...ctrl, key: "|", code: "Backslash" }, "pane.splitDown"),
    ).toBe(true);
    expect(hit({ ...ctrl, key: "?", code: "Slash" }, "explorer.search")).toBe(
      true,
    );
    expect(hit({ ...ctrl, key: "<", code: "Comma" }, "ai.toggleMini")).toBe(
      true,
    );
    expect(hit({ ...ctrl, key: "_", code: "Minus" }, "view.zoomOut")).toBe(
      true,
    );
    expect(
      hit({ ...ctrl, key: "PageDown", code: "PageDown" }, "pane.focusNext"),
    ).toBe(true);
    expect(
      hit({ ...ctrl, key: "PageUp", code: "PageUp" }, "pane.focusPrev"),
    ).toBe(true);
    expect(hit({ ...ctrl, key: "Q", code: "KeyQ" }, "tab.newBlock")).toBe(true);
  });
});

describe("macOS: nothing is unreachable or repeated", () => {
  it("never repeats a chord", () => {
    const owners = new Map<string, string>();
    for (const id of ids)
      for (const binding of MAC_DEFAULTS[id]) {
        const key = chord(binding);
        const other = owners.get(key);
        // Command+K is the terminal clear and, pending the palette change, shared by design.
        expect(
          other === undefined || other === id,
          `${describeBinding(binding)}: ${other} and ${id}`,
        ).toBe(true);
        owners.set(key, id);
      }
  });
});

function codeOf(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  const map: Record<string, string> = {
    "\\": "Backslash",
    "/": "Slash",
    ",": "Comma",
    ".": "Period",
    "-": "Minus",
    _: "Minus",
    "=": "Equal",
    "+": "Equal",
    "[": "BracketLeft",
    "]": "BracketRight",
    "'": "Quote",
    " ": "Space",
  };
  return map[key] ?? key;
}
