import { describe, expect, it } from "vitest";
import {
  type KeyBinding,
  matchBinding,
  SHORTCUTS,
  type ShortcutId,
} from "../shortcuts";
import {
  buildTerminalFocusBindings,
  effectiveBindings,
} from "./terminalFocusPolicy";

// The vitest environment has no Tauri OS plugin, so the registry holds the
// Windows/Linux defaults (Ctrl as the primary modifier).

const table = buildTerminalFocusBindings(SHORTCUTS, false);

function key(
  keyName: string,
  mods: "" | "C" | "CS" | "AS" | "CA" = "C",
  code = `Key${keyName.toUpperCase()}`,
): KeyboardEvent {
  return {
    key: keyName,
    code,
    ctrlKey: mods.includes("C"),
    shiftKey: mods.includes("S"),
    altKey: mods.includes("A"),
    metaKey: false,
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

describe("terminal focus policy", () => {
  it("keeps every plain Ctrl+letter chord for the terminal", () => {
    for (const letter of "abcdefghijklmnopqrstuvwxyz") {
      const owner = resolve(key(letter), true);
      // Ctrl+B has always yielded to the shell via the host's own check; the
      // chords below are the editor-only ones the host disables by tab kind.
      expect(owner, `Ctrl+${letter}`).toBeNull();
    }
  });

  it("leaves those chords to the application everywhere else", () => {
    expect(resolve(key("t"), false)).toBe("tab.new");
    expect(resolve(key("w"), false)).toBe("tab.close");
    expect(resolve(key("d"), false)).toBe("pane.splitRight");
    expect(resolve(key("r"), false)).toBe("tab.newPrivate");
  });

  it("reaches the displaced commands through Ctrl+Shift", () => {
    expect(resolve(key("T", "CS"), true)).toBe("tab.new");
    expect(resolve(key("W", "CS"), true)).toBe("tab.close");
    expect(resolve(key("R", "CS"), true)).toBe("tab.newPrivate");
    expect(resolve(key("G", "CS"), true)).toBe("pane.source");
    expect(resolve(key("F", "CS"), true)).toBe("search.focus");
    expect(resolve(key("D", "AS", "KeyD"), true)).toBe("pane.splitRight");
  });

  it("swaps the two AI toggles so neither is lost", () => {
    expect(resolve(key("I", "CS"), true)).toBe("ai.toggle");
    expect(resolve(key("I", "AS", "KeyI"), true)).toBe("ai.toggleMini");
    expect(resolve(key("I", "CS"), false)).toBe("ai.toggleMini");
  });

  it("gives the palette Ctrl+Shift+P in a terminal", () => {
    expect(resolve(key("P", "CS"), true)).toBe("commandPalette.open");
  });

  it("only shadows a Ctrl+Shift chord while a terminal has focus", () => {
    expect(resolve(key("T", "CS"), false)).toBe("tab.newBlock");
    expect(resolve(key("F", "CS"), false)).toBe("explorer.search");
  });

  it("does not touch chords without a control byte", () => {
    expect(resolve(key(",", "C", "Comma"), true)).toBe("settings.open");
    expect(resolve(key("1", "C", "Digit1"), true)).toBe("tab.selectByIndex");
    expect(resolve(key("=", "C", "Equal"), true)).toBe("view.zoomIn");
    expect(resolve(key("Tab", "C", "Tab"), true)).toBe("tab.next");
    expect(resolve(key("B", "CS"), true)).toBe("sidebar.toggle");
  });

  it("never overrides a binding the user chose", () => {
    const user = { "tab.newEditor": [{ ctrl: true, key: "e" }] };
    expect(resolve(key("e"), true, user)).toBe("tab.newEditor");
    expect(resolve(key("e"), false, user)).toBe("tab.newEditor");
    expect(
      resolve(key("t"), true, { "tab.new": [{ ctrl: true, key: "t" }] }),
    ).toBe("tab.new");
  });

  it("is the identity on macOS, where the terminal never uses Command", () => {
    const mac = buildTerminalFocusBindings(SHORTCUTS, true);
    for (const shortcut of SHORTCUTS)
      expect(mac.get(shortcut.id)).toBe(shortcut.defaultBindings);
  });

  it("gives each Ctrl+Shift alias to exactly one shortcut", () => {
    const owners = new Map<string, string>();
    for (const [id, bindings] of table)
      for (const b of bindings) {
        if (!b.shift) continue;
        const sig = `${!!b.ctrl}|${!!b.alt}|${b.key.toLowerCase()}`;
        const other = owners.get(sig);
        expect(
          other === undefined || other === id,
          `${sig}: ${other} / ${id}`,
        ).toBe(true);
        owners.set(sig, id);
      }
  });

  it("makes every displaced default a deliberate decision", () => {
    const displacedWithoutAlias = SHORTCUTS.filter((shortcut) => {
      const lost = shortcut.defaultBindings.some(
        (b) =>
          b.ctrl && !b.shift && !b.alt && !b.meta && /^[a-z]$/i.test(b.key),
      );
      return lost && !(table.get(shortcut.id) ?? []).some((b) => b.shift);
    })
      .map((shortcut) => shortcut.id)
      .sort();
    // Reachable from every other focus and from the command palette (Go to
    // file is Ctrl+P once it exists); the two editor shortcuts only act in
    // editor tabs, which never hold a terminal.
    const reviewed = [
      "ai.askSelection",
      "commandPalette.files",
      "editor.save",
      "editor.undo",
      "tab.newEditor",
      "terminal.toggleInput",
    ];
    expect(
      displacedWithoutAlias.filter((id) => !reviewed.includes(id)),
    ).toEqual([]);
  });
});
