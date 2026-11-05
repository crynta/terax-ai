import { describe, expect, it } from "vitest";
import { MOD_PROP } from "@/lib/platform";
import {
  getBindingTokens,
  type KeyBinding,
  matchBinding,
  SHORTCUTS,
  type Shortcut,
  shouldDeferForTerminalFocus,
} from "./shortcuts";

// These tests run in the vitest node environment, where the Tauri OS plugin is
// unavailable so `IS_MAC` resolves to false. That makes the non-mac token
// branch deterministic across host platforms.

function event(over: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...over,
  } as KeyboardEvent;
}

describe("getBindingTokens", () => {
  it("returns nothing for an undefined binding", () => {
    expect(getBindingTokens(undefined)).toEqual([]);
  });

  it("lists modifiers in order, then the key", () => {
    const binding: KeyBinding = { key: "k", ctrl: true, shift: true };
    expect(getBindingTokens(binding)).toEqual(["Ctrl", "Shift", "K"]);
  });

  it("labels space and arrow keys", () => {
    expect(getBindingTokens({ key: " ", meta: true })).toEqual([
      "Win",
      "Space",
    ]);
    expect(getBindingTokens({ key: "ArrowUp", alt: true })).toEqual([
      "Alt",
      "↑",
    ]);
  });

  it("uppercases a single-character key", () => {
    expect(getBindingTokens({ key: "c" })).toEqual(["C"]);
  });
});

describe("matchBinding", () => {
  it("matches when key and all modifiers agree", () => {
    expect(
      matchBinding(event({ key: "c", ctrlKey: true }), {
        key: "c",
        ctrl: true,
      }),
    ).toBe(true);
  });

  it("matches the key case-insensitively", () => {
    expect(
      matchBinding(event({ key: "C", ctrlKey: true }), {
        key: "c",
        ctrl: true,
      }),
    ).toBe(true);
  });

  it("fails when a required modifier is missing", () => {
    expect(matchBinding(event({ key: "c" }), { key: "c", ctrl: true })).toBe(
      false,
    );
  });

  it("fails when an extra modifier is pressed", () => {
    expect(
      matchBinding(event({ key: "c", ctrlKey: true, shiftKey: true }), {
        key: "c",
        ctrl: true,
      }),
    ).toBe(false);
  });

  it("falls back to the physical code for alt combinations", () => {
    // Alt often rewrites e.key (here to "ç"); the binding still matches via e.code.
    expect(
      matchBinding(event({ key: "ç", code: "KeyC", altKey: true }), {
        key: "c",
        alt: true,
      }),
    ).toBe(true);
    expect(
      matchBinding(event({ key: "ç", code: "KeyD", altKey: true }), {
        key: "c",
        alt: true,
      }),
    ).toBe(false);
  });

  it("falls back to the physical code for shift combinations", () => {
    // Shift turns Period into ">"; ⌘⇧. still matches the "." binding.
    expect(
      matchBinding(
        event({ key: ">", code: "Period", shiftKey: true, metaKey: true }),
        { key: ".", shift: true, meta: true },
      ),
    ).toBe(true);
    expect(
      matchBinding(
        event({ key: ">", code: "Comma", shiftKey: true, metaKey: true }),
        { key: ".", shift: true, meta: true },
      ),
    ).toBe(false);
  });

  it("does not fall back to the physical code without alt or shift", () => {
    expect(
      matchBinding(event({ key: "ç", code: "KeyC", metaKey: true }), {
        key: "c",
        meta: true,
      }),
    ).toBe(false);
  });

  it("only accepts digit keys for the jump-to-tab shortcut", () => {
    expect(
      matchBinding(event({ key: "3" }), { key: "1" }, "tab.selectByIndex"),
    ).toBe(true);
    expect(
      matchBinding(event({ key: "x" }), { key: "1" }, "tab.selectByIndex"),
    ).toBe(false);
  });
});

describe("SHORTCUTS registry", () => {
  it("binds Mod+S to editor.save", () => {
    const save = SHORTCUTS.find((s) => s.id === "editor.save");
    expect(save).toBeDefined();
    expect(save!.defaultBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "s", [MOD_PROP]: true }),
      ]),
    );
  });
});

describe("palette shortcuts", () => {
  const defaults = (id: string) =>
    SHORTCUTS.find((s) => s.id === id)?.defaultBindings ?? [];
  const press = (key: string, over: Partial<KeyboardEvent>) =>
    event({ key, ...over });

  it("opens files on the primary modifier + P and commands with Shift", () => {
    const [files] = defaults("commandPalette.files");
    const [commands] = defaults("commandPalette.open");
    expect(matchBinding(press("p", { ctrlKey: true }), files)).toBe(true);
    expect(
      matchBinding(press("P", { ctrlKey: true, shiftKey: true }), commands),
    ).toBe(true);
    expect(
      matchBinding(press("p", { ctrlKey: true, shiftKey: true }), files),
    ).toBe(false);
  });

  it("keeps the macOS terminal clear ahead of the palette on the shared key", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(ids.indexOf("terminal.clear")).toBeLessThan(
      ids.indexOf("commandPalette.open"),
    );
  });

  it("gives no default binding to two shortcuts in the same context", () => {
    const seen = new Map<string, string>();
    for (const s of SHORTCUTS) {
      if (s.id === "tab.selectByIndex") continue;
      for (const b of s.defaultBindings) {
        const sig = [b.ctrl, b.shift, b.alt, b.meta, b.key.toLowerCase()].join(
          "|",
        );
        const other = seen.get(sig);
        // Documented overlaps: ⌘K (clear vs palette) is resolved by scope.
        if (other && !(sig.endsWith("|k") && s.id === "commandPalette.open")) {
          throw new Error(`${s.id} and ${other} share ${sig}`);
        }
        seen.set(sig, s.id);
      }
    }
  });
});

function findShortcut(id: Shortcut["id"]): Shortcut {
  const s = SHORTCUTS.find((x) => x.id === id);
  if (!s) throw new Error(`test setup: missing shortcut ${id}`);
  return s;
}

describe("shouldDeferForTerminalFocus", () => {
  it("never defers when TUI passthrough is disabled (even inside a terminal)", () => {
    const s = findShortcut("commandPalette.open");
    expect(
      shouldDeferForTerminalFocus(s, event({}), {
        enabled: false,
        inTerminal: true,
      }),
    ).toBe(false);
  });

  it("never defers a terminalAlwaysOn shortcut (Find in files)", () => {
    const s = findShortcut("commandPalette.content");
    expect(
      shouldDeferForTerminalFocus(s, event({ shiftKey: true }), {
        enabled: true,
        inTerminal: true,
      }),
    ).toBe(false);
  });

  it("never defers the toggleTuiFocus shortcut itself", () => {
    const s = findShortcut("terminal.toggleTuiFocus");
    expect(
      shouldDeferForTerminalFocus(s, event({}), {
        enabled: true,
        inTerminal: true,
      }),
    ).toBe(false);
  });

  it("defers the plain sidebar.toggle binding when a terminal is focused", () => {
    const s = findShortcut("sidebar.toggle");
    expect(
      shouldDeferForTerminalFocus(s, event({}), {
        enabled: true,
        inTerminal: true,
      }),
    ).toBe(true);
  });

  it("does NOT defer the Shift sidebar.toggle binding when a terminal is focused", () => {
    const s = findShortcut("sidebar.toggle");
    expect(
      shouldDeferForTerminalFocus(s, event({ shiftKey: true }), {
        enabled: true,
        inTerminal: true,
      }),
    ).toBe(false);
  });

  it("does NOT defer the plain sidebar.toggle binding outside a terminal", () => {
    const s = findShortcut("sidebar.toggle");
    expect(
      shouldDeferForTerminalFocus(s, event({}), {
        enabled: true,
        inTerminal: false,
      }),
    ).toBe(false);
  });

  it("defers Mod+Shift+P (commandPalette.open) when a terminal is focused", () => {
    const s = findShortcut("commandPalette.open");
    expect(
      shouldDeferForTerminalFocus(s, event({}), {
        enabled: true,
        inTerminal: true,
      }),
    ).toBe(true);
  });

  it("does NOT defer a generic shortcut outside a terminal", () => {
    const s = findShortcut("commandPalette.open");
    expect(
      shouldDeferForTerminalFocus(s, event({}), {
        enabled: true,
        inTerminal: false,
      }),
    ).toBe(false);
  });
});

describe("TUI focus passthrough registry", () => {
  it.each([
    "commandPalette.content",
    "terminal.clear",
    "terminal.toggleInput",
    "terminal.toggleTuiFocus",
    "blocks.prev",
    "blocks.next",
    "tab.next",
    "tab.prev",
    "tab.selectByIndex",
  ] as const)("marks %s as terminalAlwaysOn", (id) => {
    expect(findShortcut(id).terminalAlwaysOn).toBe(true);
  });

  it("leaves Mod+Shift+P (commandPalette.open) deferred in a terminal", () => {
    expect(findShortcut("commandPalette.open").terminalAlwaysOn).toBeFalsy();
  });

  it("binds F6 to terminal.toggleTuiFocus", () => {
    const s = findShortcut("terminal.toggleTuiFocus");
    expect(
      s.defaultBindings.some((b) =>
        matchBinding(event({ key: "F6" }), b, s.id),
      ),
    ).toBe(true);
  });
});
