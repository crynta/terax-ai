import { readFile } from "node:fs/promises";
import {
  ADAPTED_GHOSTTY_SCALAR_WASM_SHA256,
  ADAPTED_GHOSTTY_WASM_SHA256,
  GPU_ATTR_BLINK,
  GPU_ATTR_OVERLINE,
  GPU_ATTR_SHIFT,
  GPU_ATTR_STRIKETHROUGH,
  GPU_ATTR_UNDERLINE_MASK,
  GPU_ATTR_WIDE_LEAD,
  GPU_CELL_BYTES,
  GPU_GLYPH_BOLD,
  GPU_GLYPH_ID_MASK,
  GPU_GLYPH_ITALIC,
  TeraxGhostty,
  decodeGpuCell,
  type TeraxGhosttyGpuCell,
  type TeraxGhosttyGpuGlyph,
  type TeraxGhosttyGpuRenderState,
  type TeraxGhosttyRenderState,
  type TeraxGhosttyTerminal,
} from "@terax/ghostty-core/adapted";
import { beforeAll, describe, expect, it } from "vitest";

const MAX_GLYPHS = 16 * 1024;
const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);

const ZWJ = String.fromCodePoint(0x200d);
const ACUTE = String.fromCodePoint(0x0301);
const E_COMBINED = `e${ACUTE}`;
const E_PRECOMPOSED = String.fromCodePoint(0xe9);
const FAMILY = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`;
const COUPLE = `\u{1F468}${ZWJ}\u{1F469}`;

/** Consumer-side glyph id map, exactly as a renderer must maintain it. */
class GlyphMap {
  epoch = 0;
  epochChanges = 0;
  readonly glyphs = new Map<number, TeraxGhosttyGpuGlyph>();

  apply(terminal: TeraxGhosttyTerminal, state: TeraxGhosttyGpuRenderState) {
    if (state.epoch !== this.epoch) {
      this.glyphs.clear();
      this.epoch = state.epoch;
      this.epochChanges += 1;
    }
    for (const glyph of state.newGlyphs) this.glyphs.set(glyph.id, glyph);
    terminal.acknowledgeGpuGlyphs();
  }

  /** Rebuild from the full table (a consumer that missed deltas). */
  resync(terminal: TeraxGhosttyTerminal, state: TeraxGhosttyGpuRenderState) {
    this.glyphs.clear();
    this.epoch = state.epoch;
    for (const glyph of terminal.gpuGlyphTable())
      this.glyphs.set(glyph.id, glyph);
  }

  text(id: number): string | null {
    if (id === 0) return null;
    const glyph = this.glyphs.get(id);
    if (!glyph) throw new Error(`Unknown glyph id ${id}`);
    return glyph.text;
  }

  style(id: number): number {
    return this.glyphs.get(id)?.style ?? 0;
  }
}

type Snapshot = {
  readonly state: TeraxGhosttyGpuRenderState;
  readonly dirty: number[];
  readonly fullDamage: boolean;
  readonly anyDirty: boolean;
  readonly words: Uint32Array;
};

class GpuHarness {
  readonly map = new GlyphMap();

  constructor(readonly terminal: TeraxGhosttyTerminal) {
    terminal.setRenderFormat("gpu");
  }

  write(text: string | Uint8Array) {
    this.terminal.write(typeof text === "string" ? bytes(text) : text);
  }

  update(): Snapshot {
    const state = this.terminal.updateGpuRenderState();
    this.map.apply(this.terminal, state);
    return {
      state,
      dirty: Array.from(state.dirtyRows),
      fullDamage: state.fullDamage,
      anyDirty: state.anyDirty,
      words: state.cellWords.slice(),
    };
  }

  cell(snapshot: Snapshot, row: number, column: number): TeraxGhosttyGpuCell {
    return decodeGpuCell(snapshot.words, row * snapshot.state.cols + column);
  }

  text(snapshot: Snapshot, row: number, column: number): string | null {
    return this.map.text(this.cell(snapshot, row, column).glyphId);
  }

  rowText(snapshot: Snapshot, row: number): string {
    let result = "";
    for (let column = 0; column < snapshot.state.cols; column += 1) {
      result += this.text(snapshot, row, column) ?? " ";
    }
    return result;
  }
}

function dirtyRowIndexes(snapshot: Snapshot): number[] {
  return snapshot.dirty.flatMap((flag, row) => (flag ? [row] : []));
}

const rgba = (r: number, g: number, b: number, a = 255) => [r, g, b, a];

function rendererWidth(width: number) {
  if (width === 1) return 2;
  if (width === 2 || width === 3) return 0;
  return 1;
}

/**
 * What `WebGpuTerminalSurface.buildRows` derives from the structure-of-arrays
 * state for one cell. The GPU records must agree with this exactly.
 */
type ExpectedCell = {
  readonly width: number;
  readonly text: string | null;
  readonly glyphStyle: number;
  readonly fg: number[];
  readonly bg: number[];
  readonly ul: number[];
  readonly underlineStyle: number;
  readonly strikethrough: boolean;
  readonly overline: boolean;
  readonly blink: boolean;
};

function expectedFromSoa(
  terminal: TeraxGhosttyTerminal,
  state: TeraxGhosttyRenderState,
  index: number,
): ExpectedCell {
  const style = state.styleFlags[index];
  const inverse = (style & (1 << 4)) !== 0;
  const faint = (style & (1 << 2)) !== 0;
  const invisible = (style & (1 << 5)) !== 0;
  const offset = index * 4;
  let fg = [
    state.foregroundRgba[offset],
    state.foregroundRgba[offset + 1],
    state.foregroundRgba[offset + 2],
  ];
  let bg = [
    state.backgroundRgba[offset],
    state.backgroundRgba[offset + 1],
    state.backgroundRgba[offset + 2],
  ];
  if (inverse) [fg, bg] = [bg, fg];
  const codepoint = state.codepoints[index];
  const drawn = codepoint !== 0 && codepoint !== 32 && !invisible;
  return {
    width: rendererWidth(state.widths[index]),
    text: drawn
      ? state.graphemeLengths[index] > 0
        ? terminal.graphemeAt(state, index)
        : String.fromCodePoint(codepoint)
      : null,
    glyphStyle:
      (style & 1 ? GPU_GLYPH_BOLD : 0) | (style & 2 ? GPU_GLYPH_ITALIC : 0),
    fg: [...fg, faint ? 128 : 255],
    bg: [...bg, 255],
    ul: [
      state.underlineRgba[offset],
      state.underlineRgba[offset + 1],
      state.underlineRgba[offset + 2],
      255,
    ],
    underlineStyle: state.underlineStyles[index],
    strikethrough: (style & (1 << 6)) !== 0,
    overline: (style & (1 << 7)) !== 0,
    blink: (style & (1 << 3)) !== 0,
  };
}

/**
 * Compares every cell of a GPU snapshot against the SoA terminal fed the same
 * bytes. Mismatches are collected (not asserted per cell) so large randomized
 * runs stay fast; the first few are reported on failure.
 */
function expectRecordsMatchSoa(
  harness: GpuHarness,
  snapshot: Snapshot,
  soa: TeraxGhosttyTerminal,
  soaState: TeraxGhosttyRenderState,
  defaults = { fg: rgba(255, 255, 255), bg: rgba(0, 0, 0) },
) {
  const { rows, cols } = snapshot.state;
  expect(soaState.rows).toBe(rows);
  expect(soaState.cols).toBe(cols);
  const problems: string[] = [];
  const same = (
    actual: unknown,
    expected: unknown,
    what: string,
    where: string,
  ) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(
        `${where} ${what}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
      );
    }
  };
  let blinking = 0;
  for (let row = 0; row < rows; row += 1) {
    let lead: TeraxGhosttyGpuCell | null = null;
    for (let column = 0; column < cols; column += 1) {
      const index = row * cols + column;
      const expected = expectedFromSoa(soa, soaState, index);
      const actual = harness.cell(snapshot, row, column);
      const where = `cell ${row},${column}`;
      if (expected.width === 0) {
        same(actual.glyphId, 0, "glyph", where);
        same(actual.wideLead, false, "wideLead", where);
        same(actual.blink, false, "blink", where);
        if (soaState.widths[index] === 2 && lead) {
          // Spacer tail: covers the lead's span with its colors and decorations.
          same(actual.background, lead.background, "tail background", where);
          same(actual.foreground, lead.foreground, "tail foreground", where);
          same(actual.underline, lead.underline, "tail underline color", where);
          same(
            actual.underlineStyle,
            lead.underlineStyle,
            "tail underline",
            where,
          );
          same(actual.strikethrough, lead.strikethrough, "tail strike", where);
          same(actual.overline, lead.overline, "tail overline", where);
        } else if (soaState.widths[index] === 3) {
          same(actual.background, defaults.bg, "head background", where);
          same(actual.foreground, defaults.fg, "head foreground", where);
          same(actual.underlineStyle, 0, "head underline", where);
        }
        lead = null;
        continue;
      }
      same(harness.map.text(actual.glyphId), expected.text, "text", where);
      if (expected.text !== null) {
        same(
          harness.map.style(actual.glyphId),
          expected.glyphStyle,
          "glyph style",
          where,
        );
      }
      same([...actual.foreground], expected.fg, "foreground", where);
      same([...actual.background], expected.bg, "background", where);
      same([...actual.underline], expected.ul, "underline color", where);
      same(
        actual.underlineStyle,
        expected.underlineStyle,
        "underline style",
        where,
      );
      same(
        actual.strikethrough,
        expected.strikethrough,
        "strikethrough",
        where,
      );
      same(actual.overline, expected.overline, "overline", where);
      same(actual.blink, expected.blink, "blink", where);
      same(actual.wideLead, expected.width === 2, "wideLead", where);
      if (expected.blink && expected.text !== null) blinking += 1;
      lead = expected.width === 2 ? actual : null;
    }
  }
  same(snapshot.state.blinkingCells, blinking, "blinkingCells", "viewport");
  expect(problems.slice(0, 5)).toEqual([]);
}

describe.each([
  ["SIMD", "ghostty-vt.wasm", ADAPTED_GHOSTTY_WASM_SHA256],
  ["scalar", "ghostty-vt-scalar.wasm", ADAPTED_GHOSTTY_SCALAR_WASM_SHA256],
])("%s Ghostty GPU cell records", (_kind, artifact, _checksum) => {
  let wasmBytes: ArrayBuffer;
  let ghostty: TeraxGhostty;

  beforeAll(async () => {
    const file = await readFile(
      new URL(
        `../../../../packages/ghostty-core/adapted/${artifact}`,
        import.meta.url,
      ),
    );
    wasmBytes = Uint8Array.from(file).buffer;
    ghostty = await TeraxGhostty.loadBytes(wasmBytes.slice(0));
  });

  function gpu(cols: number, rows: number) {
    return new GpuHarness(
      ghostty.createTerminal(cols, rows, { maxScrollbackLines: 1000 }),
    );
  }

  function pair(cols: number, rows: number) {
    const harness = gpu(cols, rows);
    const soa = ghostty.createTerminal(cols, rows, {
      maxScrollbackLines: 1000,
    });
    return {
      harness,
      soa,
      write(text: string) {
        harness.write(text);
        soa.write(bytes(text));
      },
      compare(defaults?: { fg: number[]; bg: number[] }) {
        const snapshot = harness.update();
        const soaState = soa.updateRenderState();
        expectRecordsMatchSoa(harness, snapshot, soa, soaState, defaults);
        return snapshot;
      },
      dispose() {
        harness.terminal.dispose();
        soa.dispose();
      },
    };
  }

  describe("record layout", () => {
    it("is 16 bytes per cell, row-major, with the documented plain-text encoding", () => {
      const harness = gpu(8, 3);
      try {
        harness.write("Hi hi");
        const snapshot = harness.update();
        const { state } = snapshot;
        expect(state.cellsBytes.byteLength).toBe(8 * 3 * GPU_CELL_BYTES);
        expect(state.cellWords.byteLength).toBe(8 * 3 * GPU_CELL_BYTES);
        expect(state.cellsBytes.buffer).toBe(
          harness.terminal.wasmMemory.buffer,
        );
        expect(state.cellsBytes.byteOffset).toBe(state.cellsPtr);
        expect(state.cellsPtr % 8).toBe(0);

        // Ids are dense from 1 in order of first appearance; case matters.
        const ids = [0, 1, 2, 3, 4, 5].map(
          (column) => harness.cell(snapshot, 0, column).glyphId,
        );
        expect(ids[0]).toBe(1); // H
        expect(ids[1]).toBe(2); // i
        expect(ids[2]).toBe(0); // space draws nothing
        expect(ids[3]).toBe(3); // h
        expect(ids[4]).toBe(2); // i again: same id
        expect(ids[5]).toBe(0); // unwritten cell
        expect(state.glyphCount).toBe(3);
        expect(harness.update().state.newGlyphs.isEmpty).toBe(true); // acknowledged

        const first = harness.cell(snapshot, 0, 0);
        expect(first).toMatchObject({
          underlineStyle: 0,
          strikethrough: false,
          overline: false,
          blink: false,
          wideLead: false,
        });
        expect([...first.foreground]).toEqual(rgba(255, 255, 255));
        expect([...first.background]).toEqual(rgba(0, 0, 0));
        expect([...first.underline]).toEqual(rgba(255, 255, 255));

        // The word is little-endian [r, g, b, a], i.e. WGSL unpack4x8unorm order.
        const view = new DataView(
          state.cellsBytes.buffer,
          state.cellsBytes.byteOffset,
          state.cellsBytes.byteLength,
        );
        expect(view.getUint32(0, true) & GPU_GLYPH_ID_MASK).toBe(1);
        expect(state.cellsBytes.slice(4, 8)).toEqual(
          Uint8Array.of(255, 255, 255, 255),
        );
        expect(state.cellsBytes.slice(8, 12)).toEqual(
          Uint8Array.of(0, 0, 0, 255),
        );
        expect(view.getUint32(0, true) >>> GPU_ATTR_SHIFT).toBe(0);
        expect(state.cellsBytes[3]).toBe(0);
      } finally {
        harness.terminal.dispose();
      }
    });

    it("delivers new glyphs as id, style and text, then acknowledges them", () => {
      const harness = gpu(10, 2);
      try {
        harness.write(`a\x1b[1mb\x1b[3mc\x1b[0m${E_COMBINED}`);
        const state = harness.terminal.updateGpuRenderState();
        expect(
          Array.from(state.newGlyphs).map((g) => [g.id, g.style, g.text]),
        ).toEqual([
          [1, 0, "a"],
          [2, GPU_GLYPH_BOLD, "b"],
          [3, GPU_GLYPH_BOLD | GPU_GLYPH_ITALIC, "c"],
          [4, 0, E_COMBINED],
        ]);
        // Unacknowledged glyphs accumulate across updates instead of being lost.
        harness.write("z");
        const second = harness.terminal.updateGpuRenderState();
        expect(second.newGlyphs.toArray().map((g) => g.text)).toEqual([
          "a",
          "b",
          "c",
          E_COMBINED,
          "z",
        ]);
        expect(second.newGlyphs.words.length).toBe(3 * 4 + 5 + 4); // headers + codepoints
        harness.terminal.acknowledgeGpuGlyphs();
        expect(harness.terminal.updateGpuRenderState().newGlyphs.isEmpty).toBe(
          true,
        );
        // The full table stays available for a consumer that lost its map.
        expect(
          harness.terminal
            .gpuGlyphTable()
            .toArray()
            .map((g) => g.id),
        ).toEqual([1, 2, 3, 4, 5]);
      } finally {
        harness.terminal.dispose();
      }
    });
  });

  describe("equivalence with the structure-of-arrays renderer", () => {
    it("matches palette, truecolor and default colors with inverse, faint and invisible", () => {
      const p = pair(40, 6);
      try {
        p.write(
          "plain \x1b[31mred\x1b[0m \x1b[38;5;208morange\x1b[0m \x1b[38;2;12;34;56mrgb\x1b[0m\r\n",
        );
        p.write(
          "\x1b[48;5;236m bgpal \x1b[0m\x1b[48;2;200;100;50m bgrgb \x1b[0m\r\n",
        );
        p.write(
          "\x1b[7minverse\x1b[0m \x1b[7;31;44mi-colors\x1b[0m \x1b[2mfaint\x1b[0m \x1b[8mhidden\x1b[0m\r\n",
        );
        p.write(
          "\x1b[1mbold\x1b[0m \x1b[3mitalic\x1b[0m \x1b[1;3mboth\x1b[0m \x1b[1;31mboldred\x1b[0m\r\n",
        );
        p.write(
          "\x1b[38;2;10;20;30;48;2;200;100;50m\x1b[7;2mfaint-inverse\x1b[0m\r\n",
        );
        const snapshot = p.compare();
        const inverse = p.harness.cell(snapshot, 0, 0);
        expect(inverse.glyphId).not.toBe(0);

        // Concrete spot checks of the encoding rules.
        const row4 = 4;
        const cell = p.harness.cell(snapshot, row4, 0);
        expect([...cell.foreground]).toEqual(rgba(200, 100, 50, 128)); // inverse + faint
        expect([...cell.background]).toEqual(rgba(10, 20, 30));
        expect([...cell.underline]).toEqual(rgba(200, 100, 50)); // displayed foreground
      } finally {
        p.dispose();
      }
    });

    it("encodes inverse, faint and invisible cells as specified", () => {
      const harness = gpu(12, 2);
      try {
        harness.write(
          "\x1b[38;2;1;2;3;48;2;4;5;6mA\x1b[7mB\x1b[27;2mC\x1b[22;8mD\x1b[0mE",
        );
        const snapshot = harness.update();
        const cells = [0, 1, 2, 3, 4].map((column) =>
          harness.cell(snapshot, 0, column),
        );
        expect([...cells[0].foreground]).toEqual(rgba(1, 2, 3));
        expect([...cells[0].background]).toEqual(rgba(4, 5, 6));
        expect([...cells[1].foreground]).toEqual(rgba(4, 5, 6)); // inverse swap
        expect([...cells[1].background]).toEqual(rgba(1, 2, 3));
        expect([...cells[2].foreground]).toEqual(rgba(1, 2, 3, 128)); // faint is alpha 128
        expect([...cells[2].background]).toEqual(rgba(4, 5, 6));
        expect(cells[3].glyphId).toBe(0); // invisible: no glyph...
        expect([...cells[3].background]).toEqual(rgba(4, 5, 6)); // ...but the background stays
        expect(harness.text(snapshot, 0, 4)).toBe("E");
        expect([...cells[4].foreground]).toEqual(rgba(255, 255, 255));
      } finally {
        harness.terminal.dispose();
      }
    });

    it("keys glyphs on bold and italic only", () => {
      const harness = gpu(20, 2);
      try {
        harness.write("a\x1b[1ma\x1b[3ma\x1b[22ma\x1b[0m\x1b[2;31;4ma\x1b[0ma");
        const snapshot = harness.update();
        const id = (column: number) =>
          harness.cell(snapshot, 0, column).glyphId;
        // normal, bold+italic, italic... build the expected table explicitly.
        expect(new Set([id(0), id(1), id(2), id(3)]).size).toBe(4);
        expect(harness.map.style(id(0))).toBe(0);
        expect(harness.map.style(id(1))).toBe(GPU_GLYPH_BOLD);
        expect(harness.map.style(id(2))).toBe(
          GPU_GLYPH_BOLD | GPU_GLYPH_ITALIC,
        );
        expect(harness.map.style(id(3))).toBe(GPU_GLYPH_ITALIC);
        // Color, faint and underline never create new glyphs.
        expect(id(4)).toBe(id(0));
        expect(id(5)).toBe(id(0));
        expect(snapshot.state.glyphCount).toBe(4);
      } finally {
        harness.terminal.dispose();
      }
    });

    it("encodes underline styles and colors, strikethrough, overline and blink", () => {
      const p = pair(30, 4);
      try {
        // Columns: 0-4 styles 1..5, 5 plain, 6 colored (rgb), 7 colored
        // (palette 196), 8 plain, 9 strike, 10 overline, 11 blink, 12 mixed.
        p.write("\x1b[4ms\x1b[4:2md\x1b[4:3mc\x1b[4:4mt\x1b[4:5mh\x1b[24m|");
        p.write(
          "\x1b[4;58;2;9;8;7mu\x1b[58;5;196mp\x1b[59m\x1b[0m|\x1b[9mx\x1b[0m\x1b[53mo\x1b[0m\x1b[5mb\x1b[9;53;4m!\x1b[0m",
        );
        const snapshot = p.compare();
        const styles = [0, 1, 2, 3, 4].map(
          (column) => p.harness.cell(snapshot, 0, column).underlineStyle,
        );
        expect(styles).toEqual([1, 2, 3, 4, 5]);
        expect(p.harness.cell(snapshot, 0, 5).underlineStyle).toBe(0);
        expect(GPU_ATTR_UNDERLINE_MASK).toBe(7);
        expect([...p.harness.cell(snapshot, 0, 6).underline]).toEqual(
          rgba(9, 8, 7),
        );
        expect([...p.harness.cell(snapshot, 0, 7).underline]).toEqual(
          rgba(255, 0, 0),
        );
        // No underline color: the displayed foreground is used.
        expect([...p.harness.cell(snapshot, 0, 8).underline]).toEqual(
          rgba(255, 255, 255),
        );
        expect(p.harness.cell(snapshot, 0, 9)).toMatchObject({
          strikethrough: true,
          overline: false,
        });
        expect(p.harness.cell(snapshot, 0, 10)).toMatchObject({
          overline: true,
          strikethrough: false,
        });
        expect(p.harness.cell(snapshot, 0, 11)).toMatchObject({ blink: true });
        const word = snapshot.words[12 * 4] >>> GPU_ATTR_SHIFT;
        expect(word & GPU_ATTR_STRIKETHROUGH).not.toBe(0);
        expect(word & GPU_ATTR_OVERLINE).not.toBe(0);
        expect(word & GPU_ATTR_UNDERLINE_MASK).toBe(1);
        expect(word & GPU_ATTR_BLINK).not.toBe(0); // SGR 5 is still active
        expect(word & GPU_ATTR_WIDE_LEAD).toBe(0);
        expect(word & 0x80).toBe(0); // bit 31 stays reserved
      } finally {
        p.dispose();
      }
    });

    it("counts only visible blinking glyphs and keeps the count current across partial updates", () => {
      const harness = gpu(20, 6);
      try {
        harness.write("\x1b[5mab\x1b[0m \x1b[5m \x1b[0mc");
        expect(harness.update().state.blinkingCells).toBe(2); // blinking space has no glyph
        harness.write("\x1b[3;1H\x1b[5mxyz\x1b[0m");
        expect(harness.update().state.blinkingCells).toBe(5);
        harness.write("\x1b[1;1H\x1b[2K"); // erase the first blinking row only
        expect(harness.update().state.blinkingCells).toBe(3);
        harness.write("\x1b[3;1H\x1b[8m\x1b[5mxyz\x1b[0m"); // hidden blink text does not count
        expect(harness.update().state.blinkingCells).toBe(0);
        harness.write("\x1b[3;1H\x1b[5mxy\x1b[0m");
        expect(harness.update().state.blinkingCells).toBe(2);
        harness.write("\x1b[2J");
        expect(harness.update().state.blinkingCells).toBe(0);
      } finally {
        harness.terminal.dispose();
      }
    });

    it("encodes wide characters: lead owns the glyph, tail draws nothing but covers the span", () => {
      const p = pair(12, 3);
      try {
        p.write("a日\x1b[4;31mb本\x1b[0m本c");
        const snapshot = p.compare();
        const lead = p.harness.cell(snapshot, 0, 1);
        const tail = p.harness.cell(snapshot, 0, 2);
        expect(lead.glyphId).not.toBe(0);
        expect(lead.wideLead).toBe(true);
        expect(tail.glyphId).toBe(0);
        expect(tail.wideLead).toBe(false);
        expect(p.harness.text(snapshot, 0, 1)).toBe("日");
        // Underlined red wide char: the tail repeats colors and decoration.
        const wide = p.harness.cell(snapshot, 0, 4);
        const wideTail = p.harness.cell(snapshot, 0, 5);
        expect(wide.underlineStyle).toBe(1);
        expect(wideTail.underlineStyle).toBe(1);
        expect(wideTail.foreground).toEqual(wide.foreground);
        // Same wide glyph used twice interns once.
        expect(p.harness.cell(snapshot, 0, 4).glyphId).toBe(
          p.harness.cell(snapshot, 0, 6).glyphId,
        );
      } finally {
        p.dispose();
      }
    });

    it("draws a spacer head as an empty default cell", () => {
      const p = pair(5, 3);
      try {
        // A wide character that does not fit in the last column wraps and
        // leaves a spacer head behind.
        p.write("abcd日e");
        const snapshot = p.compare();
        const head = p.harness.cell(snapshot, 0, 4);
        expect(head.glyphId).toBe(0);
        expect([...head.background]).toEqual(rgba(0, 0, 0));
        expect(p.harness.text(snapshot, 1, 0)).toBe("日");
      } finally {
        p.dispose();
      }
    });

    it("interns graphemes by content, not by position", () => {
      const harness = gpu(20, 3);
      try {
        const family = FAMILY;
        const flag = "\u{1F1EF}\u{1F1F5}";
        harness.write(
          `\x1b[?2027h${family}x${family}\r\n${E_COMBINED} ${E_COMBINED}${E_PRECOMPOSED}${flag}\x1b[1m${family}`,
        );
        const snapshot = harness.update();
        const texts = (row: number) =>
          Array.from({ length: 20 }, (_, column) =>
            harness.text(snapshot, row, column),
          );
        const familyColumns = texts(0).flatMap((text, column) =>
          text === family ? [column] : [],
        );
        expect(familyColumns).toHaveLength(2);
        expect(harness.cell(snapshot, 0, familyColumns[0]).glyphId).toBe(
          harness.cell(snapshot, 0, familyColumns[1]).glyphId,
        );
        expect(harness.cell(snapshot, 0, familyColumns[0]).wideLead).toBe(true);
        // Combining mark: same content, same id; precomposed e-acute is a different glyph.
        expect(harness.text(snapshot, 1, 0)).toBe(E_COMBINED);
        const combiningId = harness.cell(snapshot, 1, 0).glyphId;
        expect(harness.cell(snapshot, 1, 2).glyphId).toBe(combiningId);
        expect(harness.text(snapshot, 1, 3)).toBe(E_PRECOMPOSED);
        expect(harness.cell(snapshot, 1, 3).glyphId).not.toBe(combiningId);
        expect(texts(1)).toContain(flag);
        // Bold family is a distinct glyph with the same text.
        const familyGlyphs = Array.from(harness.map.glyphs.values()).filter(
          (glyph) => glyph.text === family,
        );
        expect(familyGlyphs.map((glyph) => glyph.style).sort()).toEqual([
          0,
          GPU_GLYPH_BOLD,
        ]);
      } finally {
        harness.terminal.dispose();
      }
    });

    it.each([
      ["default modes", 0xc0ffee, ""],
      ["grapheme clustering", 0x5eed, "\x1b[?2027h"],
    ])(
      "agrees with the structure-of-arrays path on randomized terminal output (%s)",
      (_name, seed, prelude) => {
        const p = pair(36, 10);
        const random = mulberry32(seed);
        try {
          p.write(prelude);
          const defaults = { fg: rgba(255, 255, 255), bg: rgba(0, 0, 0) };
          let previous: Snapshot | null = null;
          for (let step = 0; step < 400; step += 1) {
            if (step > 0 && step % 97 === 0) {
              const cols = 20 + Math.floor(random() * 30);
              const rows = 5 + Math.floor(random() * 12);
              p.harness.terminal.resize(cols, rows);
              p.soa.resize(cols, rows);
            }
            p.write(randomTerminalChunk(random));
            const snapshot = p.harness.update();
            const soaState = p.soa.updateRenderState();
            expectRecordsMatchSoa(
              p.harness,
              snapshot,
              p.soa,
              soaState,
              defaults,
            );
            if (
              previous &&
              !snapshot.fullDamage &&
              previous.state.rows === snapshot.state.rows &&
              previous.state.cols === snapshot.state.cols
            ) {
              // Exact dirtiness: a row is dirty if and only if its records changed.
              const { cols } = snapshot.state;
              for (let row = 0; row < snapshot.state.rows; row += 1) {
                let changed = false;
                for (
                  let word = row * cols * 4;
                  word < (row + 1) * cols * 4;
                  word += 1
                ) {
                  if (snapshot.words[word] !== previous.words[word])
                    changed = true;
                }
                expect(
                  snapshot.dirty[row] !== 0,
                  `step ${step} row ${row}`,
                ).toBe(changed);
              }
              expect(snapshot.anyDirty).toBe(snapshot.dirty.some(Boolean));
            } else if (snapshot.fullDamage) {
              expect(snapshot.dirty.every(Boolean)).toBe(true);
              expect(snapshot.anyDirty).toBe(true);
            }
            previous = snapshot;
          }
        } finally {
          p.dispose();
        }
      },
    );
  });

  describe("exact dirty rows", () => {
    it("reports full damage and every row on the first frame", () => {
      const harness = gpu(10, 4);
      try {
        const snapshot = harness.update();
        expect(snapshot.fullDamage).toBe(true);
        expect(snapshot.anyDirty).toBe(true);
        expect(snapshot.dirty).toEqual([1, 1, 1, 1]);
        const quiet = harness.update();
        expect(quiet.fullDamage).toBe(false);
        expect(quiet.anyDirty).toBe(false);
        expect(quiet.dirty).toEqual([0, 0, 0, 0]);
      } finally {
        harness.terminal.dispose();
      }
    });

    it("suppresses rows Ghostty rewrites with identical content, unlike the SoA path", () => {
      const harness = gpu(40, 8);
      const soa = ghostty.createTerminal(40, 8);
      try {
        const frame = (spinner: string) =>
          [
            `\x1b[1;36m${spinner}\x1b[0m Working on it`,
            "  \x1b[2mstep one\x1b[0m done",
            "  \x1b[32mstep two\x1b[0m done",
            `  日本語 ${FAMILY} ok`,
          ]
            .map((line) => `\r\x1b[2K${line}`)
            .join("\r\n");
        const redraw = (spinner: string) => `\x1b[3A${frame(spinner)}`;
        harness.write(frame("⠋"));
        soa.write(bytes(frame("⠋")));
        harness.update();
        soa.updateRenderState();

        harness.write(redraw("⠋"));
        soa.write(bytes(redraw("⠋")));
        const same = harness.update();
        const soaSame = soa.updateRenderState();
        expect(Array.from(soaSame.dirtyRows).some(Boolean)).toBe(true); // Ghostty marked them dirty
        expect(same.fullDamage).toBe(false);
        expect(same.anyDirty).toBe(false);
        expect(dirtyRowIndexes(same)).toEqual([]);

        // One spinner character changes: exactly one row is dirty.
        harness.write(redraw("⠙"));
        soa.write(bytes(redraw("⠙")));
        const changed = harness.update();
        const soaChanged = soa.updateRenderState();
        expect(
          Array.from(soaChanged.dirtyRows).filter(Boolean).length,
        ).toBeGreaterThan(1);
        expect(dirtyRowIndexes(changed)).toEqual([0]);
        expect(changed.anyDirty).toBe(true);
        expect(harness.text(changed, 0, 0)).toBe("⠙");
      } finally {
        harness.terminal.dispose();
        soa.dispose();
      }
    });

    it("does not report cursor-only movement or an erased blank cell that was already blank", () => {
      const harness = gpu(20, 4);
      try {
        harness.write("abc\x1b[2;5H");
        harness.update();
        harness.write("\x1b[3;7H\x1b[?25l");
        expect(harness.update().anyDirty).toBe(false);
        harness.write("\x1b[3;1H\x1b[K\x1b[4;1H\x1b[2K");
        expect(harness.update().anyDirty).toBe(false);
        harness.write("\x1b[1;3H\x1b[Kd");
        expect(dirtyRowIndexes(harness.update())).toEqual([0]);
      } finally {
        harness.terminal.dispose();
      }
    });

    it("reports a changed color or attribute even when the text is identical", () => {
      const harness = gpu(20, 3);
      try {
        harness.write("hello");
        harness.update();
        harness.write("\r\x1b[31mhello\x1b[0m");
        expect(dirtyRowIndexes(harness.update())).toEqual([0]);
        harness.write("\r\x1b[31mhello\x1b[0m");
        expect(harness.update().anyDirty).toBe(false);
        harness.write("\r\x1b[31;4mhello\x1b[0m");
        expect(dirtyRowIndexes(harness.update())).toEqual([0]);
      } finally {
        harness.terminal.dispose();
      }
    });

    it("reports scrolled rows whose content moved", () => {
      const harness = gpu(8, 4);
      try {
        harness.write("one\r\ntwo\r\nthree\r\nfour");
        harness.update();
        harness.write("\r\nfive"); // scrolls: every row now holds different text
        const snapshot = harness.update();
        expect(
          Array.from({ length: 4 }, (_, row) =>
            harness.rowText(snapshot, row).trim(),
          ),
        ).toEqual(["two", "three", "four", "five"]);
        expect(dirtyRowIndexes(snapshot)).toEqual([0, 1, 2, 3]);

        // Identical consecutive lines: scrolling them leaves the records
        // unchanged even though Ghostty reports full damage for a scroll.
        harness.write("\x1b[2J\x1b[H");
        harness.write("same\r\nsame\r\nsame\r\nsame");
        harness.update();
        harness.write("\r\nsame");
        const unchanged = harness.update();
        expect(unchanged.fullDamage).toBe(false);
        expect(dirtyRowIndexes(unchanged)).toEqual([]);
        // Mixed: only the rows whose content differs from the stored record.
        harness.write("\r\nsame\r\nnew");
        const mixed = harness.update();
        expect(
          Array.from({ length: 4 }, (_, row) =>
            harness.rowText(mixed, row).trim(),
          ),
        ).toEqual(["same", "same", "same", "new"]);
        expect(dirtyRowIndexes(mixed)).toEqual([3]);
      } finally {
        harness.terminal.dispose();
      }
    });

    it("reports every changed row when the viewport scrolls into history", () => {
      const harness = gpu(8, 4);
      try {
        harness.write(
          Array.from({ length: 12 }, (_, i) => `line${i}`).join("\r\n"),
        );
        harness.update();
        harness.terminal.scrollViewport(-3);
        const snapshot = harness.update();
        expect(snapshot.dirty).toEqual([1, 1, 1, 1]);
        expect(harness.rowText(snapshot, 0).trim()).toBe("line5");
        expect(harness.rowText(snapshot, 3).trim()).toBe("line8");
      } finally {
        harness.terminal.dispose();
      }
    });

    it("reports full damage after a resize with the new geometry", () => {
      const harness = gpu(10, 4);
      try {
        harness.write("abcdefghijklmnopqrstuvwxyz");
        harness.update();
        harness.terminal.resize(20, 6);
        const snapshot = harness.update();
        expect(snapshot.fullDamage).toBe(true);
        expect(snapshot.dirty).toEqual([1, 1, 1, 1, 1, 1]);
        expect(snapshot.state.rows).toBe(6);
        expect(snapshot.state.cols).toBe(20);
        expect(snapshot.state.cellsBytes.byteLength).toBe(
          20 * 6 * GPU_CELL_BYTES,
        );
        expect(harness.rowText(snapshot, 0).trim()).toBe(
          "abcdefghijklmnopqrst",
        );
        harness.terminal.resize(20, 6); // no-op geometry
        harness.terminal.resize(10, 3);
        const shrunk = harness.update();
        expect(shrunk.fullDamage).toBe(true);
        expect(shrunk.state.cellsBytes.byteLength).toBe(
          10 * 3 * GPU_CELL_BYTES,
        );
        expect(shrunk.dirty).toEqual([1, 1, 1]);
      } finally {
        harness.terminal.dispose();
      }
    });

    it("re-encodes every row when the palette or default colors change, reporting only changed ones", () => {
      const harness = gpu(10, 3);
      try {
        harness.write("\x1b[34mblue\x1b[0m\r\n\x1b[48;2;1;2;3mfixed");
        harness.update();
        harness.terminal.setDefaultColors(0x112233, 0x445566, 0xffffff);
        const snapshot = harness.update();
        expect(snapshot.fullDamage).toBe(false);
        expect([...harness.cell(snapshot, 2, 0).background]).toEqual(
          rgba(0x44, 0x55, 0x66),
        );
        expect([...harness.cell(snapshot, 0, 5).foreground]).toEqual(
          rgba(0x11, 0x22, 0x33),
        );
        expect(dirtyRowIndexes(snapshot)).toEqual([0, 1, 2]);
        const palette = new Uint8Array(256 * 3);
        harness.terminal.setPalette(palette);
        const recolored = harness.update();
        expect(recolored.fullDamage).toBe(false);
        expect([...harness.cell(recolored, 0, 0).foreground]).toEqual(
          rgba(0, 0, 0),
        );
        expect(dirtyRowIndexes(recolored)).toEqual([0]); // only the palette-colored row changed
        harness.terminal.setPalette(palette);
        expect(harness.update().anyDirty).toBe(false);
      } finally {
        harness.terminal.dispose();
      }
    });
  });

  describe("periodic render-state renewal", () => {
    it("re-uploads once and stays correct across the 100,000-update renewal", () => {
      const harness = gpu(20, 4);
      try {
        harness.write("\x1b[2;1Hstable row");
        const resetsBefore = harness.terminal.resourceStats().renderStateResets;
        let fullDamageUpdates = 0;
        for (let index = 0; index < 100_050; index += 1) {
          harness.write(`\x1b[1;1H${index % 10}`);
          const state = harness.terminal.updateGpuRenderState();
          harness.terminal.acknowledgeGpuGlyphs();
          if (index > 0 && state.fullDamage) fullDamageUpdates += 1;
          // After the first frame only row 0 ever changes (the digit repeats
          // every ten updates, but each update still changes it).
          if (index > 0 && !state.fullDamage) {
            expect(Array.from(state.dirtyRows)).toEqual([1, 0, 0, 0]);
          }
        }
        expect(harness.terminal.resourceStats().renderStateResets).toBe(
          resetsBefore + 1,
        );
        expect(fullDamageUpdates).toBe(1);
        const snapshot = harness.update();
        harness.map.resync(harness.terminal, snapshot.state);
        expect(harness.rowText(snapshot, 1).trim()).toBe("stable row");
        expect(harness.text(snapshot, 0, 0)).toBe(String((100_050 - 1) % 10));
      } finally {
        harness.terminal.dispose();
      }
    });
  });

  describe("glyph epochs", () => {
    it("starts a new epoch when the table fills and re-encodes the viewport under new ids", () => {
      const harness = gpu(120, 40);
      try {
        const privateUse = (index: number) =>
          String.fromCodePoint(0xf0000 + index);
        const fill = (start: number) => {
          let text = "\x1b[H";
          for (let row = 0; row < 40; row += 1) {
            for (let column = 0; column < 120; column += 1) {
              text += privateUse(start + row * 120 + column);
            }
            if (row < 39) text += "\r\n";
          }
          return text;
        };
        const first = harness.update();
        expect(first.state.epoch).toBe(harness.map.epoch);
        const epochs = new Set<number>([first.state.epoch]);
        let total = 0;
        let rolled = false;
        for (let screen = 0; screen < 5; screen += 1) {
          harness.write(fill(total));
          total += 4800;
          const before = harness.map.epoch;
          const snapshot = harness.update();
          expect(snapshot.state.glyphCount).toBeLessThanOrEqual(MAX_GLYPHS);
          epochs.add(snapshot.state.epoch);
          if (snapshot.state.epoch !== before) {
            rolled = true;
            expect(snapshot.fullDamage).toBe(true);
            expect(snapshot.dirty.every(Boolean)).toBe(true);
            // The whole new-epoch table was delivered and ids restart at 1.
            expect(harness.map.glyphs.size).toBe(snapshot.state.glyphCount);
            expect(
              [...harness.map.glyphs.keys()].sort((a, b) => a - b)[0],
            ).toBe(1);
          }
          // Every visible cell resolves through the current map.
          for (let row = 0; row < 40; row += 1) {
            expect(harness.text(snapshot, row, 0)).toBe(
              privateUse(total - 4800 + row * 120),
            );
            expect(harness.text(snapshot, row, 119)).toBe(
              privateUse(total - 4800 + row * 120 + 119),
            );
          }
          expect(snapshot.state.glyphOverflow).toBe(0);
        }
        expect(rolled).toBe(true);
        expect(epochs.size).toBeGreaterThan(1);
      } finally {
        harness.terminal.dispose();
      }
    });

    it("draws nothing for cells beyond the table when the viewport alone exceeds it", () => {
      const harness = gpu(200, 100);
      try {
        let text = "\x1b[H";
        for (let row = 0; row < 100; row += 1) {
          for (let column = 0; column < 200; column += 1) {
            text += String.fromCodePoint(0xf0000 + row * 200 + column);
          }
          if (row < 99) text += "\r\n";
        }
        harness.write(text);
        const snapshot = harness.update();
        expect(snapshot.state.glyphCount).toBe(MAX_GLYPHS);
        expect(snapshot.state.glyphOverflow).toBe(20_000 - MAX_GLYPHS);
        expect(snapshot.fullDamage).toBe(true);
        const nothing = snapshot.words.filter(
          (_, i) =>
            i % 4 === 0 && (snapshot.words[i] & GPU_GLYPH_ID_MASK) === 0,
        );
        expect(nothing.length).toBe(20_000 - MAX_GLYPHS);
        // Bounded: another full-viewport update does not loop or grow the table.
        harness.write(`\x1b[2J${text}`);
        const again = harness.update();
        expect(again.state.glyphCount).toBeLessThanOrEqual(MAX_GLYPHS);
      } finally {
        harness.terminal.dispose();
      }
    });

    it("bounds the table across a long churn of distinct glyphs", () => {
      const harness = gpu(80, 24);
      try {
        for (let round = 0; round < 60; round += 1) {
          let text = "\x1b[H";
          for (let index = 0; index < 1920; index += 1) {
            text += String.fromCodePoint(0xf0000 + round * 1920 + index);
          }
          harness.write(text);
          const snapshot = harness.update();
          expect(snapshot.state.glyphCount).toBeLessThanOrEqual(MAX_GLYPHS);
          expect(harness.text(snapshot, 0, 0)).toBe(
            String.fromCodePoint(0xf0000 + round * 1920),
          );
        }
        expect(harness.map.epochChanges).toBeGreaterThan(1);
      } finally {
        harness.terminal.dispose();
      }
    });
  });

  describe("presentation lifecycle", () => {
    function content(harness: GpuHarness, snapshot: Snapshot) {
      // Everything but raw glyph ids, with ids resolved to text and style.
      const rows: unknown[] = [];
      const { rows: rowCount, cols } = snapshot.state;
      for (let row = 0; row < rowCount; row += 1) {
        for (let column = 0; column < cols; column += 1) {
          const index = (row * cols + column) * 4;
          const word0 = snapshot.words[index];
          const id = word0 & GPU_GLYPH_ID_MASK;
          rows.push([
            harness.map.text(id),
            harness.map.style(id),
            word0 >>> GPU_ATTR_SHIFT,
            snapshot.words[index + 1],
            snapshot.words[index + 2],
            snapshot.words[index + 3],
          ]);
        }
      }
      return rows;
    }

    it.each(["release", "compact"] as const)(
      "restores identical records after %s",
      (operation) => {
        const harness = gpu(30, 8);
        try {
          harness.write(
            `\x1b[31mred \x1b[1;4mbold\x1b[0m 日本 ${E_COMBINED}\r\n\x1b[7minverse\x1b[0m\r\nthree`,
          );
          const before = harness.update();
          const expected = content(harness, before);
          const epoch = before.state.epoch;
          const sameIdsExpected = before.words.slice();

          if (operation === "release") harness.terminal.releaseRenderState();
          else harness.terminal.compactRenderState();
          if (operation === "release") {
            expect(harness.terminal.resourceStats()).toMatchObject({
              cellCapacity: 0,
              glyphCount: 0,
            });
          }
          const after = harness.update();
          expect(after.fullDamage).toBe(true);
          expect(after.dirty.every(Boolean)).toBe(true);
          expect(content(harness, after)).toEqual(expected);
          if (operation === "release") {
            expect(after.state.epoch).not.toBe(epoch);
            // Same content in the same order interns to the same dense ids.
            expect(after.words).toEqual(sameIdsExpected);
          }
          expect(after.state.blinkingCells).toBe(0);
        } finally {
          harness.terminal.dispose();
        }
      },
    );

    it("keeps the blink count correct across release", () => {
      const harness = gpu(10, 3);
      try {
        harness.write("\x1b[5mab\x1b[0m");
        expect(harness.update().state.blinkingCells).toBe(2);
        harness.terminal.releaseRenderState();
        expect(harness.update().state.blinkingCells).toBe(2);
      } finally {
        harness.terminal.dispose();
      }
    });

    it("allocates lazily, uses less memory than the SoA format and returns it on release", async () => {
      const measure = async (format: "soa" | "gpu") => {
        const instance = await TeraxGhostty.loadBytes(wasmBytes.slice(0));
        const terminals = Array.from({ length: 8 }, () => {
          const terminal = instance.createTerminal(120, 40, {
            maxScrollbackLines: 100,
          });
          terminal.setRenderFormat(format);
          return terminal;
        });
        const idle = instance.getMemoryBytes();
        expect(terminals[0].resourceStats().cellCapacity).toBe(0);
        for (const terminal of terminals) {
          terminal.write(bytes("hello\r\n"));
          if (format === "gpu") terminal.updateGpuRenderState();
          else terminal.updateRenderState();
        }
        const used = instance.getMemoryBytes();
        const stats = terminals[0].resourceStats();
        for (const terminal of terminals) terminal.releaseRenderState();
        const released = terminals[0].resourceStats();
        for (const terminal of terminals) terminal.dispose();
        return { idle, used, stats, released };
      };
      const soa = await measure("soa");
      const gpuResult = await measure("gpu");
      expect(gpuResult.stats.cellCapacity).toBeGreaterThanOrEqual(120 * 40);
      expect(gpuResult.released.cellCapacity).toBe(0);
      expect(gpuResult.used - gpuResult.idle).toBeLessThan(soa.used - soa.idle);
    });
  });

  describe("render format selection", () => {
    it("rejects mismatched updates and keeps the SoA path unchanged", () => {
      const terminal = ghostty.createTerminal(10, 3);
      try {
        expect(terminal.renderFormat).toBe("soa");
        expect(() => terminal.updateGpuRenderState()).toThrow(
          /requires the "gpu" render format/,
        );
        terminal.write(bytes("soa"));
        const soaState = terminal.updateRenderState();
        expect(soaState.codepoints[0]).toBe("s".codePointAt(0));
        terminal.setRenderFormat("gpu");
        expect(() => terminal.updateRenderState()).toThrow(
          /requires the "soa" render format/,
        );
        const first = terminal.updateGpuRenderState();
        expect(first.fullDamage).toBe(true);
        terminal.setRenderFormat("soa");
        const back = terminal.updateRenderState();
        expect(back.fullDamage).toBe(true);
        expect(back.codepoints[2]).toBe("a".codePointAt(0));
        expect(terminal.resourceStats().glyphCount).toBe(0);
      } finally {
        terminal.dispose();
      }
    });

    it("keeps hyperlink ids for every row in the GPU format", () => {
      const harness = gpu(30, 4);
      try {
        harness.write(
          "see \x1b]8;;https://example.test/a\x1b\\link\x1b]8;;\x1b\\ and \x1b]8;;https://example.test/b\x1b\\two\x1b]8;;\x1b\\",
        );
        const snapshot = harness.update();
        const state = snapshot.state;
        expect(harness.terminal.hyperlinkAt(state, 4)).toBe(
          "https://example.test/a",
        );
        expect(harness.terminal.hyperlinkAt(state, 7)).toBe(
          "https://example.test/a",
        );
        expect(harness.terminal.hyperlinkAt(state, 3)).toBeNull();
        expect(harness.terminal.hyperlinkAt(state, 13)).toBe(
          "https://example.test/b",
        );
        // A later partial update keeps links on untouched rows.
        harness.write("\r\nplain");
        const next = harness.update();
        expect(harness.terminal.hyperlinkAt(next.state, 4)).toBe(
          "https://example.test/a",
        );
        expect(next.state.rowWrapped.length).toBe(4);
      } finally {
        harness.terminal.dispose();
      }
    });
  });

  describe("reading lines without a render state", () => {
    it.each(["soa", "gpu"] as const)(
      "decodes scrollback, wide cells and graphemes in the %s format",
      (format) => {
        const terminal = ghostty.createTerminal(10, 3, {
          maxScrollbackLines: 100,
        });
        try {
          terminal.setRenderFormat(format);
          terminal.write(
            bytes(
              `\x1b[?2027hzero\r\n日本x\r\n${E_COMBINED}${E_PRECOMPOSED} ${COUPLE}\r\nlast one wraps here`,
            ),
          );
          const total = terminal.scrollbar().total;
          const lines = terminal.readLines(0, total + 20);
          expect(lines.length).toBe(total);
          expect(lines[0].cells.join("")).toBe("zero      ");
          expect(lines[1].cells).toEqual([
            "日",
            "",
            "本",
            "",
            "x",
            " ",
            " ",
            " ",
            " ",
            " ",
          ]);
          expect(lines[2].cells.slice(0, 4)).toEqual([
            E_COMBINED,
            E_PRECOMPOSED,
            " ",
            COUPLE,
          ]);
          expect(lines.some((line) => line.wrapped)).toBe(true);
          expect(terminal.readLines(2, 1)).toEqual([]);
          expect(terminal.readLines(total + 5, total + 9)).toEqual([]);
          // Reading never moved the viewport or created render data.
          expect(terminal.scrollbar().offset).toBe(total - 3);
          expect(terminal.resourceStats().cellCapacity).toBe(0);
        } finally {
          terminal.dispose();
        }
      },
    );

    it("reads long histories in bounded chunks", () => {
      const terminal = ghostty.createTerminal(20, 5, {
        maxScrollbackLines: 5000,
      });
      try {
        terminal.write(
          bytes(Array.from({ length: 700 }, (_, i) => `row ${i}`).join("\r\n")),
        );
        const total = terminal.scrollbar().total;
        const lines = terminal.readLines(0, total - 1);
        expect(lines).toHaveLength(total);
        expect(lines[0].cells.join("").trim()).toBe("row 0");
        expect(lines[699].cells.join("").trim()).toBe("row 699");
      } finally {
        terminal.dispose();
      }
    });
  });

  describe("shared WASM memory", () => {
    it("keeps independent terminals and epochs isolated", () => {
      const a = gpu(20, 3);
      const b = gpu(20, 3);
      try {
        a.write("alpha");
        b.write("zzz beta");
        const sa = a.update();
        const sb = b.update();
        expect(a.text(sa, 0, 0)).toBe("a");
        expect(b.text(sb, 0, 0)).toBe("z");
        a.terminal.releaseRenderState();
        const sb2 = b.update();
        expect(sb2.fullDamage).toBe(false);
        expect(sb2.state.epoch).toBe(sb.state.epoch);
        expect(b.text(sb2, 0, 4)).toBe("b");
      } finally {
        a.terminal.dispose();
        b.terminal.dispose();
      }
    });
  });
});

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEXT_POOL = [
  "hello",
  "agent",
  "x",
  " ",
  "  ",
  "日本語",
  "本",
  E_COMBINED,
  E_PRECOMPOSED,
  FAMILY,
  "\u{1F1EF}\u{1F1F5}",
  "─│┌┐",
  "⠋⠙⠹⠸",
  "λ→∑",
  "tab\t",
];
const SGR_POOL = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "4:2",
  "4:3",
  "4:4",
  "4:5",
  "5",
  "7",
  "8",
  "9",
  "53",
  "22",
  "23",
  "24",
  "25",
  "27",
  "28",
  "29",
  "55",
  "31",
  "32",
  "34",
  "90",
  "97",
  "39",
  "49",
  "38;5;208",
  "38;5;17",
  "38;2;10;200;30",
  "48;5;236",
  "48;5;17",
  "48;2;200;100;50",
  "58;5;196",
  "58;2;9;8;7",
  "59",
];

function randomTerminalChunk(random: () => number): string {
  const pick = <T>(pool: readonly T[]) =>
    pool[Math.floor(random() * pool.length)];
  const count = 1 + Math.floor(random() * 6);
  let out = "";
  for (let index = 0; index < count; index += 1) {
    const roll = random();
    if (roll < 0.35)
      out += pick(TEXT_POOL).repeat(1 + Math.floor(random() * 3));
    else if (roll < 0.55) out += `\x1b[${pick(SGR_POOL)}m`;
    else if (roll < 0.62) out += "\r\n";
    else if (roll < 0.68) out += "\r";
    else if (roll < 0.74)
      out += `\x1b[${1 + Math.floor(random() * 12)};${1 + Math.floor(random() * 40)}H`;
    else if (roll < 0.8)
      out += `\x1b[${1 + Math.floor(random() * 3)}${pick(["A", "B", "C", "D"])}`;
    else if (roll < 0.86)
      out += `\x1b[${pick(["0", "1", "2"])}${pick(["K", "J"])}`;
    else if (roll < 0.9)
      out += `\x1b[${1 + Math.floor(random() * 3)}${pick(["L", "M", "@", "P", "X"])}`;
    else if (roll < 0.93) out += pick(["\x1bD", "\x1bM", "\x1b[S", "\x1b[T"]);
    else if (roll < 0.96)
      out += `\x1b[${1 + Math.floor(random() * 4)};${5 + Math.floor(random() * 6)}r`;
    else out += "\x1b[r";
  }
  return out;
}
