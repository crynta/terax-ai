import { Key, KeyAction, Mods } from "@terax/ghostty-core/protocol";
import { describe, expect, it } from "vitest";
import {
  buildKeyEvent,
  canonicalKittyPress,
  ignoredForIme,
  clipboardShortcut,
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
    optionIsMeta: () => false,
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
    [{ key: "Backspace", keyCode: 229 }, false, true],
    [{ key: "Backspace", keyCode: 229, altKey: true }, false, false],
    [{ key: "Backspace", keyCode: 229, metaKey: true }, false, false],
    [{ key: "Backspace", keyCode: 229, ctrlKey: true }, false, false],
    [{}, false, false],
  ])("%j (composing %s) -> ignored %s", (over, composing, ignored) => {
    expect(ignoredForIme(press(over), ctx(composing))).toBe(ignored);
  });

  it("lets Option act as Meta through the dead-key and 229 tagging of macOS", () => {
    const meta = { ...ctx(), optionIsMeta: () => true };
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
    key = code === "Insert" ? "Insert" : code.slice(3).toLowerCase(),
  ) => ({
    key,
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
    expect(clipboardShortcut(event(code, mods), platform)).toBe(
      expected ? "paste" : null,
    );
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
    expect(clipboardShortcut(event(code, mods), platform)).toBe(
      expected ? "copy" : null,
    );
  });
});

describe("clipboard shortcuts on other layouts", () => {
  const press = (key: string, code: string, mods: "C" | "CS" | "M") => ({
    key,
    code,
    ctrlKey: mods.includes("C"),
    shiftKey: mods.includes("S"),
    altKey: false,
    metaKey: mods === "M",
  });
  const windows = { isMac: false, isWindows: true };
  const linux = { isMac: false, isWindows: false };
  const mac = { isMac: true, isWindows: false };

  it("follows the letter the layout types, not the physical key (Dvorak, Workman)", () => {
    // Dvorak types V where QWERTY has Period, and "." where QWERTY has V.
    expect(clipboardShortcut(press("v", "Period", "C"), windows)).toBe("paste");
    expect(clipboardShortcut(press("V", "Period", "CS"), linux)).toBe("paste");
    expect(clipboardShortcut(press("v", "Period", "M"), mac)).toBe("paste");
    expect(clipboardShortcut(press("C", "KeyJ", "CS"), linux)).toBe("copy");
    expect(clipboardShortcut(press("c", "KeyJ", "M"), mac)).toBe("copy");
    expect(clipboardShortcut(press(".", "KeyV", "C"), windows)).toBeNull();
    expect(clipboardShortcut(press(".", "KeyV", "CS"), linux)).toBeNull();
    expect(clipboardShortcut(press("j", "KeyC", "CS"), linux)).toBeNull();
  });

  it("falls back to the physical key on layouts without Latin letters", () => {
    expect(clipboardShortcut(press("\u043c", "KeyV", "C"), windows)).toBe(
      "paste",
    );
    expect(clipboardShortcut(press("\u0441", "KeyC", "CS"), linux)).toBe(
      "copy",
    );
    expect(clipboardShortcut(press("\u043c", "KeyV", "M"), mac)).toBe("paste");
    expect(clipboardShortcut(press("\u043c", "KeyB", "C"), windows)).toBeNull();
  });
});

describe("routeKeyDown", () => {
  const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
    isMac: false,
    isWindows: false,
    optionIsMeta: () => false,
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

  it("sends nothing in legacy mode and the key in the protocol when copy has nothing to copy", () => {
    const event = press({
      key: "C",
      code: "KeyC",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(routeKeyDown(event, ctx())).toEqual({ kind: "copy" });
    expect(routeKeyDown(event, ctx(), true).kind).toBe("ignore");
    expect(routeKeyDown(event, ctx({ kittyFlags: () => 1 }), true)).toEqual({
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
        press({
          key: "@",
          code: "KeyQ",
          ctrlKey: true,
          altKey: true,
          getModifierState: (name: string) => name === "AltGraph",
        }),
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
        ctx({ isMac: true, optionIsMeta: () => true }),
      ),
    ).toEqual({ kind: "key", key: Key.B, utf8: "b" });
    expect(
      routeKeyDown(
        press({ key: "Ï", code: "KeyF", altKey: true, shiftKey: true }),
        ctx({ isMac: true, optionIsMeta: () => true }),
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

describe("routeKeyDown on a layout with AltGr", () => {
  const ctx: KeyContext = {
    isMac: false,
    isWindows: true,
    optionIsMeta: () => false,
    composing: () => false,
    alternateScreen: () => false,
    kittyFlags: () => 0,
  };
  const press = (altGraph: boolean) =>
    ({
      key: "a",
      code: "KeyA",
      keyCode: 65,
      shiftKey: false,
      ctrlKey: true,
      altKey: true,
      metaKey: false,
      repeat: false,
      isComposing: false,
      defaultPrevented: false,
      getModifierState: (name: string) => altGraph && name === "AltGraph",
    }) as KeyboardLike;

  it("encodes a real Ctrl+Alt+letter on a layout without AltGr as Ctrl+Alt", () => {
    expect(routeKeyDown(press(false), ctx)).toEqual({
      kind: "key",
      key: Key.A,
    });
  });

  it.each([
    ["@", "KeyQ"],
    ["\u20ac", "KeyE"],
    ["\u0105", "KeyA"],
    ["{", "Digit7"],
    ["[", "Digit8"],
    ["~", "Digit2"],
    ["\\", "Minus"],
    ["|", "IntlBackslash"],
  ])(
    "types %s when AltGr is not reported but the character is not the US key",
    (key, code) => {
      const event = { ...press(false), key, code };
      expect(routeKeyDown(event, ctx)).toEqual({
        kind: "text",
        text: key,
        key: null,
      });
    },
  );

  it.each([
    ["a", "KeyA", false],
    ["A", "KeyA", true],
    ["Q", "KeyQ", false],
    ["@", "Digit2", true],
  ])(
    "keeps real Ctrl+Alt+%s on a US layout a chord (shift %s)",
    (key, code, shiftKey) => {
      const event = { ...press(false), key, code, shiftKey };
      expect(routeKeyDown(event, ctx).kind).toBe("key");
    },
  );

  it.each([
    ["a", "KeyQ"],
    ["z", "KeyW"],
    ["x", "KeyB"],
    ["Z", "KeyY"],
  ])(
    "keeps Ctrl+Alt+%s on the %s key of AZERTY, QWERTZ and Dvorak a chord",
    (key, code) => {
      const event = { ...press(false), key, code, shiftKey: key === "Z" };
      expect(routeKeyDown(event, ctx)).toMatchObject({ kind: "key" });
    },
  );

  it("types an ASCII character when the browser reports AltGraph", () => {
    expect(
      routeKeyDown({ ...press(true), key: "q", code: "KeyW" }, ctx),
    ).toEqual({ kind: "text", text: "q", key: null });
  });

  it("does not guess AltGr away from Windows", () => {
    expect(
      routeKeyDown(
        { ...press(false), key: "@", code: "KeyQ" },
        {
          ...ctx,
          isWindows: false,
        },
      ).kind,
    ).toBe("key");
  });

  it("types the character AltGr produces", () => {
    expect(routeKeyDown({ ...press(true), key: "\u00e6" }, ctx)).toEqual({
      kind: "text",
      text: "\u00e6",
      key: null,
    });
  });
});

describe("Ctrl+Shift+letter without the Kitty protocol", () => {
  const ctx = (flags: number): KeyContext => ({
    isMac: false,
    isWindows: false,
    optionIsMeta: () => false,
    composing: () => false,
    alternateScreen: () => false,
    kittyFlags: () => flags,
  });
  const press = (key: string, code: string) =>
    ({
      key,
      code,
      keyCode: 0,
      shiftKey: true,
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      repeat: false,
      isComposing: false,
      defaultPrevented: false,
      getModifierState: () => false,
    }) as KeyboardLike;

  it.each([
    ["A", "KeyA", "\x01"],
    ["P", "KeyP", "\x10"],
    ["Z", "KeyZ", "\x1a"],
    ["J", "KeyJ", "\n"],
  ])("Ctrl+Shift+%s is the control byte, as in xterm", (key, code, byte) => {
    expect(routeKeyDown(press(key, code), ctx(0))).toEqual({
      kind: "bytes",
      text: byte,
    });
  });

  it("keeps the escape code under the Kitty protocol", () => {
    expect(routeKeyDown(press("A", "KeyA"), ctx(1)).kind).toBe("key");
    expect(routeKeyDown(press("P", "KeyP"), ctx(31)).kind).toBe("key");
  });

  it("never turns the copy shortcut into an interrupt", () => {
    const copy = press("C", "KeyC");
    expect(routeKeyDown(copy, ctx(0), true).kind).toBe("ignore");
    expect(routeKeyDown(copy, ctx(1), true).kind).toBe("key");
  });
});
