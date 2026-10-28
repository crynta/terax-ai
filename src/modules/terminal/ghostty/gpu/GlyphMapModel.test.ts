import { readFile } from "node:fs/promises";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { beforeAll, describe, expect, it } from "vitest";
import { AdaptedGhosttyTerminalModel } from "../AdaptedGhosttyTerminalModel";
import type { GhosttyGpuFrame } from "../GhosttyTerminalModel";
import {
  GLYPH_EVICTED,
  TerminalGlyphMap,
  type GlyphResolver,
} from "./GlyphMap";

const encoder = new TextEncoder();

class TextAtlas implements GlyphResolver {
  epoch = 1;
  readonly texts: string[] = [];
  private readonly indices = new Map<string, number>();

  resolve(text: string, style: number): number {
    const key = `${style}:${text}`;
    let index = this.indices.get(key);
    if (index === undefined) {
      index = this.texts.length;
      this.texts.push(text);
      this.indices.set(key, index);
    }
    return index;
  }

  flush(): void {
    this.indices.clear();
    this.texts.length = 0;
    this.epoch += 1;
  }
}

const budget = { exhausted: () => false };

describe.each(["ghostty-vt", "ghostty-vt-scalar"])(
  "glyph map driven by the real Ghostty model (%s)",
  (artifact) => {
    let core: TeraxGhostty;

    beforeAll(async () => {
      const file = await readFile(
        new URL(
          `../../../../../packages/ghostty-core/adapted/${artifact}.wasm`,
          import.meta.url,
        ),
      );
      core = await TeraxGhostty.loadBytes(Uint8Array.from(file).buffer);
    });

    function consumer(cols = 24, rows = 6) {
      const model = new AdaptedGhosttyTerminalModel(core, {
        backend: "ghostty-webgpu",
        cols,
        rows,
      });
      const map = new TerminalGlyphMap();
      const atlas = new TextAtlas();
      let first = true;
      /** One pass of the surface's consumer loop (without GPU calls). */
      function frame(resync = false): GhosttyGpuFrame {
        const stale = map.atlasEpoch !== atlas.epoch;
        const next = model.consumeGpuFrame({
          resync: first || resync || stale,
        });
        map.ensureCapacity(next.glyphCount);
        if (next.epoch !== map.zigEpoch) {
          map.resetForEpoch(next.epoch);
          map.adoptAtlasEpoch(atlas.epoch);
        } else if (stale) {
          map.invalidateAtlas(atlas.epoch);
        }
        map.add(next.newGlyphs);
        if (map.recovering) {
          map.scanCells(
            next.cells,
            next.cols,
            first || resync || stale
              ? [{ start: 0, end: next.rows - 1 }]
              : next.dirtyRanges,
          );
        }
        map.process(atlas, budget);
        first = false;
        return next;
      }
      /** What the GPU would draw for a row, reconstructed through the map. */
      function drawn(next: GhosttyGpuFrame, row: number): string {
        const words = new Uint32Array(
          next.cells.buffer,
          next.cells.byteOffset,
          next.cells.byteLength / 4,
        );
        let text = "";
        for (let column = 0; column < next.cols; column += 1) {
          const id = words[(row * next.cols + column) * 4] & 0xffffff;
          if (id === 0) {
            text += " ";
            continue;
          }
          const index = map.entries[id];
          text += index >= GLYPH_EVICTED ? "?" : atlas.texts[index];
        }
        return text.trimEnd();
      }
      return {
        model,
        map,
        atlas,
        frame,
        drawn,
        write: (text: string) => model.write(encoder.encode(text)),
      };
    }

    it("maps every visible glyph on the first frame and only new ones afterwards", () => {
      const c = consumer();
      try {
        c.write("hello \x1b[1mbold\x1b[0m wide: 日本");
        const first = c.frame();
        // The trailing half of a wide glyph draws nothing.
        expect(c.drawn(first, 0)).toBe("hello bold wide: 日 本");
        const before = c.atlas.texts.length;
        c.write("\r\nhello again");
        const second = c.frame();
        expect(c.drawn(second, 1)).toBe("hello again");
        // Only 'a', 'g' and 'n' are new; the rest exist in this style already.
        expect(c.atlas.texts.length - before).toBe(3);
        expect(c.map.pending).toBe(0);
      } finally {
        c.model.dispose();
      }
    });

    it("rebuilds an identical map for a new surface with resync", () => {
      const c = consumer();
      const fresh = consumer();
      try {
        const text = "abc \x1b[3mitalic\x1b[0m é 😀";
        c.write(text);
        fresh.write(text);
        const frame = c.frame();
        const resynced = fresh.frame(true);
        expect(fresh.drawn(resynced, 0)).toBe(c.drawn(frame, 0));
        expect(fresh.drawn(resynced, 0)).toBe("abc italic é 😀");
      } finally {
        c.model.dispose();
        fresh.model.dispose();
      }
    });

    it("recovers every visible glyph after an atlas flush", () => {
      const c = consumer();
      try {
        c.write("one two\r\nthree 日本\r\nfour");
        const first = c.frame();
        const rows = [0, 1, 2].map((row) => c.drawn(first, row));
        expect(rows).toEqual(["one two", "three 日 本", "four"]);

        c.atlas.flush();
        const recovered = c.frame();
        expect([0, 1, 2].map((row) => c.drawn(recovered, row))).toEqual(rows);
        expect(c.map.pending).toBe(0);
      } finally {
        c.model.dispose();
      }
    });

    it("restores an evicted glyph that reappears only through a dirty row", () => {
      const c = consumer(24, 4);
      try {
        // 'z' is interned, then scrolls off the visible rows.
        c.write("zzz\r\n");
        c.frame();
        c.write("\x1b[2J\x1b[Hkept");
        const shown = c.frame();
        expect(c.drawn(shown, 0)).toBe("kept");

        c.atlas.flush();
        const after = c.frame();
        expect(c.drawn(after, 0)).toBe("kept");
        // 'z' was not visible, so it stays evicted and costs nothing.
        expect(c.map.recovering).toBe(true);

        // Printing 'z' again re-uses the interned id (no announcement); the
        // dirty row alone must bring it back.
        c.write("\r\nzz");
        const again = c.frame();
        expect(c.drawn(again, 1)).toBe("zz");
        expect(c.map.pending).toBe(0);
      } finally {
        c.model.dispose();
      }
    });

    it("starts from scratch when the model starts a new glyph epoch", () => {
      const c = consumer(80, 4);
      try {
        const epoch = c.frame().epoch;
        // Interning more distinct glyphs than the bridge table holds forces a reset.
        let seed = 0;
        for (let batch = 0; batch < 200; batch += 1) {
          let line = "";
          for (let index = 0; index < 150; index += 1) {
            line += String.fromCodePoint(0x4e00 + seed++);
          }
          c.write(`\x1b[H${line}`);
          c.frame();
          if (c.map.zigEpoch !== epoch) break;
        }
        expect(c.map.zigEpoch).toBeGreaterThan(epoch);
        const last = c.frame(true);
        expect(c.map.pending).toBe(0);
        expect(c.drawn(last, 0).length).toBeGreaterThan(0);
        expect(c.drawn(last, 0)).not.toContain("?");
      } finally {
        c.model.dispose();
      }
    });
  },
);
