import { describe, expect, it } from "vitest";
import {
  getBindingTokens,
  type KeyBinding,
  matchBinding,
  SHORTCUTS,
  type ShortcutId,
} from "../shortcuts";
import { nextTerminalFocus } from "./focusContext";
import {
  buildTerminalFocusBindings,
  effectiveBindings,
  terminalFocusDifference,
} from "./terminalFocusPolicy";

// The vitest environment has no Tauri OS plugin, so the registry holds the
// Windows/Linux defaults (Ctrl as the primary modifier).

const table = buildTerminalFocusBindings(SHORTCUTS, false);

const CODES: Record<string, string> = {
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  "-": "Minus",
  _: "Minus",
  "=": "Equal",
  "/": "Slash",
  ".": "Period",
  ",": "Comma",
  "'": "Quote",
  ";": "Semicolon",
  " ": "Space",
  "`": "Backquote",
  "@": "Digit2",
  "^": "Digit6",
};

function codeFor(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return CODES[key] ?? key;
}

function press(key: string, mods: "" | "C" | "CS" | "AS" = "C"): KeyboardEvent {
  return {
    key,
    code: codeFor(key),
    ctrlKey: mods.includes("C"),
    shiftKey: mods.includes("S"),
    altKey: mods.includes("A"),
    metaKey: false,
  } as KeyboardEvent;
}

function eventFor(binding: KeyBinding): KeyboardEvent {
  return {
    key: binding.key,
    code: codeFor(binding.key),
    ctrlKey: !!binding.ctrl,
    shiftKey: !!binding.shift,
    altKey: !!binding.alt,
    metaKey: !!binding.meta,
  } as KeyboardEvent;
}

/** The shortcut the global handler would run, as `useGlobalShortcuts` picks it. */
function resolve(
  event: KeyboardEvent,
  inTerminal: boolean,
  user: Partial<Record<ShortcutId, KeyBinding[]>> = {},
): string | null {
  for (const shortcut of SHORTCUTS) {
    const bindings = effectiveBindings(
      shortcut.id,
      shortcut.defaultBindings,
      user[shortcut.id],
      inTerminal,
    );
    if (bindings.some((b) => matchBinding(event, b, shortcut.id)))
      return shortcut.id;
  }
  return null;
}

const group = (id: string) => SHORTCUTS.find((s) => s.id === id)?.group;

/** Editor shortcuts are disabled by the host outside editor tabs, so the key passes on. */
const reachesTerminal = (id: string | null) =>
  id === null || group(id) === "Editor";

describe("terminal focus policy", () => {
  it("keeps every plain Ctrl chord that is a control byte for the terminal", () => {
    for (const key of [
      ..."abcdefghijklmnopqrstuvwxyz",
      "[",
      "]",
      "\\",
      "-",
      "/",
      "@",
      "^",
      "_",
      " ",
    ]) {
      const owner = resolve(press(key), true);
      expect(
        reachesTerminal(owner),
        `Ctrl+${JSON.stringify(key)}: ${owner}`,
      ).toBe(true);
    }
  });

  it("leaves those chords to the application everywhere else", () => {
    expect(resolve(press("t"), false)).toBe("tab.new");
    expect(resolve(press("w"), false)).toBe("tab.close");
    expect(resolve(press("d"), false)).toBe("pane.splitRight");
    expect(resolve(press("r"), false)).toBe("tab.newPrivate");
    expect(resolve(press("["), false)).toBe("pane.focusPrev");
    expect(resolve(press("]"), false)).toBe("pane.focusNext");
    expect(resolve(press("-"), false)).toBe("view.zoomOut");
  });

  it("gives every displaced command its Ctrl+Shift chord in a terminal", () => {
    const expected: [string, string, ShortcutId][] = [
      ["T", "t", "tab.new"],
      ["W", "w", "tab.close"],
      ["R", "r", "tab.newPrivate"],
      ["G", "g", "pane.source"],
      ["F", "f", "search.focus"],
      ["D", "d", "pane.splitRight"],
      ["I", "i", "ai.toggle"],
      ["E", "e", "tab.newEditor"],
      ["J", "j", "ai.askSelection"],
      ["U", "u", "terminal.toggleInput"],
      ["P", "p", "commandPalette.open"],
      ["{", "[", "pane.focusPrev"],
      ["}", "]", "pane.focusNext"],
    ];
    for (const [shifted, key, id] of expected) {
      const event = { ...press(key, "CS"), key: shifted };
      expect(resolve(event, true), `Ctrl+Shift+${key}`).toBe(id);
    }
  });

  it("moves the command that owned the Ctrl+Shift chord to Alt+Shift", () => {
    const expected: [string, ShortcutId][] = [
      ["t", "tab.newBlock"],
      ["d", "pane.splitDown"],
      ["i", "ai.toggleMini"],
      ["e", "explorer.focus"],
      ["f", "explorer.search"],
      ["p", "commandPalette.content"],
      ["[", "space.prev"],
      ["]", "space.next"],
    ];
    for (const [key, id] of expected) {
      expect(resolve(press(key, "AS"), true), `Alt+Shift+${key}`).toBe(id);
      expect(
        resolve(press(key, "AS"), false),
        `Alt+Shift+${key} outside`,
      ).toBeNull();
    }
  });

  it("only moves a Ctrl+Shift chord while a terminal has focus", () => {
    expect(resolve(press("T", "CS"), false)).toBe("tab.newBlock");
    expect(resolve(press("F", "CS"), false)).toBe("explorer.search");
    expect(resolve(press("I", "CS"), false)).toBe("ai.toggleMini");
  });

  it("does not touch chords without a control byte", () => {
    expect(resolve(press(",", "C"), true)).toBe("settings.open");
    expect(resolve(press("1", "C"), true)).toBe("tab.selectByIndex");
    expect(resolve(press("=", "C"), true)).toBe("view.zoomIn");
    expect(resolve(press("Tab", "C"), true)).toBe("tab.next");
    expect(resolve(press("B", "CS"), true)).toBe("sidebar.toggle");
  });

  it("keeps zooming out reachable through Ctrl+Shift+-", () => {
    expect(resolve({ ...press("-", "CS"), key: "_" }, true)).toBe(
      "view.zoomOut",
    );
  });

  it("never overrides a binding the user chose", () => {
    const user = { "tab.newEditor": [{ ctrl: true, key: "e" }] };
    expect(resolve(press("e"), true, user)).toBe("tab.newEditor");
    expect(resolve(press("e"), false, user)).toBe("tab.newEditor");
    expect(
      resolve(press("t"), true, { "tab.new": [{ ctrl: true, key: "t" }] }),
    ).toBe("tab.new");
  });

  describe("audit", () => {
    // Unbound by default on Windows and Linux.
    const UNBOUND = new Set(["terminal.clear"]);

    it.each([
      ["Windows and Linux", false],
      ["macOS", true],
    ] as const)(
      "every shortcut stays reachable from a terminal (%s)",
      (_name, isMac) => {
        const bindings = buildTerminalFocusBindings(SHORTCUTS, isMac);
        for (const shortcut of SHORTCUTS) {
          if (UNBOUND.has(shortcut.id) && !shortcut.defaultBindings.length)
            continue;
          const own = bindings.get(shortcut.id) ?? [];
          expect(own.length, `${shortcut.id} has no binding`).toBeGreaterThan(
            0,
          );
        }
      },
    );

    it("lets each terminal binding fire the command that owns it, and no other", () => {
      const owners = new Map<string, string>();
      for (const shortcut of SHORTCUTS) {
        const own = table.get(shortcut.id) ?? [];
        for (const binding of own) {
          if (shortcut.id === "tab.selectByIndex") continue;
          const event = eventFor(binding);
          expect(
            resolve(event, true),
            `${shortcut.id}: ${getBindingTokens(binding).join("+")}`,
          ).toBe(shortcut.id);
          const sig = getBindingTokens(binding).join("+").toLowerCase();
          const other = owners.get(sig);
          expect(
            other === undefined || other === shortcut.id,
            `${sig}: ${other} / ${shortcut.id}`,
          ).toBe(true);
          owners.set(sig, shortcut.id);
        }
      }
    });

    it("leaves no managed shortcut on a plain Ctrl control chord", () => {
      for (const shortcut of SHORTCUTS) {
        if (shortcut.group === "Editor") continue;
        for (const binding of table.get(shortcut.id) ?? []) {
          const plainCtrl =
            !!binding.ctrl && !binding.shift && !binding.alt && !binding.meta;
          expect(
            plainCtrl && /^[a-z@[\\\]^_/\- ]$/i.test(binding.key),
            `${shortcut.id} keeps Ctrl+${binding.key}`,
          ).toBe(false);
        }
      }
    });

    it("is the identity on macOS, where the terminal never uses Command", () => {
      const mac = buildTerminalFocusBindings(SHORTCUTS, true);
      for (const shortcut of SHORTCUTS)
        expect(mac.get(shortcut.id)).toBe(shortcut.defaultBindings);
    });
  });

  describe("with the palette split of the Go to file change", () => {
    const registry = [
      {
        id: "commandPalette.open",
        group: "General",
        defaultBindings: [{ ctrl: true, shift: true, key: "p" }],
      },
      {
        id: "commandPalette.files",
        group: "General",
        defaultBindings: [{ ctrl: true, key: "p" }],
      },
      {
        id: "commandPalette.content",
        group: "General",
        defaultBindings: [{ ctrl: true, shift: true, key: "h" }],
      },
    ];

    it("keeps the palette on Ctrl+Shift+P and moves Go to file to Alt+Shift+P", () => {
      const bindings = buildTerminalFocusBindings(registry, false);
      expect(bindings.get("commandPalette.open")).toEqual([
        { ctrl: true, shift: true, key: "p" },
      ]);
      expect(bindings.get("commandPalette.files")).toEqual([
        { alt: true, shift: true, key: "p" },
      ]);
      expect(bindings.get("commandPalette.content")).toEqual([
        { ctrl: true, shift: true, key: "h" },
      ]);
    });
  });

  describe("labels", () => {
    const label = (id: ShortcutId, inTerminal: boolean) =>
      getBindingTokens(
        effectiveBindings(
          id,
          SHORTCUTS.find((s) => s.id === id)?.defaultBindings ?? [],
          undefined,
          inTerminal,
        )[0],
      ).join(" ");

    it("shows the chord that fires from the current focus", () => {
      expect(label("tab.new", false)).toBe("Ctrl T");
      expect(label("tab.new", true)).toBe("Ctrl Shift T");
      expect(label("tab.newBlock", false)).toBe("Ctrl Shift T");
      expect(label("tab.newBlock", true)).toBe("Alt Shift T");
      expect(label("ai.askSelection", true)).toBe("Ctrl Shift J");
      expect(label("pane.focusPrev", true)).toBe("Ctrl Shift [");
    });

    it("reports a terminal difference only for default bindings", () => {
      const defaults = SHORTCUTS.find((s) => s.id === "tab.new")
        ?.defaultBindings as KeyBinding[];
      expect(terminalFocusDifference("tab.new", defaults, undefined)).toEqual([
        { ctrl: true, shift: true, key: "t" },
      ]);
      expect(
        terminalFocusDifference("tab.new", defaults, [
          { ctrl: true, key: "t" },
        ]),
      ).toBeNull();
      expect(
        terminalFocusDifference(
          "settings.open",
          SHORTCUTS.find((s) => s.id === "settings.open")
            ?.defaultBindings as KeyBinding[],
          undefined,
        ),
      ).toBeNull();
    });
  });
});

describe("nextTerminalFocus", () => {
  it.each([
    [false, { inTerminal: true, inOverlay: false }, true],
    [true, { inTerminal: false, inOverlay: false }, false],
    [true, { inTerminal: false, inOverlay: true }, true],
    [false, { inTerminal: false, inOverlay: true }, false],
    [false, { inTerminal: false, inOverlay: false }, false],
  ] as const)("%s + %j -> %s", (current, target, expected) => {
    expect(nextTerminalFocus(current, target)).toBe(expected);
  });
});
