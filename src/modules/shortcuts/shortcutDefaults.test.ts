import {
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { foldKeymap } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import type { KeyBinding as CodeMirrorBinding } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { MAC_DEFAULTS, WIN_LINUX_DEFAULTS } from "./shortcutDefaults";
import {
  type KeyBinding,
  matchBinding,
  SHORTCUTS,
  type ShortcutId,
  tabDigit,
} from "./shortcuts";

// Both tables are tested regardless of the platform the tests run on.

const MAC_EXPECTED = `terminal.clear: Cmd+k
commandPalette.open: Shift+Cmd+p, Cmd+k
commandPalette.files: Cmd+p
commandPalette.content: Shift+Cmd+h
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
agent.toggleReader: Shift+Cmd+r
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

/** Every chord a binding accepts: Jump to tab takes any digit from 1 to 9. */
const accepted = (id: ShortcutId, binding: KeyBinding): KeyBinding[] =>
  id === "tab.selectByIndex"
    ? "123456789".split("").map((key) => ({ ...binding, key }))
    : [binding];

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
  // Ctrl+2 is NUL, Ctrl+3 to Ctrl+7 are ESC, FS, GS, RS and US, Ctrl+8 is DEL.
  ..."2345678".split("").map((key) => ({
    name: `Ctrl+${key}`,
    event: { key, code: `Digit${key}`, ctrlKey: true },
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
  const UNBOUND: ReadonlySet<ShortcutId> = new Set([
    "terminal.clear",
    "agent.toggleReader",
  ]);

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
      for (const binding of table[id].flatMap((b) => accepted(id, b))) {
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
      for (const binding of table[id].flatMap((b) => accepted(id, b))) {
        const text = `${id}: ${describeBinding(binding)}`;
        const plainCtrl =
          !!binding.ctrl && !binding.shift && !binding.alt && !binding.meta;
        expect(
          plainCtrl && /^[a-z@[\\\]^_/\- 2-8]$/i.test(binding.key),
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
      for (const binding of table[id].flatMap((b) => accepted(id, b))) {
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
      hit({ ...ctrl, key: "Enter", code: "Enter" }, "pane.splitDown"),
    ).toBe(true);
    expect(
      hit({ ...ctrl, key: "~", code: "Backquote" }, "tab.newPreview"),
    ).toBe(true);
    expect(hit({ ...ctrl, key: ":", code: "Semicolon" }, "pane.source")).toBe(
      true,
    );
    expect(
      hit(
        { ctrlKey: true, altKey: true, shiftKey: false, key: "PageDown" },
        "space.next",
      ),
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

describe.each([
  ["Windows and Linux", WIN_LINUX_DEFAULTS],
  ["macOS", MAC_DEFAULTS],
])(
  "%s defaults on a layout that moves letters (Dvorak, Colemak)",
  (_, table) => {
    it("never fire for a key that types a different letter", () => {
      const fired: string[] = [];
      for (const id of ids) {
        if (id === "tab.selectByIndex") continue;
        for (const binding of table[id])
          for (const letter of "abcdefghijklmnopqrstuvwxyz".split("")) {
            if (letter === binding.key.toLowerCase()) continue;
            const event = {
              ...eventOf(binding),
              key: binding.shift ? letter.toUpperCase() : letter,
              code: codeOf(binding.key),
            } as KeyboardEvent;
            if (matchBinding(event, binding, id))
              fired.push(`${id} ${describeBinding(binding)} on ${letter}`);
          }
      }
      expect(fired).toEqual([]);
    });
  },
);

describe("Windows and Linux shifted punctuation layout audit", () => {
  it.each([
    ["Dvorak comma", "<", "KeyW", "ai.toggleMini"],
    ["AZERTY period", "/", "Period", "explorer.toggleHidden"],
    ["AZERTY minus", "°", "Minus", "view.zoomOut"],
    ["US minus", "_", "Minus", "view.zoomOut"],
    ["Dvorak slash", "?", "BracketLeft", "explorer.search"],
  ])("%s fires only its intended shortcut", (_, key, code, expected) => {
    const event = {
      key,
      code,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    } as KeyboardEvent;
    const matches = ids.filter((id) =>
      WIN_LINUX_DEFAULTS[id].some((binding) =>
        matchBinding(event, binding, id),
      ),
    );
    expect(matches).toEqual([expected]);
  });
});

describe("Windows and Linux: Jump to tab", () => {
  const binding = WIN_LINUX_DEFAULTS["tab.selectByIndex"][0];
  const press = (key: string, code: string, extra: Partial<KeyboardEvent>) =>
    ({
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      key,
      code,
      ...extra,
    }) as KeyboardEvent;

  it.each([
    ["!", "Digit1", 1],
    ["@", "Digit2", 2],
    ["#", "Digit3", 3],
    ["(", "Digit9", 9],
    ["1", "Digit1", 1],
  ])("takes Ctrl+Shift+%s (%s) as tab %s on any layout", (key, code, digit) => {
    const event = press(key, code, {});
    expect(matchBinding(event, binding, "tab.selectByIndex")).toBe(true);
    expect(tabDigit(event, true)).toBe(digit);
  });

  it.each(["1", "2", "5", "8", "9"])(
    "leaves plain Ctrl+%s to the terminal",
    (digit) => {
      const event = press(digit, `Digit${digit}`, { shiftKey: false });
      expect(matchBinding(event, binding, "tab.selectByIndex")).toBe(false);
    },
  );

  it("ignores Ctrl+Shift+0 and keys that are not digits", () => {
    expect(
      matchBinding(press(")", "Digit0", {}), binding, "tab.selectByIndex"),
    ).toBe(false);
    expect(
      matchBinding(press("A", "KeyA", {}), binding, "tab.selectByIndex"),
    ).toBe(false);
  });
});

/** A CodeMirror key name as the chord it is on Windows and Linux (Mod is Ctrl). */
function codeMirrorChord(name: string, forceShift = false): KeyBinding {
  const parts = name.split(/-(?!$)/);
  const key = parts.pop() ?? "";
  const has = (pattern: RegExp) => parts.some((part) => pattern.test(part));
  return {
    ctrl: has(/^(c|ctrl|control|mod)$/i),
    shift: forceShift || has(/^(s|shift)$/i),
    alt: has(/^(a|alt|option)$/i),
    meta: has(/^(m|meta|cmd|command|super)$/i),
    key: key === "Space" ? " " : key,
  };
}

/** What basicSetup, the shell input and the editor pane install, read from the packages. */
const CODEMIRROR_BINDINGS: readonly CodeMirrorBinding[] = [
  closeBracketsKeymap,
  defaultKeymap,
  searchKeymap,
  historyKeymap,
  foldKeymap,
  completionKeymap,
  lintKeymap,
].flat();

const codeMirrorChords = new Map<string, string>();
for (const binding of CODEMIRROR_BINDINGS)
  for (const platform of ["win", "linux"] as const) {
    const name = binding[platform] ?? binding.key;
    if (!name) continue;
    for (const forceShift of binding.shift ? [false, true] : [false]) {
      const chordOf = codeMirrorChord(name, forceShift);
      codeMirrorChords.set(chord(chordOf), name);
    }
  }

describe("Windows and Linux defaults against the editor's CodeMirror keymaps", () => {
  it("reads the keymaps", () => {
    expect(codeMirrorChords.size).toBeGreaterThan(60);
    expect(codeMirrorChords.get(chord({ ctrl: true, key: "z" }))).toBe("Mod-z");
    expect(
      codeMirrorChords.get(chord({ ctrl: true, shift: true, key: "[" })),
    ).toBe("Ctrl-Shift-[");
  });

  it("never shares a chord with an application shortcut outside the editor", () => {
    const shared: string[] = [];
    for (const id of ids) {
      // The editor keeps the editor group; pane swaps only run in a terminal tab
      // with two panes (shouldDisablePaneSwapShortcut), which holds no editor.
      if (isEditor(id) || id.startsWith("pane.swap")) continue;
      for (const binding of WIN_LINUX_DEFAULTS[id].flatMap((b) =>
        accepted(id, b),
      )) {
        const name = codeMirrorChords.get(chord(binding));
        if (name) shared.push(`${id} ${describeBinding(binding)} = ${name}`);
      }
    }
    expect(shared).toEqual([]);
  });
});

describe("macOS: nothing is unreachable or repeated", () => {
  it("never repeats a chord", () => {
    const owners = new Map<string, string>();
    for (const id of ids)
      for (const binding of MAC_DEFAULTS[id]) {
        const key = chord(binding);
        const other = owners.get(key);
        // Command+K clears a focused terminal and opens the palette elsewhere: the
        // host disables terminal.clear outside a terminal and matching continues.
        const sharedCommandK =
          key === "false|false|false|true|k" &&
          [other, id].sort().join() === "commandPalette.open,terminal.clear";
        expect(
          other === undefined || other === id || sharedCommandK,
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
    "`": "Backquote",
    ";": "Semicolon",
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
