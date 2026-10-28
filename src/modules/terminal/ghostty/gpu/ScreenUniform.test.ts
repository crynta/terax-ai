import { describe, expect, it } from "vitest";
import { ScreenUniform, type ScreenUniformState } from "./ScreenUniform";
import {
  BACKGROUND_SHADER,
  GLYPH_SHADER,
  SCREEN_FLAG_SEARCH_ACTIVE,
  SCREEN_FLAG_SELECTION_ACTIVE,
  SCREEN_FLAG_SELECTION_RECTANGULAR,
  SCREEN_FLAG_TEXT_BLINK_VISIBLE,
  SCREEN_OFFSET,
  SCREEN_UNIFORM_BYTES,
} from "./shaders";
import { NO_SELECTION } from "./terminalGeometry";
import { DWRITE_GAMMA_RATIOS } from "./textContrast";

const STATE: ScreenUniformState = {
  cols: 120,
  rows: 40,
  cellWidth: 11,
  cellHeight: 21,
  viewport: { x: 0, y: 0, width: 120 * 11, height: 40 * 21 },
  shiftY: 0,
  textBlinkVisible: true,
  searchActive: false,
  cursor: { x: 22, y: 42, width: 11, height: 21 },
  cursorColor: [255, 128, 0],
  background: [10, 20, 30],
  selection: NO_SELECTION,
  selectionColor: [51, 102, 204],
  selectionAlpha: 0.5,
  decoration: { baseline: 16, thickness: 1, strikeY: 10 },
  leftOverhangPadding: 1,
  contrast: { enhancedContrast: 0.5, alphaCorrection: 0.25 },
};

function view(uniform: ScreenUniform) {
  const buffer = uniform.data.buffer;
  return {
    f: new Float32Array(buffer),
    u: new Uint32Array(buffer),
    i: new Int32Array(buffer),
  };
}

describe("ScreenUniform", () => {
  it("packs the layout the shader declares", () => {
    const uniform = new ScreenUniform();
    uniform.pack({
      ...STATE,
      viewport: { x: 1005, y: 33, width: 1400, height: 900 },
      searchActive: true,
      selection: {
        active: true,
        rectangular: true,
        startLine: -3,
        startColumn: 4,
        endLine: 9,
        endColumn: 12,
        left: 2,
        right: 30,
      },
    });
    const { f, u, i } = view(uniform);
    const at = (offset: number, word = 0) => offset / 4 + word;
    // The pane's rectangle in the shared window canvas: the viewport size maps the grid onto
    // it and the origin turns window-relative fragment coordinates into pane-relative ones.
    expect([
      f[at(SCREEN_OFFSET.viewportSize)],
      f[at(SCREEN_OFFSET.viewportSize, 1)],
    ]).toEqual([1400, 900]);
    expect([
      u[at(SCREEN_OFFSET.origin)],
      u[at(SCREEN_OFFSET.origin, 1)],
    ]).toEqual([1005, 33]);
    expect([
      u[at(SCREEN_OFFSET.cellSize)],
      u[at(SCREEN_OFFSET.cellSize, 1)],
    ]).toEqual([11, 21]);
    expect([u[at(SCREEN_OFFSET.dims)], u[at(SCREEN_OFFSET.dims, 1)]]).toEqual([
      120, 40,
    ]);
    expect(u[at(SCREEN_OFFSET.flags)]).toBe(
      SCREEN_FLAG_TEXT_BLINK_VISIBLE |
        SCREEN_FLAG_SEARCH_ACTIVE |
        SCREEN_FLAG_SELECTION_ACTIVE |
        SCREEN_FLAG_SELECTION_RECTANGULAR,
    );
    expect([
      ...f.slice(
        at(SCREEN_OFFSET.cursorOrigin),
        at(SCREEN_OFFSET.cursorOrigin) + 4,
      ),
    ]).toEqual([22, 42, 11, 21]);
    expect(f[at(SCREEN_OFFSET.cursorColor, 1)]).toBeCloseTo(128 / 255, 6);
    expect(f[at(SCREEN_OFFSET.cursorColor, 3)]).toBe(1);
    expect(f[at(SCREEN_OFFSET.themeBackground)]).toBeCloseTo(10 / 255, 6);
    expect(f[at(SCREEN_OFFSET.selectionColor, 3)]).toBe(0.5);
    expect([
      ...i.slice(
        at(SCREEN_OFFSET.selectionLines),
        at(SCREEN_OFFSET.selectionLines) + 4,
      ),
    ]).toEqual([-3, 4, 9, 12]);
    expect([
      i[at(SCREEN_OFFSET.selectionColumns)],
      i[at(SCREEN_OFFSET.selectionColumns, 1)],
    ]).toEqual([2, 30]);
    expect([
      ...u.slice(
        at(SCREEN_OFFSET.decoration),
        at(SCREEN_OFFSET.decoration) + 4,
      ),
    ]).toEqual([16, 1, 10, 1]);
    expect(f[at(SCREEN_OFFSET.contrast)]).toBe(0.5);
    expect(f[at(SCREEN_OFFSET.contrast, 1)]).toBe(0.25);
    expect([
      ...f.slice(at(SCREEN_OFFSET.gamma), at(SCREEN_OFFSET.gamma) + 4),
    ]).toEqual(DWRITE_GAMMA_RATIOS.map(Math.fround));
    expect(uniform.data.byteLength).toBe(SCREEN_UNIFORM_BYTES);
  });

  it("reports a change when only the pane's rectangle in the window canvas moves or resizes", () => {
    const uniform = new ScreenUniform();
    uniform.pack(STATE);
    uniform.markUploaded();
    for (const viewport of [
      { ...STATE.viewport, x: 1 },
      { ...STATE.viewport, y: 1 },
      { ...STATE.viewport, width: STATE.viewport.width + 1 },
      { ...STATE.viewport, height: STATE.viewport.height + 1 },
    ]) {
      uniform.pack({ ...STATE, viewport });
      expect(uniform.changed()).toBe(true);
      uniform.pack(STATE);
      expect(uniform.changed()).toBe(false);
    }
  });

  it("hides the cursor by zeroing its rectangle", () => {
    const uniform = new ScreenUniform();
    uniform.pack({ ...STATE, cursor: null });
    const { f } = view(uniform);
    const at = SCREEN_OFFSET.cursorOrigin / 4;
    expect([...f.slice(at, at + 4)]).toEqual([0, 0, 0, 0]);
  });

  it("reports a change only when the packed state differs from the uploaded one", () => {
    const uniform = new ScreenUniform();
    uniform.pack(STATE);
    expect(uniform.changed()).toBe(true);
    uniform.markUploaded();
    uniform.pack(STATE);
    expect(uniform.changed()).toBe(false);
    uniform.pack({ ...STATE, textBlinkVisible: false });
    expect(uniform.changed()).toBe(true);
    uniform.markUploaded();
    uniform.pack({
      ...STATE,
      textBlinkVisible: false,
      cursor: { x: 33, y: 42, width: 11, height: 21 },
    });
    expect(uniform.changed()).toBe(true);
    uniform.markUploaded();
    uniform.invalidate();
    uniform.pack({
      ...STATE,
      textBlinkVisible: false,
      cursor: { x: 33, y: 42, width: 11, height: 21 },
    });
    expect(uniform.changed()).toBe(true);
  });
});

describe("shader uniform layout", () => {
  const SIZES: Record<string, [size: number, align: number]> = {
    f32: [4, 4],
    u32: [4, 4],
    i32: [4, 4],
    vec2f: [8, 8],
    vec2u: [8, 8],
    vec2i: [8, 8],
    vec4f: [16, 16],
    vec4u: [16, 16],
    vec4i: [16, 16],
  };

  function layout(shader: string) {
    const body = /struct Screen \{([^}]*)\}/.exec(shader)?.[1] ?? "";
    const fields = [...body.matchAll(/(\w+):\s*(\w+),/g)];
    let offset = 0;
    let structAlign = 1;
    const offsets: Record<string, number> = {};
    for (const [, name, type] of fields) {
      const [size, align] = SIZES[type];
      offset = Math.ceil(offset / align) * align;
      offsets[name] = offset;
      offset += size;
      structAlign = Math.max(structAlign, align);
    }
    return { offsets, size: Math.ceil(offset / structAlign) * structAlign };
  }

  it.each([
    ["background", BACKGROUND_SHADER],
    ["glyph", GLYPH_SHADER],
  ])(
    "declares offsets that match the TypeScript packer in the %s shader",
    (_name, shader) => {
      const { offsets, size } = layout(shader);
      expect(size).toBe(SCREEN_UNIFORM_BYTES);
      expect(offsets).toMatchObject({
        viewport_size: SCREEN_OFFSET.viewportSize,
        origin: SCREEN_OFFSET.origin,
        clip: SCREEN_OFFSET.clip,
        cell_size: SCREEN_OFFSET.cellSize,
        dims: SCREEN_OFFSET.dims,
        flags: SCREEN_OFFSET.flags,
        cursor_origin: SCREEN_OFFSET.cursorOrigin,
        cursor_size: SCREEN_OFFSET.cursorSize,
        cursor_color: SCREEN_OFFSET.cursorColor,
        theme_background: SCREEN_OFFSET.themeBackground,
        selection_color: SCREEN_OFFSET.selectionColor,
        selection_lines: SCREEN_OFFSET.selectionLines,
        selection_columns: SCREEN_OFFSET.selectionColumns,
        decoration: SCREEN_OFFSET.decoration,
        contrast: SCREEN_OFFSET.contrast,
        gamma: SCREEN_OFFSET.gamma,
      });
    },
  );

  it("subtracts the viewport origin from window-relative fragment coordinates in both passes", () => {
    // Fragment positions are relative to the whole canvas, but a pane's cells, cursor and
    // glyph quads are relative to its viewport.
    expect(BACKGROUND_SHADER).toMatch(
      /let local_position = position\.xy - vec2f\(screen\.origin\) \+ vec2f\(0\.0, f32\(screen\.shift_y\)\);/,
    );
    expect(BACKGROUND_SHADER).not.toMatch(/vec2u\(position\.xy\)/);
    expect(GLYPH_SHADER).toMatch(/vec2i\(screen\.origin\)/);
  });

  it("keeps a clipped pane's origin signed and tells the vertex stage how much was cut off", () => {
    const uniform = new ScreenUniform();
    uniform.pack({
      ...STATE,
      viewport: { x: 0, y: 0, width: 97, height: 98, clipX: 3, clipY: 2 },
    });
    const { u, i } = view(uniform);
    const at = (offset: number, word = 0) => offset / 4 + word;
    // The pane starts three pixels left of and two above the viewport it is clipped to.
    expect([
      i[at(SCREEN_OFFSET.origin)],
      i[at(SCREEN_OFFSET.origin, 1)],
    ]).toEqual([-3, -2]);
    expect([u[at(SCREEN_OFFSET.clip)], u[at(SCREEN_OFFSET.clip, 1)]]).toEqual([
      3, 2,
    ]);
    uniform.pack({
      ...STATE,
      viewport: { x: 40, y: 8, width: 97, height: 98 },
    });
    const plain = view(uniform);
    expect([
      plain.i[at(SCREEN_OFFSET.origin)],
      plain.i[at(SCREEN_OFFSET.origin, 1)],
    ]).toEqual([40, 8]);
    expect(plain.u[at(SCREEN_OFFSET.clip)]).toBe(0);
    // Glyph quads leave the vertex stage relative to the viewport, which starts at the clip.
    expect(GLYPH_SHADER).toMatch(/-\s+vec2f\(screen\.clip\)/);
    expect(GLYPH_SHADER).toMatch(/origin: vec2i,\s+clip: vec2u,/);
  });

  it("moves the grid up by the shift in the cell pass and in the glyph pass alike", () => {
    expect(BACKGROUND_SHADER).toMatch(/f32\(screen\.shift_y\)/);
    // Glyph quads leave the vertex stage shifted, and the fragment stage undoes it to find the texel.
    expect(GLYPH_SHADER).toMatch(/- vec2f\(0\.0, f32\(screen\.shift_y\)\)/);
    expect(GLYPH_SHADER).toMatch(/vec2i\(0, i32\(screen\.shift_y\)\)/);
  });

  it("packs the shift as whole device pixels and never negative", () => {
    const uniform = new ScreenUniform();
    uniform.pack({ ...STATE, shiftY: 37.4 });
    expect(new Uint32Array(uniform.data.buffer)[SCREEN_OFFSET.shiftY / 4]).toBe(
      37,
    );
    uniform.pack({ ...STATE, shiftY: -5 });
    expect(new Uint32Array(uniform.data.buffer)[SCREEN_OFFSET.shiftY / 4]).toBe(
      0,
    );
  });

  it("binds the storage and texture slots the surface fills", () => {
    for (const shader of [BACKGROUND_SHADER, GLYPH_SHADER]) {
      expect(shader).toMatch(/@binding\(1\) var<storage, read> cells/);
      expect(shader).toMatch(/@binding\(2\) var<storage, read> glyph_map/);
      expect(shader).toMatch(/@binding\(3\) var<storage, read> glyph_table/);
      expect(shader).toMatch(/@binding\(4\) var<storage, read> search_mask/);
      expect(shader).toMatch(/@binding\(5\) var coverage_texture/);
      expect(shader).toMatch(/@binding\(6\) var color_texture/);
    }
    // Sampling must stay out of non-uniform control flow and unfiltered.
    expect(GLYPH_SHADER).not.toMatch(/textureSample\(/);
    expect(GLYPH_SHADER).toMatch(/textureLoad\(coverage_texture/);
  });
});
