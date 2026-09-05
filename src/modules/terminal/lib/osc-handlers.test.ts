import { describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import {
  createShellIntegrationState,
  formatOscRgb,
  parseCssRgb,
  registerCwdHandler,
  registerOsc52ClipboardHandler,
  registerOscColorQueryHandlers,
  registerPromptTracker,
} from "./osc-handlers";

// git-bash path mapping is Windows-only; exercise that branch.
vi.mock("@/lib/platform", () => ({ IS_WINDOWS: true }));

/**
 * Minimal in-memory fake of the xterm `Terminal` surface we touch — just
 * enough to register OSC handlers and invoke them with crafted payloads.
 * The OSC handler signature is `(data: string) => boolean | Promise<boolean>`.
 */
type OscHandler = (data: string) => boolean | Promise<boolean>;

function makeFakeTerm() {
  const handlers = new Map<number, OscHandler>();
  const term = {
    parser: {
      registerOscHandler(code: number, handler: OscHandler) {
        handlers.set(code, handler);
        return { dispose: () => handlers.delete(code) };
      },
    },
    registerMarker: vi.fn().mockReturnValue({ isDisposed: false, dispose: vi.fn() }),
  } as unknown as Terminal;
  return { term, handlers };
}

async function flushClipboardQueue() {
  await Promise.resolve();
}

describe("OSC 7 cwd handler — gated by OSC 133 in-command state", () => {
  it("accepts OSC 7 when no command is running", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const onCwd = vi.fn();
    registerPromptTracker(term, state);
    registerCwdHandler(term, onCwd, state);

    // OSC 133 A means "new prompt is about to be drawn" — we're between
    // commands and OSC 7 from the shell is legitimate here.
    handlers.get(133)?.("A");
    handlers.get(7)?.("file://host/home/me/project");

    expect(onCwd).toHaveBeenCalledWith("/home/me/project");
  });

  it("maps git-bash /c/ cwd to a Windows drive path", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const onCwd = vi.fn();
    registerPromptTracker(term, state);
    registerCwdHandler(term, onCwd, state);

    handlers.get(133)?.("A");
    handlers.get(7)?.("file:///c/Users/leo/project");

    expect(onCwd).toHaveBeenCalledWith("C:/Users/leo/project");
  });

  it("rejects OSC 7 emitted while a command is running", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const onCwd = vi.fn();
    registerPromptTracker(term, state);
    registerCwdHandler(term, onCwd, state);

    // Simulate: user runs `ssh attacker.host`, which prints attacker bytes
    // including an OSC 7 trying to silently move the AI's cwd into /etc.
    handlers.get(133)?.("A"); // prompt drawn
    handlers.get(133)?.("B"); // command begins (user hit enter)
    handlers.get(7)?.("file://host/etc"); // attacker injection

    expect(onCwd).not.toHaveBeenCalled();
  });

  it("re-accepts OSC 7 after command finishes (OSC 133 D)", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const onCwd = vi.fn();
    registerPromptTracker(term, state);
    registerCwdHandler(term, onCwd, state);

    handlers.get(133)?.("A");
    handlers.get(133)?.("B"); // running
    handlers.get(7)?.("file://host/etc"); // blocked
    handlers.get(133)?.("D;0"); // command exited
    handlers.get(7)?.("file://host/home/me/new-cwd"); // legitimate post-cmd OSC 7

    expect(onCwd).toHaveBeenCalledTimes(1);
    expect(onCwd).toHaveBeenCalledWith("/home/me/new-cwd");
  });

  it("works without state for backwards compatibility (legacy callers)", () => {
    // The state parameter is optional — when omitted, OSC 7 is always
    // honored (legacy behavior). Tests must confirm we didn't break this.
    const { term, handlers } = makeFakeTerm();
    const onCwd = vi.fn();
    registerCwdHandler(term, onCwd);

    handlers.get(7)?.("file://host/home/me/project");
    expect(onCwd).toHaveBeenCalledWith("/home/me/project");
  });

  it("normalizes Windows drive-letter OSC 7 paths", () => {
    const { term, handlers } = makeFakeTerm();
    const onCwd = vi.fn();
    registerCwdHandler(term, onCwd);

    handlers.get(7)?.("file:///C:/Users/me/project");
    expect(onCwd).toHaveBeenCalledWith("C:/Users/me/project");
  });
});

describe("OSC 133 command-state tracking", () => {
  it("reports running only between C and D, not while typing at the prompt", () => {
    const { term, handlers } = makeFakeTerm();
    const onCommandState = vi.fn();
    registerPromptTracker(term, undefined, onCommandState);

    handlers.get(133)?.("A");
    expect(onCommandState).toHaveBeenLastCalledWith(false);
    handlers.get(133)?.("B");
    expect(onCommandState).toHaveBeenCalledTimes(1);
    handlers.get(133)?.("C;claude");
    expect(onCommandState).toHaveBeenLastCalledWith(true);
    handlers.get(133)?.("D;0");
    expect(onCommandState).toHaveBeenLastCalledWith(false);
  });

  it("clears running state on a bare new prompt when D was lost", () => {
    const { term, handlers } = makeFakeTerm();
    const onCommandState = vi.fn();
    registerPromptTracker(term, undefined, onCommandState);

    handlers.get(133)?.("C;vim");
    expect(onCommandState).toHaveBeenLastCalledWith(true);
    handlers.get(133)?.("A");
    expect(onCommandState).toHaveBeenLastCalledWith(false);
  });
});

describe("OSC 52 clipboard handler", () => {
  it("writes decoded clipboard payloads", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    registerOsc52ClipboardHandler(term, writeClipboard);

    const result = handlers.get(52)?.("c;SGVsbG8=");
    await flushClipboardQueue();

    expect(result).toBe(true);
    expect(writeClipboard).toHaveBeenCalledWith("Hello");
  });

  it("decodes UTF-8 payloads", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    registerOsc52ClipboardHandler(term, writeClipboard);

    handlers.get(52)?.("c;8J+YgCBtZXJoYWJh");
    await flushClipboardQueue();

    expect(writeClipboard).toHaveBeenCalledWith("😀 merhaba");
  });

  it("does not block the parser on clipboard writes", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn(() => new Promise<void>(() => {}));
    registerOsc52ClipboardHandler(term, writeClipboard);

    const result = handlers.get(52)?.("c;SGVsbG8=");

    expect(result).toBe(true);
    expect(writeClipboard).not.toHaveBeenCalled();
    await flushClipboardQueue();
    expect(writeClipboard).toHaveBeenCalledWith("Hello");
  });

  it("ignores primary-selection-only payloads", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    registerOsc52ClipboardHandler(term, writeClipboard);

    await handlers.get(52)?.("p;SGVsbG8=");
    await flushClipboardQueue();

    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it("ignores clipboard queries and malformed payloads", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    registerOsc52ClipboardHandler(term, writeClipboard);

    await handlers.get(52)?.("c;?");
    await handlers.get(52)?.("c;not base64!");
    await handlers.get(52)?.("s;SGVsbG8=");
    await flushClipboardQueue();

    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it("ignores oversized payloads", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    registerOsc52ClipboardHandler(term, writeClipboard);

    await handlers.get(52)?.(`c;${"A".repeat(1_398_110)}`);
    await flushClipboardQueue();

    expect(writeClipboard).not.toHaveBeenCalled();
  });
});

describe("parseCssRgb / formatOscRgb", () => {
  it("parses rgb / rgba / #hex forms", () => {
    expect(parseCssRgb("rgb(26, 27, 38)")).toEqual({ r: 26, g: 27, b: 38 });
    expect(parseCssRgb("rgba(255, 128, 0, 0.5)")).toEqual({
      r: 255,
      g: 128,
      b: 0,
    });
    expect(parseCssRgb("#1a1b26")).toEqual({ r: 0x1a, g: 0x1b, b: 0x26 });
    expect(parseCssRgb("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(parseCssRgb("not-a-color")).toBeNull();
  });

  it("formats 8-bit RGB as duplicated 16-bit OSC hex", () => {
    expect(formatOscRgb({ r: 26, g: 27, b: 38 })).toBe(
      "rgb:1A1A/1B1B/2626",
    );
    expect(formatOscRgb({ r: 255, g: 0, b: 128 })).toBe(
      "rgb:FFFF/0000/8080",
    );
  });
});

describe("OSC 10/11 color query handlers", () => {
  it("replies to OSC 11 ? with getBg color", () => {
    const { term, handlers } = makeFakeTerm();
    const writePty = vi.fn();
    registerOscColorQueryHandlers(term, {
      writePty,
      getFg: () => ({ r: 1, g: 2, b: 3 }),
      getBg: () => ({ r: 26, g: 27, b: 38 }),
    });

    const result = handlers.get(11)?.("?");
    expect(result).toBe(true);
    expect(writePty).toHaveBeenCalledWith("\x1b]11;rgb:1A1A/1B1B/2626\x07");
  });

  it("replies to OSC 10 ? with getFg color", () => {
    const { term, handlers } = makeFakeTerm();
    const writePty = vi.fn();
    registerOscColorQueryHandlers(term, {
      writePty,
      getFg: () => ({ r: 192, g: 202, b: 245 }),
      getBg: () => ({ r: 26, g: 27, b: 38 }),
    });

    const result = handlers.get(10)?.("?");
    expect(result).toBe(true);
    expect(writePty).toHaveBeenCalledWith("\x1b]10;rgb:C0C0/CACA/F5F5\x07");
  });

  it("writes nothing when getBg returns null", () => {
    const { term, handlers } = makeFakeTerm();
    const writePty = vi.fn();
    registerOscColorQueryHandlers(term, {
      writePty,
      getFg: () => ({ r: 1, g: 2, b: 3 }),
      getBg: () => null,
    });

    expect(handlers.get(11)?.("?")).toBe(true);
    expect(writePty).not.toHaveBeenCalled();
  });

  it("consumes non-query payloads without writing", () => {
    const { term, handlers } = makeFakeTerm();
    const writePty = vi.fn();
    registerOscColorQueryHandlers(term, {
      writePty,
      getFg: () => ({ r: 1, g: 2, b: 3 }),
      getBg: () => ({ r: 4, g: 5, b: 6 }),
    });

    expect(handlers.get(11)?.("rgb:0000/0000/0000")).toBe(true);
    expect(handlers.get(10)?.("rgb:FFFF/FFFF/FFFF")).toBe(true);
    expect(writePty).not.toHaveBeenCalled();
  });
});
