import { readFile } from "node:fs/promises";
import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import type { KeyEvent } from "@terax/ghostty-core/protocol";
import { describe, expect, it } from "vitest";
import { FakeElement, FakeTextArea } from "./fakeTextArea";
import { GhosttyInputController } from "./GhosttyInputController";

/**
 * Table-driven conformance of the whole key path (event routing, modifier and
 * base-key policy, the real Ghostty encoder in both shipped WASM cores) against
 * the byte sequences the references prescribe:
 *
 * - legacy and DECCKM: xterm's ctlseqs ("PC-Style Function Keys", "Normal and
 *   Application cursor keys", Ctrl+letter as C0 controls);
 * - Kitty flags 1, 3, 8 and 31: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 *   (disambiguate; plus event types; report all keys; plus alternates and text).
 *
 * Expected strings are written out from those documents. Where the encoder
 * deliberately differs from xterm in legacy mode the row says so.
 */

const E = "\x1b";

type ModeName = "legacy" | "decckm" | "k1" | "k3" | "k8" | "k31";
const MODES: readonly { name: ModeName; setup: string }[] = [
  { name: "legacy", setup: "" },
  { name: "decckm", setup: `${E}[?1h` },
  { name: "k1", setup: `${E}[=1u` },
  { name: "k3", setup: `${E}[=3u` },
  { name: "k8", setup: `${E}[=8u` },
  { name: "k31", setup: `${E}[=31u` },
];
const RESET = `${E}[?1l${E}[=0u${E}[?1049l`;

type Expected = Partial<Record<ModeName, string>>;

type Platform = "linux" | "mac" | "macMeta" | "windows";

type Row = {
  name: string;
  key: string;
  code: string;
  /** S shift, C ctrl, A alt, M meta/super. */
  mods?: string;
  platform?: Platform;
  /** Run on the alternate screen. */
  alt?: true;
  /** Bytes for the press, per mode; "" when nothing is sent. */
  press: Expected;
  /** Bytes for the release that follows, per mode; omitted modes send nothing. */
  release?: Expected;
};

const all = (value: string): Expected => ({
  legacy: value,
  decckm: value,
  k1: value,
  k3: value,
  k8: value,
  k31: value,
});

/** Named keys whose press has the same bytes in every mode, release `:3`. */
const tilde = (code: number): { press: Expected; release: Expected } => ({
  press: all(`${E}[${code}~`),
  release: { k3: `${E}[${code};1:3~`, k31: `${E}[${code};1:3~` },
});

const ROWS: Row[] = [
  // Letters, digits and shifted symbols. Text is text until the application
  // asks for every key as an escape code (flag 8). Release events of text keys
  // only exist at that level (flags 8 and 2 together).
  {
    name: "a",
    key: "a",
    code: "KeyA",
    press: { ...all("a"), k8: `${E}[97u`, k31: `${E}[97;;97u` },
    release: { k31: `${E}[97;1:3u` },
  },
  {
    name: "Shift+a",
    key: "A",
    code: "KeyA",
    mods: "S",
    press: { ...all("A"), k8: `${E}[97;2u`, k31: `${E}[97:65;2;65u` },
    release: { k31: `${E}[97:65;2:3u` },
  },
  {
    name: "Shift+; types :",
    key: ":",
    code: "Semicolon",
    mods: "S",
    press: { ...all(":"), k8: `${E}[59;2u`, k31: `${E}[59:58;2;58u` },
    release: { k31: `${E}[59:58;2:3u` },
  },
  {
    name: "Shift+1 types !",
    key: "!",
    code: "Digit1",
    mods: "S",
    press: { ...all("!"), k8: `${E}[49;2u`, k31: `${E}[49:33;2;33u` },
  },
  {
    name: "Shift+- types _",
    key: "_",
    code: "Minus",
    mods: "S",
    press: { ...all("_"), k8: `${E}[45;2u`, k31: `${E}[45:95;2;95u` },
  },
  {
    name: "1",
    key: "1",
    code: "Digit1",
    press: { ...all("1"), k8: `${E}[49u`, k31: `${E}[49;;49u` },
  },
  {
    name: "Space",
    key: " ",
    code: "Space",
    press: { ...all(" "), k8: `${E}[32u`, k31: `${E}[32;;32u` },
  },
  {
    name: "Shift+Space is still a space",
    key: " ",
    code: "Space",
    mods: "S",
    press: { ...all(" "), k8: `${E}[32;2u`, k31: `${E}[32;2;32u` },
  },

  // Cursor keys: SS3 under DECCKM, plain CSI otherwise, and CSI in every Kitty
  // level (the protocol's own spelling omits the default event type).
  ...(
    [
      ["Up", "A"],
      ["Down", "B"],
      ["Right", "C"],
      ["Left", "D"],
    ] as const
  ).map(
    ([name, final]): Row => ({
      name: `Arrow${name}`,
      key: `Arrow${name}`,
      code: `Arrow${name}`,
      press: {
        legacy: `${E}[${final}`,
        decckm: `${E}O${final}`,
        k1: `${E}[${final}`,
        k3: `${E}[${final}`,
        k8: `${E}[${final}`,
        k31: `${E}[${final}`,
      },
      release: { k3: `${E}[1;1:3${final}`, k31: `${E}[1;1:3${final}` },
    }),
  ),
  {
    name: "Home",
    key: "Home",
    code: "Home",
    press: {
      legacy: `${E}[H`,
      decckm: `${E}OH`,
      k1: `${E}[H`,
      k3: `${E}[H`,
      k8: `${E}[H`,
      k31: `${E}[H`,
    },
    release: { k3: `${E}[1;1:3H`, k31: `${E}[1;1:3H` },
  },
  {
    name: "End",
    key: "End",
    code: "End",
    press: {
      legacy: `${E}[F`,
      decckm: `${E}OF`,
      k1: `${E}[F`,
      k3: `${E}[F`,
      k8: `${E}[F`,
      k31: `${E}[F`,
    },
    release: { k3: `${E}[1;1:3F`, k31: `${E}[1;1:3F` },
  },
  { name: "Insert", key: "Insert", code: "Insert", ...tilde(2) },
  { name: "Delete", key: "Delete", code: "Delete", ...tilde(3) },
  { name: "PageUp", key: "PageUp", code: "PageUp", ...tilde(5) },
  { name: "PageDown", key: "PageDown", code: "PageDown", ...tilde(6) },
  {
    name: "Ctrl+ArrowUp",
    key: "ArrowUp",
    code: "ArrowUp",
    mods: "C",
    press: all(`${E}[1;5A`),
    release: { k3: `${E}[1;5:3A`, k31: `${E}[1;5:3A` },
  },
  {
    name: "Shift+ArrowLeft",
    key: "ArrowLeft",
    code: "ArrowLeft",
    mods: "S",
    press: all(`${E}[1;2D`),
  },
  {
    name: "Alt+ArrowRight on Linux",
    key: "ArrowRight",
    code: "ArrowRight",
    mods: "A",
    alt: true,
    press: all(`${E}[1;3C`),
  },
  {
    name: "Shift+Home",
    key: "Home",
    code: "Home",
    mods: "S",
    press: all(`${E}[1;2H`),
  },

  // Function keys: F1-F4 are SS3 in legacy and CSI P/Q/13~/S in Kitty (CSI R
  // would collide with the cursor position report); F5-F12 are tilde codes.
  ...(
    [
      ["F1", `${E}OP`, `${E}[P`, `${E}[1;1:3P`],
      ["F2", `${E}OQ`, `${E}[Q`, `${E}[1;1:3Q`],
      ["F3", `${E}OR`, `${E}[13~`, `${E}[13;1:3~`],
      ["F4", `${E}OS`, `${E}[S`, `${E}[1;1:3S`],
    ] as const
  ).map(
    ([name, legacy, kitty, release]): Row => ({
      name,
      key: name,
      code: name,
      press: {
        legacy,
        decckm: legacy,
        k1: kitty,
        k3: kitty,
        k8: kitty,
        k31: kitty,
      },
      release: { k3: release, k31: release },
    }),
  ),
  ...(
    [
      ["F5", 15],
      ["F6", 17],
      ["F7", 18],
      ["F8", 19],
      ["F9", 20],
      ["F10", 21],
      ["F11", 23],
      ["F12", 24],
    ] as const
  ).map(
    ([name, code]): Row => ({ name, key: name, code: name, ...tilde(code) }),
  ),
  {
    name: "Shift+F5",
    key: "F5",
    code: "F5",
    mods: "S",
    press: all(`${E}[15;2~`),
  },

  // Enter, Tab, Backspace, Escape. Enter/Tab/Backspace stay C0 bytes until all
  // keys are escape-coded, and never report a release before that.
  {
    name: "Enter",
    key: "Enter",
    code: "Enter",
    press: { ...all("\r"), k8: `${E}[13u`, k31: `${E}[13u` },
    release: { k31: `${E}[13;1:3u` },
  },
  {
    name: "Tab",
    key: "Tab",
    code: "Tab",
    press: { ...all("\t"), k8: `${E}[9u`, k31: `${E}[9u` },
    release: { k31: `${E}[9;1:3u` },
  },
  {
    name: "Shift+Tab",
    key: "Tab",
    code: "Tab",
    mods: "S",
    press: { ...all(`${E}[9;2u`), legacy: `${E}[Z`, decckm: `${E}[Z` },
  },
  {
    name: "Backspace",
    key: "Backspace",
    code: "Backspace",
    press: { ...all("\x7f"), k8: `${E}[127u`, k31: `${E}[127u` },
    release: { k31: `${E}[127;1:3u` },
  },
  {
    name: "Escape",
    key: "Escape",
    code: "Escape",
    press: { ...all(`${E}[27u`), legacy: E, decckm: E },
    release: { k3: `${E}[27;1:3u`, k31: `${E}[27;1:3u` },
  },
  {
    name: "Shift+Enter inserts a newline (ESC CR) outside the protocol",
    key: "Enter",
    code: "Enter",
    mods: "S",
    press: {
      ...all(`${E}[13;2u`),
      legacy: `${E}\r`,
      decckm: `${E}\r`,
    },
  },

  // Ctrl+letter: a C0 control in legacy; an escape code from flag 1 up. Ctrl+I,
  // Ctrl+M and Ctrl+[ are Tab, Enter and Escape to a legacy application (xterm).
  ...(
    [
      ["a", "KeyA", "\x01", 97],
      ["c", "KeyC", "\x03", 99],
      ["d", "KeyD", "\x04", 100],
      ["j", "KeyJ", "\n", 106],
      ["k", "KeyK", "\x0b", 107],
      ["p", "KeyP", "\x10", 112],
      ["y", "KeyY", "\x19", 121],
      ["z", "KeyZ", "\x1a", 122],
    ] as const
  ).map(
    ([key, code, control, base]): Row => ({
      name: `Ctrl+${key}`,
      key,
      code,
      mods: "C",
      press: {
        legacy: control,
        decckm: control,
        k1: `${E}[${base};5u`,
        k3: `${E}[${base};5u`,
        k8: `${E}[${base};5u`,
        k31: `${E}[${base};5u`,
      },
      release: { k3: `${E}[${base};5:3u`, k31: `${E}[${base};5:3u` },
    }),
  ),
  ...(
    [
      ["i", "KeyI", "\t", 105],
      ["m", "KeyM", "\r", 109],
      ["[", "BracketLeft", E, 91],
    ] as const
  ).map(
    ([key, code, control, base]): Row => ({
      name: `Ctrl+${key} is ${JSON.stringify(control)} in legacy`,
      key,
      code,
      mods: "C",
      press: {
        legacy: control,
        decckm: control,
        k1: `${E}[${base};5u`,
        k3: `${E}[${base};5u`,
        k8: `${E}[${base};5u`,
        k31: `${E}[${base};5u`,
      },
    }),
  ),
  {
    name: "Ctrl+\\",
    key: "\\",
    code: "Backslash",
    mods: "C",
    press: { ...all(`${E}[92;5u`), legacy: "\x1c", decckm: "\x1c" },
  },
  {
    name: "Ctrl+]",
    key: "]",
    code: "BracketRight",
    mods: "C",
    press: { ...all(`${E}[93;5u`), legacy: "\x1d", decckm: "\x1d" },
  },
  {
    name: "Ctrl+/",
    key: "/",
    code: "Slash",
    mods: "C",
    press: { ...all(`${E}[47;5u`), legacy: "\x1f", decckm: "\x1f" },
  },
  {
    name: "Ctrl+- (undo) is US in legacy",
    key: "-",
    code: "Minus",
    mods: "C",
    press: { ...all(`${E}[45;5u`), legacy: "\x1f", decckm: "\x1f" },
  },
  {
    name: "Ctrl+Space is NUL in legacy",
    key: " ",
    code: "Space",
    mods: "C",
    press: { ...all(`${E}[32;5u`), legacy: "\0", decckm: "\0" },
  },
  {
    name: "Ctrl+Backspace kills a word on Windows and Linux",
    key: "Backspace",
    code: "Backspace",
    mods: "C",
    press: all("\x17"),
  },
  {
    name: "Ctrl+Backspace on the alternate screen",
    key: "Backspace",
    code: "Backspace",
    mods: "C",
    alt: true,
    press: { ...all(`${E}[127;5u`), legacy: "\b", decckm: "\b" },
  },

  // Ctrl+Shift: escape-coded with both modifiers (mod value 1 + 1 + 4 = 6).
  // In legacy mode there is no C0 byte for it; the encoder uses the same CSI u
  // form (xterm would send the unshifted control byte).
  ...(
    [
      ["P", "KeyP", 112],
      ["A", "KeyA", 97],
    ] as const
  ).map(
    ([key, code, base]): Row => ({
      name: `Ctrl+Shift+${key}`,
      key,
      code,
      mods: "CS",
      press: {
        ...all(`${E}[${base};6u`),
        k31: `${E}[${base}:${key.charCodeAt(0)};6u`,
      },
      release: {
        k3: `${E}[${base};6:3u`,
        k31: `${E}[${base}:${key.charCodeAt(0)};6:3u`,
      },
    }),
  ),
  {
    name: "Ctrl+Shift+Tab",
    key: "Tab",
    code: "Tab",
    mods: "CS",
    press: {
      ...all(`${E}[9;6u`),
      legacy: `${E}[27;6;9~`,
      decckm: `${E}[27;6;9~`,
    },
  },

  // Alt on Linux and Windows: ESC prefix in legacy, an escape code in Kitty.
  {
    name: "Alt+x",
    key: "x",
    code: "KeyX",
    mods: "A",
    press: { ...all(`${E}[120;3u`), legacy: `${E}x`, decckm: `${E}x` },
    release: { k3: `${E}[120;3:3u`, k31: `${E}[120;3:3u` },
  },
  {
    name: "Alt+Shift+x",
    key: "X",
    code: "KeyX",
    mods: "AS",
    press: {
      ...all(`${E}[120;4u`),
      legacy: `${E}X`,
      decckm: `${E}X`,
      k31: `${E}[120:88;4u`,
    },
  },
  {
    name: "Alt+Enter",
    key: "Enter",
    code: "Enter",
    mods: "A",
    press: { ...all(`${E}[13;3u`), legacy: `${E}\r`, decckm: `${E}\r` },
  },
  {
    name: "Alt+Backspace",
    key: "Backspace",
    code: "Backspace",
    mods: "A",
    press: { ...all(`${E}[127;3u`), legacy: `${E}\x7f`, decckm: `${E}\x7f` },
  },

  // Super (the Windows/Linux logo key): ignored by legacy encodings, mod 8 in
  // Kitty.
  {
    name: "Super+a",
    key: "a",
    code: "KeyA",
    mods: "M",
    press: { ...all(`${E}[97;9u`), legacy: "a", decckm: "a" },
  },

  // Keypad keys with Num Lock on type digits. Kitty reports the Num Lock state
  // (modifier bit 128) with the keys it escape-codes; below flag 8 it is
  // withheld so applications that match exact sequences keep seeing their keys.
  {
    name: "Numpad1 with Num Lock",
    key: "1",
    code: "Numpad1",
    press: {
      ...all("1"),
      k8: `${E}[57400;129u`,
      k31: `${E}[57400;129;49u`,
    },
  },
  {
    name: "NumpadEnter with Num Lock",
    key: "Enter",
    code: "NumpadEnter",
    press: {
      ...all("\r"),
      k1: `${E}[57414u`,
      k3: `${E}[57414u`,
      k8: `${E}[57414;129u`,
      k31: `${E}[57414;129u`,
    },
  },

  // macOS Option as text (the default): the character the layout produces.
  {
    name: "Option+a types å",
    key: "å",
    code: "KeyA",
    mods: "A",
    platform: "mac",
    press: all("å"),
  },
  {
    name: "Option+Shift+; types Ú",
    key: "Ú",
    code: "Semicolon",
    mods: "AS",
    platform: "mac",
    press: all("Ú"),
  },
  // macOS Option as Meta: the physical key with an ESC prefix.
  {
    name: "Option+b as Meta",
    key: "∫",
    code: "KeyB",
    mods: "A",
    platform: "macMeta",
    press: { ...all(`${E}[98;3u`), legacy: `${E}b`, decckm: `${E}b` },
  },
  {
    name: "Option+. as Meta",
    key: "≥",
    code: "Period",
    mods: "A",
    platform: "macMeta",
    press: { ...all(`${E}[46;3u`), legacy: `${E}.`, decckm: `${E}.` },
  },
  {
    name: "Option+Shift+f as Meta",
    key: "Ï",
    code: "KeyF",
    mods: "AS",
    platform: "macMeta",
    press: {
      ...all(`${E}[102;4u`),
      legacy: `${E}F`,
      decckm: `${E}F`,
      k31: `${E}[102:70;4u`,
    },
  },

  // macOS Option/Command navigation. Cmd+Left/Right/Backspace are Ctrl+A,
  // Ctrl+E and Ctrl+U on either screen (terminal.app / iTerm2 "natural text
  // editing"); Option+Left/Right are readline's ESC b / ESC f on the main
  // screen only, and are real modified arrows on the alternate screen.
  ...(
    [
      ["ArrowLeft", "\x01", `${E}b`, `${E}[1;3D`],
      ["ArrowRight", "\x05", `${E}f`, `${E}[1;3C`],
    ] as const
  ).flatMap(([key, command, word, altScreenWord]): Row[] => [
    {
      name: `Cmd+${key}`,
      key,
      code: key,
      mods: "M",
      platform: "mac",
      press: all(command),
    },
    {
      name: `Cmd+${key} on the alternate screen`,
      key,
      code: key,
      mods: "M",
      platform: "mac",
      alt: true,
      press: all(command),
    },
    {
      name: `Option+${key}`,
      key,
      code: key,
      mods: "A",
      platform: "mac",
      press: all(word),
    },
    {
      name: `Option+${key} on the alternate screen`,
      key,
      code: key,
      mods: "A",
      platform: "mac",
      alt: true,
      press: all(altScreenWord),
    },
  ]),
  {
    name: "Cmd+Backspace",
    key: "Backspace",
    code: "Backspace",
    mods: "M",
    platform: "mac",
    press: all("\x15"),
  },
  {
    name: "Option+Backspace",
    key: "Backspace",
    code: "Backspace",
    mods: "A",
    platform: "mac",
    press: all("\x17"),
  },
  {
    name: "Cmd+q stays with the native menu",
    key: "q",
    code: "KeyQ",
    mods: "M",
    platform: "mac",
    press: all(""),
  },

  // Windows AltGr (reported as Ctrl+Alt) types its character as text.
  {
    name: "AltGr+q types @",
    key: "@",
    code: "KeyQ",
    mods: "CA",
    platform: "windows",
    press: all("@"),
  },
];

const ARTIFACTS = ["ghostty-vt.wasm", "ghostty-vt-scalar.wasm"] as const;

describe.each(ARTIFACTS)("key encoding conformance (%s)", (artifact) => {
  let core: Awaited<ReturnType<typeof TeraxGhostty.loadBytes>>;

  const loadCore = async () => {
    if (core) return core;
    const bytes = await readFile(
      new URL(
        `../../../../../packages/ghostty-core/adapted/${artifact}`,
        import.meta.url,
      ),
    );
    core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
    return core;
  };

  describe.each(MODES)("$name", (mode) => {
    it.each(ROWS)("$name", async (row) => {
      const terminal = (await loadCore()).createTerminal(80, 24);
      const sent: string[] = [];
      const input = new FakeTextArea();
      const platform = row.platform ?? "linux";
      const decoder = new TextDecoder();
      const controller = new GhosttyInputController({
        model: terminalModel(terminal),
        input: input as unknown as HTMLTextAreaElement,
        pointerTarget: new FakeElement() as unknown as HTMLElement,
        cellSize: () => ({ width: 10, height: 20 }),
        isMac: platform === "mac" || platform === "macMeta",
        isWindows: platform === "windows",
        macOptionIsMeta: platform === "macMeta",
        onCopy: () => false,
        onData: (bytes) => sent.push(decoder.decode(bytes)),
      });
      try {
        const write = (text: string) =>
          terminal.write(new TextEncoder().encode(text));
        write(RESET);
        if (row.alt) write(`${E}[?1049h`);
        write(mode.setup);

        const down = keyEvent(row, "keydown");
        input.dispatchEvent(down);
        const expectedPress = row.press[mode.name];
        if (expectedPress === undefined) return;
        expect(sent.join("")).toBe(expectedPress);
        if (expectedPress !== "") expect(down.defaultPrevented).toBe(true);

        sent.length = 0;
        input.dispatchEvent(keyEvent(row, "keyup"));
        expect(sent.join("")).toBe(
          row.release?.[mode.name] ?? releaseOf(mode.name, row, expectedPress),
        );
      } finally {
        controller.dispose();
        terminal.dispose();
      }
    });
  });
});

/**
 * What a release reports, from the protocol's rules: only with flag 2, only for
 * keys that were escape-coded, never for Enter, Tab and Backspace below flag 8,
 * with the same key and modifiers, event type 3 and no associated text.
 */
function releaseOf(mode: ModeName, row: Row, press: string): string {
  if (mode !== "k3" && mode !== "k31") return "";
  if (mode === "k3" && ["Enter", "Tab", "Backspace"].includes(row.code))
    return "";
  const match =
    /^\x1b\[([\d:]*)(?:;(\d*)(?::\d+)?)?(?:;[\d:]*)?([A-Za-z~])$/.exec(press);
  if (!match || match[3] === "Z") return "";
  const [, key, modifiers, final] = match;
  return `${E}[${key || "1"};${modifiers || "1"}:3${final}`;
}

function keyEvent(row: Row, type: "keydown" | "keyup"): KeyboardEvent {
  const mods = row.mods ?? "";
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    key: row.key,
    code: row.code,
    keyCode: 0,
    shiftKey: mods.includes("S"),
    ctrlKey: mods.includes("C"),
    altKey: mods.includes("A"),
    metaKey: mods.includes("M"),
    repeat: false,
    isComposing: false,
    getModifierState: (name: string) =>
      name === "NumLock" && row.code.startsWith("Numpad"),
  }) as KeyboardEvent;
}

function terminalModel(
  terminal: ReturnType<
    Awaited<ReturnType<typeof TeraxGhostty.loadBytes>>["createTerminal"]
  >,
): GhosttyTerminalModelApi {
  return {
    cols: 80,
    rows: 24,
    modes: () => terminal.modes(),
    mode: (value: number) => terminal.mode(value),
    kittyKeyboardFlags: () => terminal.kittyKeyboardFlags(),
    encodeKey: (event: KeyEvent) => terminal.encodeKey(event),
    cursor: () => ({
      x: 0,
      y: 0,
      visible: true,
      blinking: false,
      style: "block",
    }),
    scrollToBottom: () => false,
    scrollPosition: () => ({ offset: 0, history: 0 }),
    scrollBy: () => false,
  } as unknown as GhosttyTerminalModelApi;
}
