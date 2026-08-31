import { readFile } from "node:fs/promises";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PackedCellView } from "./core/packedCells";
import { GhosttyCoreRuntime } from "./GhosttyCoreRuntime";

let wasmBytes: ArrayBuffer;

beforeAll(async () => {
  const path = new URL(
    "../../../../packages/ghostty-core/adapted/ghostty-vt.wasm",
    import.meta.url,
  );
  const file = await readFile(path);
  wasmBytes = Uint8Array.from(file).buffer;
});

describe("GhosttyCoreRuntime", () => {
  it("loads one WASM runtime for concurrent terminal models", async () => {
    const loader = vi.fn(() => TeraxGhostty.loadBytes(wasmBytes.slice(0)));
    const runtime = new GhosttyCoreRuntime(loader);
    const [first, second] = await Promise.all([
      runtime.createModel({ leafId: 1, cols: 80, rows: 24 }),
      runtime.createModel({ leafId: 2, cols: 120, rows: 40 }),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(runtime.diagnostics()).toMatchObject({
      status: "ready",
      modelCount: 2,
      pendingModelCount: 0,
    });
    expect(runtime.diagnostics().wasmMemoryBytes).toBeGreaterThan(0);

    first.dispose();
    expect(runtime.diagnostics().modelCount).toBe(1);
    runtime.disposeAllModels();
    expect(runtime.diagnostics().modelCount).toBe(0);
    second.dispose();
  });

  it("releases an idle high-water WASM instance and reloads on demand", async () => {
    vi.useFakeTimers();
    try {
      const loader = vi.fn(() => TeraxGhostty.loadBytes(wasmBytes.slice(0)));
      const runtime = new GhosttyCoreRuntime(loader);
      const first = await runtime.createModel({
        leafId: 101,
        cols: 80,
        rows: 24,
      });

      expect(runtime.diagnostics().wasmMemoryBytes).toBeGreaterThan(0);
      first.dispose();
      expect(runtime.diagnostics().idleReleaseScheduled).toBe(true);

      await vi.advanceTimersByTimeAsync(30_000);
      const second = await runtime.createModel({
        leafId: 102,
        cols: 80,
        rows: 24,
      });
      expect(loader).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runtime.diagnostics()).toMatchObject({
        status: "ready",
        modelCount: 1,
        idleReleaseScheduled: false,
      });

      second.dispose();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runtime.diagnostics()).toMatchObject({
        status: "cold",
        wasmMemoryBytes: 0,
        idleReleaseScheduled: false,
      });

      const third = await runtime.createModel({
        leafId: 103,
        cols: 80,
        rows: 24,
      });
      expect(loader).toHaveBeenCalledTimes(2);
      third.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps parsing while no rendering surface is attached", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const damage = vi.fn();
    const model = await runtime.createModel({
      leafId: 7,
      cols: 20,
      rows: 4,
    });
    model.consumeDamage();
    model.subscribeDamage(damage);

    model.write(new TextEncoder().encode("hidden output"));

    expect(damage).toHaveBeenCalledTimes(1);
    expect(model.readText(4)).toContain("hidden output");
    expect(model.consumeDamage().kind).not.toBe("none");
    expect(model.consumeDamage()).toEqual({ kind: "none" });
    model.dispose();
  });

  it("keeps renderer identity out of the shared Ghostty model runtime", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 16,
      backend: "ghostty-webgl",
      cols: 80,
      rows: 24,
    });

    expect(model.backend).toBe("ghostty-webgl");
    expect(model.diagnostics().backend).toBe("ghostty-webgl");
    expect(runtime.diagnostics().modelCount).toBe(1);
    model.dispose();
  });

  it("coalesces high-frequency PTY chunks into one render-state update", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 8,
      cols: 80,
      rows: 24,
    });
    model.consumeDamage();
    const warmUpdates = model.diagnostics().renderStateUpdates ?? 0;
    const damage = vi.fn();
    model.subscribeDamage(damage);

    for (let index = 0; index < 100; index += 1) {
      model.write(new TextEncoder().encode(`${index}\r\n`));
    }

    expect(damage).toHaveBeenCalledTimes(1);
    expect(model.diagnostics()).toMatchObject({
      writes: 100,
      renderStateUpdates: warmUpdates,
    });
    expect(model.consumeDamage().kind).not.toBe("none");
    expect(model.diagnostics().renderStateUpdates).toBe(warmUpdates + 1);
    expect(model.consumeDamage()).toEqual({ kind: "none" });
    expect(model.diagnostics().renderStateUpdates).toBe(warmUpdates + 1);
    model.dispose();
  });

  it("presents an OSC 133 wrapped Starship prompt atomically", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 18,
      cols: 80,
      rows: 24,
    });
    model.consumeDamage();
    const damage = vi.fn();
    model.subscribeDamage(damage);

    model.write(new TextEncoder().encode("previous output\r\n"));
    expect(damage).toHaveBeenCalledTimes(1);
    model.write(new TextEncoder().encode("\x1b]133;A\x1b\\partial"));
    expect(model.presentationSuppressed()).toBe(true);
    expect(model.deferPresentation()).toBe(true);
    damage.mockClear();

    model.write(new TextEncoder().encode(" prompt\x1b]133;B\x1b\\"));
    expect(damage).toHaveBeenCalledTimes(1);
    expect(model.presentationSuppressed()).toBe(false);
    expect(model.consumeDamage().kind).not.toBe("none");
    expect(model.readText(24)).toContain("partial prompt");
    model.dispose();
  });

  it("holds synchronized output until reset with a bounded watchdog", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 17,
      cols: 80,
      rows: 24,
    });
    model.consumeDamage();
    const damage = vi.fn();
    model.subscribeDamage(damage);
    vi.useFakeTimers();

    try {
      model.write(new TextEncoder().encode("\x1b[?2026hfirst"));
      expect(damage).not.toHaveBeenCalled();
      expect(model.presentationSuppressed()).toBe(true);
      expect(model.deferPresentation()).toBe(true);

      await vi.advanceTimersByTimeAsync(999);
      expect(damage).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(damage).toHaveBeenCalledTimes(1);
      expect(model.presentationSuppressed()).toBe(false);
      expect(model.consumeDamage().kind).not.toBe("none");

      damage.mockClear();
      model.write(new TextEncoder().encode("second"));
      expect(damage).not.toHaveBeenCalled();
      expect(model.deferPresentation()).toBe(true);

      model.write(new TextEncoder().encode("\x1b[?2026l"));
      expect(damage).toHaveBeenCalledTimes(1);
      expect(model.presentationSuppressed()).toBe(false);
      expect(model.consumeDamage().kind).not.toBe("none");
    } finally {
      model.dispose();
      vi.useRealTimers();
    }
  });

  it("does not present Fish's partial synchronized repaint from a queued resize frame", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 19,
      cols: 80,
      rows: 24,
    });
    const encode = (value: string) => new TextEncoder().encode(value);
    model.write(encode("~/terax > "));
    model.consumeDamage();
    const damage = vi.fn();
    model.subscribeDamage(damage);

    model.resize(100, 24);
    expect(damage).toHaveBeenCalledTimes(1);

    model.write(encode("\x1b[?2026h\r\x1b[2K"));
    expect(model.readText(24)).not.toContain("~/terax >");
    expect(model.deferPresentation()).toBe(true);

    damage.mockClear();
    model.write(encode("~/terax > \x1b[?2026l"));
    expect(model.presentationSuppressed()).toBe(false);
    expect(damage).toHaveBeenCalledTimes(1);
    expect(model.consumeDamage().kind).not.toBe("none");
    expect(model.readText(24)).toContain("~/terax >");
    model.dispose();
  });

  it("keeps a bottom-anchored Fish Starship prompt complete during local reflow", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 20,
      cols: 120,
      rows: 30,
    });
    const prompt =
      "\x1b[J" +
      "\x1b[1;36mterax-ghostty\x1b[0m on " +
      "\x1b[1;35m feat/ghostty-webgpu-terminal\x1b[0m " +
      "\x1b[1;31m[!?]\x1b[0m via \x1b[1;32m v26.5.0\x1b[0m\r\n" +
      "\x1b[1;32m❯\x1b[0m ";
    model.write(
      new TextEncoder().encode(
        `${Array.from({ length: 40 }, (_, index) => `line-${index}\r\n`).join("")}${prompt}`,
      ),
    );
    expect(model.readText(30)).toContain("terax-ghostty");
    expect(model.readText(30)).toContain("❯");

    for (const cols of [119, 105, 90, 72, 55, 40, 55, 72, 88, 104, 120]) {
      model.resize(cols, 30);
      model.consumeDamage();
      expect(model.readText(30)).toContain("terax-ghostty");
      expect(model.readText(30)).toContain("❯");
      expect(model.cursor().y).toBe(29);
    }
    model.dispose();
  });

  it("drains terminal replies as bytes in protocol order", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const replies: Uint8Array[] = [];
    const model = await runtime.createModel({
      leafId: 9,
      cols: 80,
      rows: 24,
      onReply: (bytes) => replies.push(bytes),
    });

    model.write(new TextEncoder().encode("\x1b[c\x1b[5n\x1b[>c\x1b[6n"));

    expect(new TextDecoder().decode(concat(replies))).toBe(
      "\x1b[?62;22;52c\x1b[0n\x1b[>1;10;0c\x1b[1;1R",
    );
    expect(runtime.diagnostics().nativeDeviceAttributes).toBe(true);
    model.dispose();
  });

  it("renders a bounded scrollback viewport and returns to the live screen", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 10,
      cols: 10,
      rows: 3,
      config: { scrollbackLimit: 100 },
    });
    model.consumeDamage();
    model.write(new TextEncoder().encode("one\r\ntwo\r\nthree\r\nfour"));

    expect(model.scrollPosition()).toEqual({ offset: 0, history: 1 });
    expect(readViewportRows(model)).toEqual(["two", "three", "four"]);

    expect(model.scrollBy(-1)).toBe(true);
    expect(model.scrollPosition()).toEqual({ offset: 1, history: 1 });
    expect(readViewportRows(model)).toEqual(["one", "two", "three"]);
    expect(model.cursor().visible).toBe(false);

    expect(model.scrollToBottom()).toBe(true);
    expect(readViewportRows(model)).toEqual(["two", "three", "four"]);
    model.dispose();
  });

  it("extracts linear and rectangular selections from scrollback", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 13,
      cols: 10,
      rows: 3,
      config: { scrollbackLimit: 100 },
    });
    model.write(new TextEncoder().encode("one\r\ntwo  words\r\nthree\r\nfour"));

    expect(
      model.selectionText({
        anchor: { line: 0, column: 1 },
        focus: { line: 2, column: 2 },
        rectangular: false,
      }),
    ).toBe("ne\ntwo  words\nthr");
    expect(
      model.selectionText({
        anchor: { line: 0, column: 0 },
        focus: { line: 2, column: 2 },
        rectangular: true,
      }),
    ).toBe("one\ntwo\nthr");
    expect(model.wordRangeAt({ line: 1, column: 6 })).toEqual({
      start: 5,
      end: 9,
    });
    model.dispose();
  });

  it("copies soft-wrapped rows as one logical line", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 14,
      cols: 5,
      rows: 3,
    });
    model.write(new TextEncoder().encode("abcdefghij"));

    expect(
      model.selectionText({
        anchor: { line: 0, column: 0 },
        focus: { line: 1, column: 4 },
        rectangular: false,
      }),
    ).toBe("abcdefghij");
    model.dispose();
  });

  it("clears history while preserving the active cursor line", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 16,
      cols: 12,
      rows: 3,
    });
    model.write(new TextEncoder().encode("old one\r\nold two\r\nprompt"));

    model.clear();

    expect(model.scrollPosition()).toEqual({ offset: 0, history: 0 });
    expect(readViewportRows(model)).toEqual(["prompt", "", ""]);
    expect(model.cursor()).toEqual(expect.objectContaining({ x: 6, y: 0 }));
    model.dispose();
  });

  it("maps OSC 8 links through the visible viewport", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 15,
      cols: 20,
      rows: 3,
    });
    const uri = "https://terax.dev/docs";
    model.write(
      new TextEncoder().encode(`\x1b]8;;${uri}\x1b\\Terax\x1b]8;;\x1b\\ plain`),
    );

    expect(model.hyperlinkAtViewportCell(0, 0)).toBe(uri);
    expect(model.hyperlinkAtViewportCell(0, 4)).toBe(uri);
    expect(model.hyperlinkAtViewportCell(0, 6)).toBeNull();
    expect(model.hyperlinkAtViewportCell(-1, 0)).toBeNull();
    model.dispose();
  });

  it("updates model colors in place without changing terminal content", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 18,
      cols: 8,
      rows: 2,
      config: {
        fgColor: 0x010203,
        bgColor: 0x040506,
        cursorColor: 0x070809,
        palette: Array.from({ length: 16 }, () => 0),
      },
    });
    model.write(new TextEncoder().encode("A"));
    model.consumeDamage();
    const revision = model.revision();

    expect(model.setColors(0x112233, 0x445566, 0x778899, [])).toBe(true);
    expect(model.revision()).toBe(revision);
    expect(model.consumeDamage()).toEqual({ kind: "full" });
    expect(model.renderCells().foregroundPacked(0)).toBe(0x112233);
    expect(readViewportRows(model)[0]).toBe("A");
    model.dispose();
  });

  it("rejects duplicate leaves and unbounded dimensions", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 11,
      cols: 80,
      rows: 24,
    });

    await expect(
      runtime.createModel({ leafId: 11, cols: 80, rows: 24 }),
    ).rejects.toThrow("already exists");
    await expect(
      runtime.createModel({ leafId: 12, cols: 4_096, rows: 4_096 }),
    ).rejects.toThrow(RangeError);
    expect(runtime.diagnostics().pendingModelCount).toBe(0);
    model.dispose();
  });
});

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function readViewportRows(model: {
  readonly cols: number;
  readonly rows: number;
  viewport(): { bytes: Uint8Array };
}): string[] {
  const cells = new PackedCellView(model.viewport().bytes);
  const lines: string[] = [];
  for (let row = 0; row < model.rows; row += 1) {
    let line = "";
    for (let column = 0; column < model.cols; column += 1) {
      const index = row * model.cols + column;
      const codepoint = cells.codepoint(index);
      line +=
        cells.width(index) === 0 || codepoint === 0
          ? " "
          : String.fromCodePoint(codepoint);
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
