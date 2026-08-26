import { afterEach, describe, expect, it, vi } from "vitest";
import { hasIntrinsicColor, WebGlGlyphAtlas } from "./WebGlGlyphAtlas";

afterEach(() => vi.unstubAllGlobals());

describe("hasIntrinsicColor", () => {
  it("keeps monochrome antialiasing in the compact coverage atlas", () => {
    expect(
      hasIntrinsicColor(
        new Uint8ClampedArray([
          255, 255, 255, 255, 255, 255, 255, 128, 0, 0, 0, 0,
        ]),
      ),
    ).toBe(false);
  });

  it("routes color glyphs to the RGBA atlas", () => {
    expect(
      hasIntrinsicColor(
        new Uint8ClampedArray([255, 202, 40, 255, 255, 255, 255, 128]),
      ),
    ).toBe(true);
  });

  it("preserves intrinsically gray emoji pixels", () => {
    expect(hasIntrinsicColor(new Uint8ClampedArray([96, 96, 96, 255]))).toBe(
      true,
    );
  });

  it("ignores transparent RGB residue", () => {
    expect(hasIntrinsicColor(new Uint8ClampedArray([255, 0, 100, 0]))).toBe(
      false,
    );
  });
});

describe("WebGlGlyphAtlas uploads", () => {
  it("uploads dirty rows directly from the retained atlas without repacking", () => {
    const texSubImage2D = vi.fn();
    const pixelStorei = vi.fn();
    const gl = createWebGlHarness(texSubImage2D, pixelStorei);
    const atlas = new WebGlGlyphAtlas(gl, METRICS, 1);

    atlas.glyph(65, null, 0);
    atlas.glyph(66, null, 0);
    atlas.bindAndUpload();

    expect(texSubImage2D).toHaveBeenCalledOnce();
    expect(texSubImage2D.mock.calls[0][8]).toBeInstanceOf(Uint8Array);
    expect((texSubImage2D.mock.calls[0][8] as Uint8Array).byteLength).toBe(
      1_048_576,
    );
    expect(pixelStorei).toHaveBeenCalledWith(gl.UNPACK_ROW_LENGTH, 1_024);
    expect(pixelStorei).toHaveBeenCalledWith(gl.UNPACK_ROW_LENGTH, 0);
    expect(atlas.uploadCount).toBe(1);
    expect(atlas.uploadedBytes).toBeGreaterThan(0);
    atlas.dispose();
  });
});

function createWebGlHarness(
  texSubImage2D: ReturnType<typeof vi.fn>,
  pixelStorei: ReturnType<typeof vi.fn>,
): WebGL2RenderingContext {
  const pixels = new Uint8ClampedArray(12 * 16 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = 255;
    pixels[offset + 1] = 255;
    pixels[offset + 2] = 255;
    pixels[offset + 3] = 255;
  }
  vi.stubGlobal("document", {
    createElement: vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        clearRect: vi.fn(),
        fillText: vi.fn(),
        getImageData: vi.fn(() => ({ data: pixels })),
        measureText: vi.fn(() => ({
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: 8,
          actualBoundingBoxAscent: 10,
          actualBoundingBoxDescent: 2,
        })),
        font: "",
        textAlign: "left",
        textBaseline: "alphabetic",
        fillStyle: "white",
      })),
    })),
  });
  return {
    TEXTURE_2D: 1,
    TEXTURE_MIN_FILTER: 2,
    TEXTURE_MAG_FILTER: 3,
    TEXTURE_WRAP_S: 4,
    TEXTURE_WRAP_T: 5,
    LINEAR: 6,
    CLAMP_TO_EDGE: 7,
    UNPACK_ALIGNMENT: 8,
    UNPACK_ROW_LENGTH: 9,
    UNPACK_SKIP_PIXELS: 10,
    UNPACK_SKIP_ROWS: 11,
    R8: 12,
    RED: 13,
    RGBA: 14,
    UNSIGNED_BYTE: 15,
    TEXTURE0: 16,
    TEXTURE1: 17,
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    pixelStorei,
    texImage2D: vi.fn(),
    texSubImage2D,
    activeTexture: vi.fn(),
    deleteTexture: vi.fn(),
  } as unknown as WebGL2RenderingContext;
}

const METRICS = {
  font: {
    family: "monospace",
    size: 14,
    lineHeight: 1.2,
    letterSpacing: 0,
    weight: "400",
  },
  cellWidth: 8,
  cellHeight: 16,
  baseline: 12,
} as const;
