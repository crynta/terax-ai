import { readFile } from "node:fs/promises";
import {
  Ghostty,
  type GhosttyTerminal,
  Key,
  KeyAction,
  Mods,
} from "@terax/ghostty-core";
import { beforeAll, describe, expect, it } from "vitest";

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
