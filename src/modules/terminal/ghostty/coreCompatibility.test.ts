import { readFile } from "node:fs/promises";
import {
  Ghostty,
  type GhosttyTerminal,
  Key,
  KeyAction,
  Mods,
} from "@terax/ghostty-core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { GhosttyTerminalEvent } from "@terax/ghostty-core/protocol";

let ghostty: Ghostty;

beforeAll(async () => {
  const path = new URL(
    "../../../../packages/ghostty-core/ghostty-vt.wasm",
    import.meta.url,
  );
  const file = await readFile(path);
  ghostty = await Ghostty.loadBytes(Uint8Array.from(file).buffer);
});

describe("vendored libghostty-vt compatibility", () => {
  it("rejects model access after freeing the native handle", () => {
    const terminal = ghostty.createTerminal(20, 4);
    terminal.free();
    for (const access of [
      () => terminal.resize(20, 4),
      () => terminal.update(),
      () => terminal.getCursorSnapshot(),
      () => terminal.getPackedViewport(),
      () => terminal.getScrollbackLength(),
      () => terminal.getPackedScrollbackLineSnapshot(0),
      () => terminal.readResponseBytes(),
      () => terminal.drainEvents(),
      () => terminal.getMode(25),
      () => terminal.getGrapheme(0, 0),
      () => terminal.isRowDirty(0),
      () => terminal.setCursorOptions("bar", true),
    ])
      expect(access).toThrow(/freed/);
    expect(() => terminal.free()).not.toThrow();
  });

  it("returns only active cells after the viewport shrinks", () => {
    const terminal = ghostty.createTerminal(20, 8);
    terminal.update();
    expect(terminal.getViewport()).toHaveLength(160);
    terminal.resize(10, 4);
    terminal.update();
    const active = terminal.getViewport();
    expect(active).toHaveLength(40);
    expect(terminal.getViewport()).toBe(active);
    terminal.free();
  });

  it.each([false, true])(
    "rejects a null viewport allocation (scrollback: %s)",
    (history) => {
      const terminal = ghostty.createTerminal(20, 4);
      terminal.write("line\r\n".repeat(8));
      terminal.update();
      const state = terminal as unknown as { exports: Record<string, unknown> };
      const allocate = vi.fn(
        state.exports.ghostty_wasm_alloc_u8_array as (length: number) => number,
      );
      state.exports = {
        ...state.exports,
        ghostty_wasm_alloc_u8_array: allocate,
      };
      const read = () =>
        history
          ? terminal.getPackedScrollbackLineSnapshot(0)
          : terminal.getPackedViewport();
      allocate.mockReturnValueOnce(0);
      expect(read).toThrow(/allocate/);
      expect(read()?.cellCount).toBeGreaterThan(0);
      terminal.free();
    },
  );

  it("skips oversized event payloads across chunks without interpreting their contents as headers", () => {
    const terminal = ghostty.createTerminal(20, 4);
    const { eventDecoder } = terminal as unknown as {
      eventDecoder: {
        push(bytes: Uint8Array, target: GhosttyTerminalEvent[]): void;
      };
    };
    const events: GhosttyTerminalEvent[] = [];
    const header = new Uint8Array(5);
    header[0] = 2;
    new DataView(header.buffer).setUint32(1, 1024 * 1024 + 1, true);
    eventDecoder.push(header.subarray(0, 2), events);
    eventDecoder.push(header.subarray(2), events);
    for (let chunk = 0; chunk < 256; chunk++)
      eventDecoder.push(new Uint8Array(4096).fill(1), events);
    eventDecoder.push(Uint8Array.of(1, 1, 0, 0, 0, 0), events);
    expect(events).toEqual([
      { type: "overflow", dropped: 1 },
      { type: "bell" },
    ]);
    terminal.free();
  });

  it("returns operating status and cursor position reports", () => {
    const terminal = ghostty.createTerminal(80, 24);
    expect(query(terminal, "\x1b[5n")).toBe("\x1b[0n");
    expect(query(terminal, "\x1b[6n")).toBe("\x1b[1;1R");
    terminal.free();
  });

  it("returns primary and secondary device attributes", () => {
    const terminal = ghostty.createTerminal(80, 24);
    try {
      expect(query(terminal, "\x1b[c")).toBe("\x1b[?62;22c");
      expect(query(terminal, "\x1b[>c")).toBe("\x1b[>1;10;0c");
    } finally {
      terminal.free();
    }
  });

  it("exposes a packed 16-byte cell viewport", () => {
    const terminal = ghostty.createTerminal(12, 4);
    terminal.write("hello");
    terminal.update();
    const viewport = terminal.getPackedViewport();
    expect(viewport.cellStride).toBe(16);
    expect(viewport.cellCount).toBe(48);
    expect(viewport.bytes.byteLength).toBe(48 * 16);
    terminal.free();
  });

  it("serializes unused viewport cells as empty cells", () => {
    const terminal = ghostty.createTerminal(12, 4);
    try {
      terminal.write("hello");
      terminal.update();
      const viewport = terminal.getPackedViewport();
      const cells = new DataView(
        viewport.bytes.buffer,
        viewport.bytes.byteOffset,
        viewport.bytes.byteLength,
      );

      for (let index = 5; index < viewport.cellCount; index += 1) {
        const offset = index * viewport.cellStride;
        expect(cells.getUint32(offset, true)).toBe(0);
        expect(cells.getUint8(offset + 11)).toBe(1);
        expect(cells.getUint8(offset + 14)).toBe(0);
      }
    } finally {
      terminal.free();
    }
  });

  it("round-trips configured and application-controlled cursor styles", () => {
    const terminal = ghostty.createTerminal(12, 4, {
      cursorStyle: "underline",
      cursorBlink: false,
    });
    try {
      terminal.update();
      expect(terminal.getCursorSnapshot()).toMatchObject({
        style: "underline",
        blinking: false,
      });

      terminal.write("\x1b[5 q");
      terminal.update();
      expect(terminal.getCursorSnapshot()).toMatchObject({
        style: "bar",
        blinking: true,
      });

      terminal.setCursorOptions("block", false);
      terminal.update();
      expect(terminal.getCursorSnapshot()).toMatchObject({
        style: "block",
        blinking: false,
      });
    } finally {
      terminal.free();
    }
  });

  it("emits bounded semantic events in parser order", () => {
    const terminal = ghostty.createTerminal(80, 24);
    try {
      terminal.write(
        "\x1b]2;Terax title\x07" +
          "\x1b]7;file://localhost/Users/terax\x1b\\" +
          "\x1b]133;A\x07" +
          "\x1b]133;B\x07" +
          "\x1b]133;C\x07" +
          "\x1b]133;D;7\x07" +
          "\x1b]52;c;aGVsbG8=\x07" +
          "\x07",
      );

      expect(terminal.drainEvents()).toEqual([
        { type: "title", title: "Terax title" },
        { type: "pwd", uri: "file://localhost/Users/terax" },
        { type: "prompt-start" },
        { type: "prompt-end" },
        { type: "end-of-input" },
        { type: "end-of-command", exitCode: 7 },
        { type: "clipboard", selection: "c", data: "aGVsbG8=" },
        { type: "bell" },
      ]);
      expect(terminal.drainEvents()).toEqual([]);
    } finally {
      terminal.free();
    }
  });

  it("resolves OSC 8 links with a reusable WASM buffer", () => {
    const terminal = ghostty.createTerminal(80, 24);
    try {
      const uri = "https://terax.dev/docs";
      terminal.write(`\x1b]8;;${uri}\x1b\\Terax\x1b]8;;\x1b\\`);
      terminal.update();
      expect(terminal.getHyperlinkUri(0, 0)).toBe(uri);
      const warmBytes = ghostty.getMemoryBytes();
      for (let index = 0; index < 1_000; index += 1) {
        expect(terminal.getHyperlinkUri(0, index % 5)).toBe(uri);
      }
      expect(ghostty.getMemoryBytes()).toBe(warmBytes);
    } finally {
      terminal.free();
    }
  });

  it("drains a semantic event stream larger than the reusable bridge chunk", () => {
    const terminal = ghostty.createTerminal(80, 24);
    try {
      // Ghostty intentionally bounds each OSC sequence to 2 KiB. Use many
      // valid records so the aggregate stream crosses the 64 KiB JS bridge
      // chunk without weakening that parser-level safety limit.
      const titles = Array.from(
        { length: 80 },
        (_, index) =>
          `${index.toString().padStart(2, "0")}:${"A".repeat(1024)}`,
      );
      terminal.write(titles.map((title) => `\x1b]2;${title}\x07`).join(""));

      const events = terminal.drainEvents();
      expect(events).toHaveLength(titles.length);
      expect(events[0]).toEqual({ type: "title", title: titles[0] });
      expect(events[events.length - 1]).toEqual({
        type: "title",
        title: titles[titles.length - 1],
      });
    } finally {
      terminal.free();
    }
  });

  it("reuses terminal allocations after lifecycle warmup", () => {
    runTerminalLifecycleCycle();
    const warmBytes = ghostty.getMemoryBytes();

    runTerminalLifecycleCycle();
    const secondCycleBytes = ghostty.getMemoryBytes();
    runTerminalLifecycleCycle();
    const thirdCycleBytes = ghostty.getMemoryBytes();

    // WebAssembly linear memory cannot shrink, but freed Ghostty allocations
    // must be reused. Allow one 64 KiB page for allocator bookkeeping.
    expect(secondCycleBytes - warmBytes).toBeLessThanOrEqual(64 * 1024);
    expect(thirdCycleBytes - secondCycleBytes).toBeLessThanOrEqual(64 * 1024);
  });

  it("reuses key encoder allocations after warmup", () => {
    const encoder = ghostty.createKeyEncoder();
    const event = {
      action: KeyAction.PRESS,
      key: Key.A,
      mods: Mods.CTRL,
      utf8: "a",
    };
    expect(Array.from(encoder.encode(event))).toEqual([1]);
    const warmBytes = ghostty.getMemoryBytes();
    for (let index = 0; index < 10_000; index += 1) encoder.encode(event);
    expect(ghostty.getMemoryBytes()).toBe(warmBytes);
    expect(
      Array.from(
        encoder.encode({
          action: KeyAction.PRESS,
          key: Key.ENTER,
          mods: Mods.NONE,
        }),
      ),
    ).toEqual([13]);
    encoder.dispose();
    encoder.dispose();
  });

  it("supports idempotent terminal disposal", () => {
    const terminal = ghostty.createTerminal(80, 24);
    terminal.free();
    terminal.free();
  });
});

function query(terminal: GhosttyTerminal, value: string): string | null {
  terminal.write(value);
  const response = terminal.readResponseBytes();
  return response ? new TextDecoder().decode(response) : null;
}

function runTerminalLifecycleCycle(): void {
  const terminals = Array.from({ length: 8 }, () =>
    ghostty.createTerminal(100, 32, { scrollbackLimit: 512 }),
  );
  try {
    for (const [index, terminal] of terminals.entries()) {
      const lines = Array.from(
        { length: 160 },
        (_, line) => `${index}:${line} λ 日本語 emoji🙂 terminal lifecycle\r\n`,
      ).join("");
      terminal.write(lines);
      terminal.write(`\x1b]2;lifecycle-${index}\x07`);
      terminal.update();
      expect(terminal.getPackedViewport().cellCount).toBe(100 * 32);
      expect(terminal.drainEvents()).toEqual([
        { type: "title", title: `lifecycle-${index}` },
      ]);
    }
  } finally {
    for (const terminal of terminals) terminal.free();
  }
}
