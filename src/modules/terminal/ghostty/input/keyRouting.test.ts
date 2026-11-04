import { Key, KeyAction, Mods } from "@terax/ghostty-core/protocol";
import { describe, expect, it } from "vitest";
import {
  buildKeyEvent,
  canonicalKittyPress,
  ignoredForIme,
  isCopyShortcut,
  isPasteShortcut,
  type KeyboardLike,
  type KeyContext,
  keyModifiers,
  routeKeyDown,
} from "./keyRouting";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (value: Uint8Array) => new TextDecoder().decode(value);

describe("canonicalKittyPress", () => {
  it.each([
    ["\x1b[1;1:1A", "\x1b[A"],
    ["\x1b[1;1:1H", "\x1b[H"],
    ["\x1b[1;1:1P", "\x1b[P"],
    ["\x1b[1;2:1A", "\x1b[1;2A"],
    ["\x1b[1;5:1D", "\x1b[1;5D"],
    ["\x1b[1;129:1A", "\x1b[1;129A"],
    ["\x1b[5;1:1~", "\x1b[5~"],
    ["\x1b[15;2:1~", "\x1b[15;2~"],
  ])("spells the press %j without the default event type", (input, output) => {
    expect(text(canonicalKittyPress(bytes(input)))).toBe(output);
  });

  it.each([
    "\x1b[1;1:2A",
    "\x1b[1;1:3A",
    "\x1b[97;1:3u",
    "\x1b[97;2:1u",
    "\x1b[97u",
    "\x1b[A",
    "\x1b[1;2A",
    "\x1b[5~",
    "\x1b[200~",
    "\x1b[1;1:1;65A",
    "\x1b[;:1A",
    "\x1b[1;:1A",
    "\x1bOA",
    "a",
    "",
    "\x1b[1;1:1;1;1:1A",
  ])("leaves %j alone", (input) => {
    const original = bytes(input);
    expect(canonicalKittyPress(original)).toBe(original);
  });
});

describe("keyModifiers", () => {
  const locks = { CapsLock: true, NumLock: true } as Record<string, boolean>;
  const event = {
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
    metaKey: true,
    getModifierState: (name: string) => locks[name] === true,
  } as unknown as KeyboardLike;

  it.each([
    [0, Mods.SHIFT | Mods.SUPER | Mods.CAPSLOCK | Mods.NUMLOCK],
    [1, Mods.SHIFT | Mods.SUPER],
    [3, Mods.SHIFT | Mods.SUPER],
    [2, Mods.SHIFT | Mods.SUPER],
    [4, Mods.SHIFT | Mods.SUPER],
    [8, Mods.SHIFT | Mods.SUPER | Mods.CAPSLOCK | Mods.NUMLOCK],
    [11, Mods.SHIFT | Mods.SUPER | Mods.CAPSLOCK | Mods.NUMLOCK],
    [31, Mods.SHIFT | Mods.SUPER | Mods.CAPSLOCK | Mods.NUMLOCK],
  ])(
    "reports lock state only to legacy mode and report-all (flags %s)",
    (flags, mods) => {
      expect(keyModifiers(event, flags)).toBe(mods);
    },
  );
});

describe("buildKeyEvent", () => {
  const base = {
    key: ";",
    code: "Semicolon",
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    getModifierState: () => false,
  } as unknown as KeyboardLike;
  const build = (over: Partial<KeyboardLike>, flags: number, utf8?: string) =>
    buildKeyEvent(
      { ...base, ...over } as KeyboardLike,
      Key.SEMICOLON,
      KeyAction.PRESS,
      flags,
      utf8,
    );

  it("supplies the base key only where the protocol escape-codes text", () => {
    expect(build({}, 1).unshiftedCodepoint).toBe(0);
    expect(build({ key: ":", shiftKey: true }, 3).unshiftedCodepoint).toBe(0);
    expect(build({ key: ":", shiftKey: true }, 8).unshiftedCodepoint).toBe(59);
    expect(build({ ctrlKey: true }, 1).unshiftedCodepoint).toBe(59);
    expect(build({ altKey: true }, 1).unshiftedCodepoint).toBe(59);
    expect(build({ metaKey: true }, 1).unshiftedCodepoint).toBe(59);
  });

  it("derives the base key from the text an Option-as-Meta press stands for", () => {
    const event = build({ key: "∫", code: "KeyB", altKey: true }, 1, "b");
    expect(event.utf8).toBe("b");
    expect(event.unshiftedCodepoint).toBe(98);
  });
});

describe("ignoredForIme", () => {
  const ctx = (composing = false): KeyContext => ({
    isMac: true,
    isWindows: false,
    macOptionIsMeta: false,
    composing: () => composing,
    alternateScreen: () => false,
    kittyFlags: () => 0,
  });
  const press = (over: Partial<KeyboardLike>) =>
    ({
      key: "a",
      code: "KeyA",
      keyCode: 65,
      isComposing: false,
      defaultPrevented: false,
      ...over,
    }) as KeyboardLike;

  it.each([
    [{ defaultPrevented: true }, false, true],
    [{ isComposing: true }, false, true],
    [{}, true, true],
    [{ key: "Process", keyCode: 229 }, false, true],
    [{ key: "Unidentified" }, false, true],
    [{ key: "Dead" }, false, true],
    [{ keyCode: 229 }, false, true],
    [{ key: "Enter", keyCode: 229 }, false, true],
    [{ key: "Escape", keyCode: 229 }, false, true],
    [{ key: "ArrowLeft", keyCode: 229 }, false, false],
    [{ key: "F7", keyCode: 229 }, false, false],
    [{ key: "PageUp", keyCode: 229 }, false, false],
    [{}, false, false],
  ])("%j (composing %s) -> ignored %s", (over, composing, ignored) => {
    expect(ignoredForIme(press(over), ctx(composing))).toBe(ignored);
  });

  it("lets Option act as Meta through the dead-key and 229 tagging of macOS", () => {
    const meta = { ...ctx(), macOptionIsMeta: true };
    const option = press({ key: "Dead", keyCode: 229, altKey: true });
    expect(ignoredForIme(option, meta)).toBe(false);
    expect(ignoredForIme(option, ctx())).toBe(true);
    expect(ignoredForIme({ ...option, ctrlKey: true }, meta)).toBe(true);
  });
});

describe("clipboard shortcuts", () => {
  const event = (
    code: string,
    mods: "" | "C" | "S" | "CS" | "M" | "CA" = "",
  ) => ({
    code,
    ctrlKey: mods.includes("C"),
    shiftKey: mods.includes("S"),
    altKey: mods.includes("A"),
    metaKey: mods.includes("M"),
  });
  const mac = { isMac: true, isWindows: false };
  const windows = { isMac: false, isWindows: true };
  const linux = { isMac: false, isWindows: false };

  it.each([
    ["Cmd+V", mac, "KeyV", "M", true],
    ["Ctrl+V on macOS reaches the application", mac, "KeyV", "C", false],
    ["Ctrl+V on Windows", windows, "KeyV", "C", true],
    ["Ctrl+Shift+V on Windows", windows, "KeyV", "CS", true],
    ["Shift+Insert on Windows", windows, "Insert", "S", true],
    ["Ctrl+V on Linux reaches the application", linux, "KeyV", "C", false],
    ["Ctrl+Shift+V on Linux", linux, "KeyV", "CS", true],
    ["Shift+Insert on Linux", linux, "Insert", "S", true],
    ["Ctrl+Shift+Insert is not a paste", linux, "Insert", "CS", false],
    ["Ctrl+Alt+V (AltGr) is not a paste", windows, "KeyV", "CA", false],
    ["Insert alone", windows, "Insert", "", false],
  ] as const)("paste: %s", (_name, platform, code, mods, expected) => {
    expect(isPasteShortcut(event(code, mods), platform)).toBe(expected);
  });

  it.each([
    ["Cmd+C", mac, "KeyC", "M", true],
    ["Ctrl+C is an interrupt on macOS", mac, "KeyC", "C", false],
    ["Ctrl+C is an interrupt on Windows", windows, "KeyC", "C", false],
    ["Ctrl+Shift+C on Windows", windows, "KeyC", "CS", true],
    ["Ctrl+Shift+C on Linux", linux, "KeyC", "CS", true],
    ["Ctrl+Insert", windows, "Insert", "C", true],
    ["Ctrl+Insert on Linux", linux, "Insert", "C", true],
    ["Ctrl+Shift+Insert", linux, "Insert", "CS", false],
  ] as const)("copy: %s", (_name, platform, code, mods, expected) => {
    expect(isCopyShortcut(event(code, mods), platform)).toBe(expected);
  });
});

describe("routeKeyDown", () => {
  const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
    isMac: false,
    isWindows: false,
    macOptionIsMeta: false,
    composing: () => false,
    alternateScreen: () => false,
    kittyFlags: () => 0,
    ...over,
  });
  const press = (over: Partial<KeyboardLike>) =>
    ({
      key: "",
      code: "",
      keyCode: 0,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      isComposing: false,
      defaultPrevented: false,
      getModifierState: () => false,
      ...over,
    }) as KeyboardLike;

  it("forwards Windows Ctrl+V as a key when there is no text to paste", () => {
    const route = routeKeyDown(
      press({ key: "v", code: "KeyV", ctrlKey: true }),
      ctx({ isWindows: true }),
    );
    expect(route).toEqual({ kind: "paste", forwardKeyWhenEmpty: true });
    expect(
      routeKeyDown(
        press({ key: "V", code: "KeyV", ctrlKey: true, shiftKey: true }),
        ctx({ isWindows: true }),
      ),
    ).toEqual({ kind: "paste", forwardKeyWhenEmpty: false });
  });

  it("falls back to the key when copy has nothing to copy", () => {
    const event = press({
      key: "C",
      code: "KeyC",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(routeKeyDown(event, ctx())).toEqual({ kind: "copy" });
    expect(routeKeyDown(event, ctx(), true)).toEqual({
      kind: "key",
      key: Key.C,
    });
  });

  it("sends Shift+Enter as a newline only outside the Kitty protocol", () => {
    const event = press({ key: "Enter", code: "Enter", shiftKey: true });
    expect(routeKeyDown(event, ctx())).toEqual({
      kind: "bytes",
      text: "\x1b\r",
    });
    expect(routeKeyDown(event, ctx({ kittyFlags: () => 1 }))).toEqual({
      kind: "key",
      key: Key.ENTER,
    });
  });

  it("maps Ctrl+I, Ctrl+M, Ctrl+[ and Ctrl+- to their C0 bytes in legacy mode only", () => {
    for (const [key, code, byte] of [
      ["i", "KeyI", "\t"],
      ["M", "KeyM", "\r"],
      ["[", "BracketLeft", "\x1b"],
      ["-", "Minus", "\x1f"],
    ]) {
      const event = press({ key, code, ctrlKey: true });
      expect(routeKeyDown(event, ctx())).toEqual({ kind: "bytes", text: byte });
      expect(routeKeyDown(event, ctx({ kittyFlags: () => 1 })).kind).toBe(
        "key",
      );
      expect(routeKeyDown({ ...event, shiftKey: true }, ctx()).kind).not.toBe(
        "bytes",
      );
    }
  });

  it("types shifted symbols as text and offers the key for Kitty reporting", () => {
    expect(
      routeKeyDown(
        press({ key: ":", code: "Semicolon", shiftKey: true }),
        ctx(),
      ),
    ).toEqual({ kind: "text", text: ":", key: Key.SEMICOLON });
  });

  it("types AltGr and macOS Option characters as plain text", () => {
    expect(
      routeKeyDown(
        press({ key: "@", code: "KeyQ", ctrlKey: true, altKey: true }),
        ctx({ isWindows: true }),
      ),
    ).toEqual({ kind: "text", text: "@", key: null });
    expect(
      routeKeyDown(
        press({ key: "å", code: "KeyA", altKey: true }),
        ctx({ isMac: true }),
      ),
    ).toEqual({ kind: "text", text: "å", key: null });
  });

  it("encodes the physical key for Option as Meta", () => {
    expect(
      routeKeyDown(
        press({ key: "∫", code: "KeyB", altKey: true }),
        ctx({ isMac: true, macOptionIsMeta: true }),
      ),
    ).toEqual({ kind: "key", key: Key.B, utf8: "b" });
    expect(
      routeKeyDown(
        press({ key: "Ï", code: "KeyF", altKey: true, shiftKey: true }),
        ctx({ isMac: true, macOptionIsMeta: true }),
      ),
    ).toEqual({ kind: "key", key: Key.F, utf8: "F" });
  });

  it("leaves unclaimed Command shortcuts and unmapped keys to the webview", () => {
    expect(
      routeKeyDown(
        press({ key: "q", code: "KeyQ", metaKey: true }),
        ctx({ isMac: true }),
      ).kind,
    ).toBe("ignore");
    expect(
      routeKeyDown(press({ key: "Unmapped", code: "Lang1" }), ctx()).kind,
    ).toBe("ignore");
  });
});
