import { readFile } from "node:fs/promises";
import {
  GPU_CELL_BYTES,
  TeraxGhostty,
  decodeGpuCell,
} from "@terax/ghostty-core/adapted";
import { beforeAll, describe, expect, it } from "vitest";
import { AdaptedGhosttyTerminalModel } from "./AdaptedGhosttyTerminalModel";
import type { GhosttyGpuFrame } from "./GhosttyTerminalModel";

const encoder = new TextEncoder();

describe.each(["ghostty-vt", "ghostty-vt-scalar"])(
  "GPU frames from the adapted Ghostty model (%s)",
  (artifact) => {
    let core: TeraxGhostty;

    beforeAll(async () => {
      const file = await readFile(
        new URL(
          `../../../../packages/ghostty-core/adapted/${artifact}.wasm`,
          import.meta.url,
        ),
      );
      core = await TeraxGhostty.loadBytes(Uint8Array.from(file).buffer);
    });

    function create(cols = 40, rows = 8) {
      const model = new AdaptedGhosttyTerminalModel(core, {
        backend: "ghostty-webgpu",
        cols,
        rows,
      });
      const reader = new FrameReader();
      return {
        model,
        reader,
        write: (text: string) => model.write(encoder.encode(text)),
        /** Consume a frame and apply it to this model's renderer-side map. */
        frame: (options?: Parameters<typeof model.consumeGpuFrame>[0]) =>
          reader.apply(model.consumeGpuFrame(options)),
      };
    }

    /** A renderer-side glyph map: resets on epoch change, grows with deltas. */
    class FrameReader {
      private epoch = 0;
      private readonly glyphs = new Map<number, string>();

      apply(frame: GhosttyGpuFrame): GhosttyGpuFrame {
        if (frame.epoch !== this.epoch) {
          this.glyphs.clear();
          this.epoch = frame.epoch;
        }
        for (const glyph of frame.newGlyphs)
          this.glyphs.set(glyph.id, glyph.text);
        return frame;
      }

      rowText(frame: GhosttyGpuFrame, row: number) {
        const words = new Uint32Array(
          frame.cells.buffer,
          frame.cells.byteOffset,
          frame.cells.byteLength / 4,
        );
        let text = "";
        for (let column = 0; column < frame.cols; column += 1) {
          const id = decodeGpuCell(words, row * frame.cols + column).glyphId;
          if (id === 0) text += " ";
          else text += this.glyphs.get(id) ?? "?";
        }
        return text.trimEnd();
      }
    }

    it("delivers a full first frame, then quiet frames with no damage", () => {
      const { model, write, reader } = create();
      try {
        expect(model.renderFormat()).toBe("soa");
        write("hello \x1b[5mblink\x1b[0m");
        const first = model.consumeGpuFrame();
        expect(model.renderFormat()).toBe("gpu");
        expect(first).toMatchObject({
          rows: 8,
          cols: 40,
          fullDamage: true,
          dirtyRanges: [{ start: 0, end: 7 }],
          damage: { kind: "full" },
          blinkingCells: 5,
        });
        expect(first.cells.byteLength).toBe(40 * 8 * GPU_CELL_BYTES);
        expect(first.cells.buffer).toBe(first.memory.buffer);
        expect(first.glyphCount).toBe(first.newGlyphs.length);
        expect(first.newGlyphs.map((glyph) => glyph.text).join("")).toBe(
          "helobink",
        );
        reader.apply(first);
        expect(reader.rowText(first, 0)).toBe("hello blink");

        const quiet = model.consumeGpuFrame();
        expect(quiet.fullDamage).toBe(false);
        expect(quiet.dirtyRanges).toEqual([]);
        expect(quiet.damage).toEqual({ kind: "none" });
        expect(quiet.newGlyphs).toEqual([]);
        expect(quiet.epoch).toBe(first.epoch);
      } finally {
        model.dispose();
      }
    });

    it("reports only changed rows for an Ink-like full redraw with one changed character", () => {
      const { model, write } = create(60, 14);
      try {
        const body = (spinner: string) =>
          Array.from(
            { length: 12 },
            (_, line) =>
              `\r\x1b[2K${line === 0 ? `\x1b[36m${spinner}\x1b[0m ` : "  "}agent output line ${line}`,
          ).join("\r\n");
        const redraw = (spinner: string) => `\x1b[11A${body(spinner)}`;
        write(body("a"));
        model.consumeGpuFrame();

        write(redraw("a"));
        const same = model.consumeGpuFrame();
        expect(same.dirtyRanges).toEqual([]);
        expect(same.damage).toEqual({ kind: "none" });
        expect(model.deferPresentation()).toBe(false);

        write(redraw("b"));
        const changed = model.consumeGpuFrame();
        expect(changed.dirtyRanges).toEqual([{ start: 0, end: 0 }]);
        expect(changed.damage).toEqual({
          kind: "rows",
          ranges: [{ start: 0, end: 0 }],
        });
        expect(changed.newGlyphs.map((glyph) => glyph.text)).toEqual(["b"]);
      } finally {
        model.dispose();
      }
    });

    it("accumulates record changes across updates a hover forced before the frame", () => {
      const { model, write } = create(40, 8);
      try {
        write(
          "\x1b]8;;https://example.test/x\x1b\\link\x1b]8;;\x1b\\\r\n\r\n\r\n\r\n\r\n\r\n",
        );
        model.consumeGpuFrame();

        write("\x1b[3;1Hrow two changed");
        // A pointer move reads links, which forces a render-state update.
        expect(model.hyperlinkAtViewportCell(0, 1)).toBe(
          "https://example.test/x",
        );
        write("\x1b[6;1Hrow five changed");
        const frame = model.consumeGpuFrame();
        expect(frame.dirtyRanges).toEqual([
          { start: 2, end: 2 },
          { start: 5, end: 5 },
        ]);
      } finally {
        model.dispose();
      }
    });

    it("keeps rows dirtied by an update a hover forced in the SoA format too", () => {
      const { model, write } = create(40, 8);
      try {
        write(
          "\x1b]8;;https://example.test/x\x1b\\link\x1b]8;;\x1b\\\r\n\r\n\r\n\r\n\r\n\r\n",
        );
        model.renderCells();
        model.consumeDamage();

        write("\x1b[3;1Hrow two changed");
        expect(model.hyperlinkAtViewportCell(0, 1)).toBe(
          "https://example.test/x",
        );
        write("\x1b[6;1Hrow five changed");
        expect(model.renderFormat()).toBe("soa");
        // The SoA format reports Ghostty-dirty rows (including the row the
        // cursor left); both edited rows must be present.
        expect(model.consumeDamage()).toEqual({
          kind: "rows",
          ranges: [
            { start: 2, end: 2 },
            { start: 5, end: 6 },
          ],
        });
      } finally {
        model.dispose();
      }
    });

    it("honors synchronized output through deferPresentation and then delivers every change", () => {
      const { model, write, frame: consume, reader } = create();
      try {
        write("stable");
        consume();
        write("\x1b[?2026h\x1b[2;1Hpartial");
        expect(model.deferPresentation()).toBe(true);
        write("\x1b[3;1Hcomplete\x1b[?2026l");
        expect(model.deferPresentation()).toBe(false);
        const frame = consume();
        expect(frame.dirtyRanges).toEqual([{ start: 1, end: 2 }]);
        expect(reader.rowText(frame, 1)).toBe("partial");
        expect(reader.rowText(frame, 2)).toBe("complete");
      } finally {
        model.dispose();
      }
    });

    it("keeps overlay damage separate from record damage", () => {
      const { model, write } = create();
      try {
        write("one\r\ntwo\r\nthree");
        model.consumeGpuFrame();
        model.setSelection({
          anchor: { line: 0, column: 0 },
          focus: { line: 1, column: 2 },
          rectangular: false,
        });
        const selected = model.consumeGpuFrame();
        expect(selected.dirtyRanges).toEqual([]);
        expect(selected.damage).toEqual({
          kind: "rows",
          ranges: [{ start: 0, end: 1 }],
        });
        model.setCursorOptions("bar", true);
        const cursor = model.consumeGpuFrame();
        expect(cursor.dirtyRanges).toEqual([]);
        expect(cursor.damage).toEqual({ kind: "full" });
      } finally {
        model.dispose();
      }
    });

    it("answers cursor, link, grapheme and line queries without disturbing the frame", () => {
      const { model, write } = create(60, 6);
      try {
        write(
          "see \x1b]8;;https://example.test/a\x1b\\link\x1b]8;;\x1b\\ https://plain.example/path 日本\x1b[2;1Hsecond",
        );
        model.consumeGpuFrame();
        expect(model.cursor()).toMatchObject({ x: 6, y: 1, visible: true });
        expect(model.hyperlinkAtViewportCell(0, 5)).toBe(
          "https://example.test/a",
        );
        expect(model.hyperlinkAtViewportCell(0, 15)).toBe(
          "https://plain.example/path",
        );
        expect(model.hyperlinkAtViewportCell(0, 1)).toBeNull();
        expect(model.grapheme(0, 0)).toBe("s");
        expect(model.readCellLine(1).slice(0, 6).join("")).toBe("second");
        expect(model.wordRangeAt({ line: 1, column: 2 })).toEqual({
          start: 0,
          end: 5,
        });
        expect(model.lineEndColumn(1)).toBe(5);
        expect(
          model.selectionText({
            anchor: { line: 0, column: 0 },
            focus: { line: 0, column: 3 },
            rectangular: false,
          }),
        ).toBe("see");
        expect(model.renderFormat()).toBe("gpu");
        const frame = model.consumeGpuFrame();
        expect(frame.damage).toEqual({ kind: "none" });
        expect(frame.dirtyRanges).toEqual([]);
      } finally {
        model.dispose();
      }
    });

    it("switches formats on demand and forces full damage each way", () => {
      const { model, write } = create(20, 4);
      try {
        write("switch me");
        expect(model.renderCells().codepoint(0)).toBe("s".codePointAt(0));
        expect(model.renderFormat()).toBe("soa");
        const gpuFrame = model.consumeGpuFrame();
        expect(model.renderFormat()).toBe("gpu");
        expect(gpuFrame.fullDamage).toBe(true);
        expect(gpuFrame.newGlyphs.length).toBeGreaterThan(0);
        expect(model.renderCells().codepoint(7)).toBe("m".codePointAt(0));
        expect(model.renderFormat()).toBe("soa");
        expect(model.consumeDamage()).toEqual({ kind: "full" });
        const again = model.consumeGpuFrame();
        expect(again.fullDamage).toBe(true);
        expect(again.epoch).not.toBe(gpuFrame.epoch);
        expect(again.newGlyphs.map((glyph) => glyph.text).join("")).toBe(
          gpuFrame.newGlyphs.map((glyph) => glyph.text).join(""),
        );
      } finally {
        model.dispose();
      }
    });

    it("resynchronizes a new consumer with the full glyph table and every row", () => {
      const { model, write } = create(20, 4);
      try {
        write("abc");
        const first = model.consumeGpuFrame();
        write("\r\ndef");
        const second = model.consumeGpuFrame();
        expect(second.newGlyphs.map((glyph) => glyph.text)).toEqual([
          "d",
          "e",
          "f",
        ]);
        const resync = model.consumeGpuFrame({ resync: true });
        expect(resync.fullDamage).toBe(true);
        expect(resync.dirtyRanges).toEqual([{ start: 0, end: 3 }]);
        expect(resync.epoch).toBe(first.epoch);
        expect(resync.newGlyphs.map((glyph) => glyph.text)).toEqual([
          "a",
          "b",
          "c",
          "d",
          "e",
          "f",
        ]);
        expect(model.consumeGpuFrame().newGlyphs).toEqual([]);
      } finally {
        model.dispose();
      }
    });

    it.each(["release", "compact"] as const)(
      "restores the same content with full damage and a new epoch after %s",
      (operation) => {
        const { model, write, reader, frame: consume } = create(30, 5);
        try {
          write("\x1b[1mbold\x1b[0m text\r\nsecond row");
          const before = consume();
          const textBefore = [0, 1].map((row) => reader.rowText(before, row));
          if (operation === "release") model.releasePresentationResources();
          else model.compactPresentationResources();
          write("!"); // hidden/compacted output must not rebuild presentation by itself
          if (operation === "release") {
            expect(model.diagnostics().bridgeCellCapacity).toBe(0);
          }
          const after = consume();
          expect(after.fullDamage).toBe(true);
          expect(after.dirtyRanges).toEqual([{ start: 0, end: 4 }]);
          // A small glyph table survives compaction (ids stay valid); release frees it.
          if (operation === "release") {
            expect(after.epoch).not.toBe(before.epoch);
          } else {
            expect(after.epoch).toBe(before.epoch);
            expect(after.newGlyphs.map((glyph) => glyph.text)).toEqual(["!"]);
          }
          expect(textBefore).toEqual(["bold text", "second row"]);
          expect([0, 1].map((row) => reader.rowText(after, row))).toEqual([
            "bold text",
            "second row!",
          ]);
          expect(model.diagnostics().bridgeCellCapacity).toBeGreaterThan(0);
        } finally {
          model.dispose();
        }
      },
    );

    it("drops an oversized glyph table on compaction by starting a new epoch", () => {
      const { model, write, reader, frame: consume } = create(80, 30);
      try {
        for (let screen = 0; screen < 2; screen += 1) {
          let text = "\x1b[H";
          for (let index = 0; index < 80 * 30; index += 1) {
            text += String.fromCodePoint(0xf0000 + screen * 2400 + index);
          }
          write(text);
          consume();
        }
        const before = consume({ resync: true });
        expect(before.glyphCount).toBeGreaterThan(2048);
        model.compactPresentationResources();
        const after = consume();
        expect(after.epoch).not.toBe(before.epoch);
        expect(after.fullDamage).toBe(true);
        expect(after.glyphCount).toBe(2400);
        expect(after.newGlyphs).toHaveLength(2400);
        expect(reader.rowText(after, 0).codePointAt(0)).toBe(0xf0000 + 2400);
      } finally {
        model.dispose();
      }
    });

    it("survives WASM memory growth between update and frame", () => {
      const { model, write, reader, frame: consume } = create(40, 6);
      try {
        write("persistent");
        const first = consume();
        write("\r\nmore text");
        model.cursor(); // forces the update while views are fresh
        const before = first.memory.buffer.byteLength;
        // Grow linear memory (detaching every earlier ArrayBuffer).
        first.memory.grow(1024);
        expect(first.memory.buffer.byteLength).toBeGreaterThan(before);
        const frame = consume();
        expect(frame.cells.byteLength).toBe(40 * 6 * GPU_CELL_BYTES);
        expect(frame.cells.buffer).toBe(frame.memory.buffer);
        expect(reader.rowText(frame, 1)).toBe("more text");
        expect(frame.dirtyRanges).toEqual([{ start: 1, end: 1 }]);
        expect(frame.newGlyphs.map((glyph) => glyph.text).join("")).toBe("mox");
      } finally {
        model.dispose();
      }
    });
  },
);
