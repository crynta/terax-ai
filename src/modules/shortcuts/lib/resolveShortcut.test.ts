import { describe, expect, it } from "vitest";
import { buildShortcuts, type KeyBinding, type ShortcutId } from "../shortcuts";
import { resolveShortcut } from "./resolveShortcut";

const mac = buildShortcuts(true);
const other = buildShortcuts(false);

function press(
  key: string,
  mods: string,
  over: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key,
    code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
    ctrlKey: mods.includes("C"),
    shiftKey: mods.includes("S"),
    altKey: mods.includes("A"),
    metaKey: mods.includes("M"),
    repeat: false,
    ...over,
  } as KeyboardEvent;
}

const run = (
  shortcuts: typeof mac,
  event: KeyboardEvent,
  opts: {
    disabled?: ShortcutId[];
    handlers?: ShortcutId[] | "all";
    user?: Partial<Record<ShortcutId, KeyBinding[]>>;
  } = {},
) =>
  resolveShortcut(event, {
    shortcuts,
    user: opts.user ?? {},
    isDisabled: (id) => opts.disabled?.includes(id) ?? false,
    hasHandler: (id) =>
      opts.handlers === undefined ||
      opts.handlers === "all" ||
      opts.handlers.includes(id),
  });

describe("resolveShortcut on macOS", () => {
  it("clears a focused terminal with Command+K and opens the palette elsewhere", () => {
    const event = press("k", "M");
    // In a terminal terminal.clear is enabled.
    expect(run(mac, event)).toBe("terminal.clear");
    // Elsewhere the host disables it and the match continues to the palette.
    expect(run(mac, event, { disabled: ["terminal.clear"] })).toBe(
      "commandPalette.open",
    );
  });

  it("keeps Command+P for files and Command+Shift+P for the palette", () => {
    expect(run(mac, press("p", "M"))).toBe("commandPalette.files");
    expect(run(mac, press("P", "MS"))).toBe("commandPalette.open");
    expect(run(mac, press("H", "MS"))).toBe("commandPalette.content");
  });

  it("never lets a disabled match stop a later one", () => {
    expect(
      run(mac, press("k", "M"), {
        disabled: ["terminal.clear", "commandPalette.open"],
      }),
    ).toBeNull();
  });
});

describe("resolveShortcut on Windows and Linux", () => {
  it("gives Go to file and the palette chords no terminal program reads", () => {
    expect(run(other, press("O", "CS"))).toBe("commandPalette.files");
    expect(run(other, press("P", "CS"))).toBe("commandPalette.open");
    expect(run(other, press("H", "CS"))).toBe("commandPalette.content");
  });

  it("leaves Ctrl+P, Ctrl+K and Ctrl+O to the shell", () => {
    for (const key of ["p", "k", "o"])
      expect(run(other, press(key, "C"))).toBeNull();
  });

  it("keeps the chords the editor binds (Ctrl+Shift+L, G, \\, [ and ]) off the app", () => {
    for (const key of ["L", "G"])
      expect(run(other, press(key, "CS"))).toBeNull();
    expect(run(other, press("|", "CS", { code: "Backslash" }))).toBeNull();
    expect(run(other, press("{", "CS", { code: "BracketLeft" }))).toBeNull();
    expect(run(other, press("}", "CS", { code: "BracketRight" }))).toBeNull();
  });

  it("opens a preview, splits down and shows source on chords nothing else reads", () => {
    expect(run(other, press("~", "CS", { code: "Backquote" }))).toBe(
      "tab.newPreview",
    );
    expect(run(other, press("Enter", "CS"))).toBe("pane.splitDown");
    expect(run(other, press(":", "CS", { code: "Semicolon" }))).toBe(
      "pane.source",
    );
  });

  it("switches space on Ctrl+Alt+PageDown and PageUp", () => {
    expect(run(other, press("PageDown", "CA"))).toBe("space.next");
    expect(run(other, press("PageUp", "CA"))).toBe("space.prev");
  });

  it("jumps to a tab on Ctrl+Shift+digit and leaves Ctrl+digit to the terminal", () => {
    expect(run(other, press("#", "CS", { code: "Digit3" }))).toBe(
      "tab.selectByIndex",
    );
    for (const digit of ["1", "2", "3", "8"])
      expect(
        run(other, press(digit, "C", { code: `Digit${digit}` })),
      ).toBeNull();
  });
});

describe("resolveShortcut", () => {
  it.each([
    ["AZERTY slash", "/", "Period"],
    ["AZERTY period", ".", "Semicolon"],
    ["German semicolon", ";", "Comma"],
    ["German slash", "/", "Digit7"],
    ["Dvorak comma", "<", "KeyW"],
  ])("replays a recorded %s before any default fallback", (_, key, code) => {
    const event = press(key, "CS", { code });
    const user = {
      "view.zenMode": [
        {
          key: event.key,
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          meta: event.metaKey,
        },
      ],
    };
    expect(run(other, event, { user })).toBe("view.zenMode");
    expect(run(other, { ...event, shiftKey: false }, { user })).not.toBe(
      "view.zenMode",
    );
  });

  it("does not reinterpret a recorded symbol as a default base key", () => {
    const user = { "view.zenMode": [{ key: "/", ctrl: true, shift: true }] };
    expect(run(other, press("?", "CS", { code: "Slash" }), { user })).toBe(
      "explorer.search",
    );
  });

  it("continues to defaults when a recorded match is disabled", () => {
    const user = { "view.zenMode": [{ key: "/", ctrl: true, shift: true }] };
    expect(
      run(other, press("/", "CS", { code: "Period" }), {
        user,
        disabled: ["view.zenMode"],
      }),
    ).toBe("explorer.toggleHidden");
  });

  it("honours a user binding over the default", () => {
    const user = { "commandPalette.open": [{ ctrl: true, key: "k" }] };
    expect(run(other, press("k", "C"), { user })).toBe("commandPalette.open");
    expect(run(other, press("P", "CS"), { user })).toBeNull();
  });

  it("ends the search at an enabled shortcut without a handler", () => {
    expect(run(other, press("O", "CS"), { handlers: [] })).toBeNull();
  });

  it("skips repeats of shortcuts that do not allow them", () => {
    expect(run(other, press("T", "CS", { repeat: true }))).toBeNull();
    expect(run(other, press("ArrowDown", "CS", { repeat: true }))).toBe(
      "blocks.next",
    );
  });
});
