import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_FULL,
  GLYPH_ENTRY_FLAG_COLOR,
  GLYPH_ENTRY_FLAG_EXACT,
  GLYPH_ENTRY_WORDS,
  GlyphAtlas,
} from "./GlyphAtlas";
import { deriveFontMetrics } from "./terminalVisuals";

const METRICS = deriveFontMetrics(
  {
    family: "monospace",
    size: 14,
    lineHeight: 1.2,
    letterSpacing: 0,
    weight: "400",
  },
  1,
  { advance: 8, ascent: 11, descent: 3 },
);

type Texture = {
  width: number;
  height: number;
  format: string;
  destroyed: boolean;
  createView: () => object;
  destroy: () => void;
};

/**
 * A fake device plus a fake 2D canvas. Text "W" rasterizes as a 250x250 glyph
 * (so an atlas holds a known number of them), "COLOR" as a coloured 8x8
 * glyph, and anything else as a small 8x14 monochrome glyph.
 */
function createHarness(maxTextureDimension2D = 8_192) {
  const textures: Texture[] = [];
  const buffers: Array<{ size: number; destroyed: boolean; destroy(): void }> =
    [];
  const writeTexture = vi.fn();
  const writeBuffer = vi.fn();
  const submit = vi.fn();
  const copyTextureToTexture = vi.fn();
  const device = {
    limits: { maxTextureDimension2D },
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const size = descriptor.size as number[];
      const texture: Texture = {
        width: size[0],
        height: size[1],
        format: descriptor.format,
        destroyed: false,
        createView: () => ({ texture }),
        destroy: () => {
          texture.destroyed = true;
        },
      };
      textures.push(texture);
      return texture;
    }),
    createBuffer: vi.fn(({ size }: GPUBufferDescriptor) => {
      const buffer = {
        size,
        destroyed: false,
        destroy: () => {
          buffer.destroyed = true;
        },
      };
      buffers.push(buffer);
      return buffer;
    }),
    createCommandEncoder: vi.fn(() => ({
      copyTextureToTexture,
      finish: () => ({}),
    })),
    queue: { writeTexture, writeBuffer, submit },
  } as unknown as GPUDevice;

  vi.stubGlobal("GPUTextureUsage", {
    COPY_DST: 1,
    TEXTURE_BINDING: 2,
    COPY_SRC: 4,
  });
  vi.stubGlobal("GPUBufferUsage", { STORAGE: 1, COPY_DST: 2 });
  let current = "";
  const context = {
    font: "",
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    clearRect: vi.fn(),
    fillText: vi.fn((text: string) => {
      current = text;
    }),
    measureText: (text: string) => {
      current = text;
      if (text.startsWith("W")) {
        return {
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: 246,
          actualBoundingBoxAscent: 120,
          actualBoundingBoxDescent: 126,
        };
      }
      return {
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: 8,
        actualBoundingBoxAscent: 11,
        actualBoundingBoxDescent: 3,
      };
    },
    getImageData: (_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      data.fill(255);
      if (current === "COLOR") {
        for (let index = 0; index < data.length; index += 4) data[index] = 40;
      }
      return { data };
    },
  };
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => context,
    }),
  });
  return {
    device,
    textures,
    buffers,
    writeTexture,
    writeBuffer,
    submit,
    copyTextureToTexture,
    context,
  };
}

function liveTextures(textures: Texture[]) {
  return textures.filter((texture) => !texture.destroyed);
}

describe("GlyphAtlas", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rasterizes once per text and style and shares the index", () => {
    const h = createHarness();
    const atlas = new GlyphAtlas(h.device, METRICS);
    const regular = atlas.resolve("A", 0);
    expect(atlas.resolve("A", 0)).toBe(regular);
    const bold = atlas.resolve("A", 1);
    const accented = atlas.resolve("é", 0);
    expect(new Set([regular, bold, accented]).size).toBe(3);
    expect(atlas.resolve("é", 0)).toBe(accented);
    expect(atlas.glyphCount).toBe(3);
    expect(h.context.fillText).toHaveBeenCalledTimes(3);
    atlas.dispose();
  });

  it("encodes rect, size, bearing and flags in 16-byte table entries and commits once", () => {
    const h = createHarness();
    const atlas = new GlyphAtlas(h.device, METRICS);
    const first = atlas.resolve("A", 0);
    const second = atlas.resolve("B", 0);
    atlas.commit();
    atlas.commit();
    expect(h.writeBuffer).toHaveBeenCalledOnce();
    const [, offset, data, start, length] = h.writeBuffer.mock.calls[0];
    expect(offset).toBe(0);
    expect(length).toBe(2 * GLYPH_ENTRY_WORDS);
    const words = data as Uint32Array;
    const entry = (index: number) =>
      words.slice(
        start + index * GLYPH_ENTRY_WORDS,
        start + (index + 1) * GLYPH_ENTRY_WORDS,
      );
    const a = entry(first);
    const width = 8 + 4;
    const height = 11 + 3 + 4;
    expect(a[1]).toBe(width | (height << 16));
    // Bearing: -padding horizontally, baseline - ascent - padding vertically.
    const bearingX = (a[2] << 16) >> 16;
    const bearingY = a[2] >> 16;
    expect(bearingX).toBe(-2);
    expect(bearingY).toBe(METRICS.deviceBaseline - 11 - 2);
    expect(a[3]).toBe(0);
    // The second glyph is packed next to the first.
    expect(entry(second)[0]).not.toBe(a[0]);
    expect(h.writeTexture).toHaveBeenCalledTimes(2);
    const [destination, , layout, size] = h.writeTexture.mock.calls[0];
    expect(destination.origin).toEqual([a[0] & 0xffff, a[0] >>> 16, 0]);
    expect(layout).toEqual({ bytesPerRow: width, rowsPerImage: height });
    expect(size).toEqual([width, height, 1]);
    atlas.dispose();
  });

  it("shares one cell-sized exact entry between styles for procedural glyphs", () => {
    const h = createHarness();
    const atlas = new GlyphAtlas(h.device, METRICS);
    const regular = atlas.resolve("┼", 0);
    expect(atlas.resolve("┼", 1)).toBe(regular);
    expect(atlas.resolve("┼", 2)).toBe(regular);
    expect(atlas.resolve("┼", 3)).toBe(regular);
    expect(atlas.glyphCount).toBe(1);
    // Neither the canvas nor the colour atlas is involved.
    expect(h.context.fillText).not.toHaveBeenCalled();
    expect(liveTextures(h.textures).map((t) => t.format)).toEqual([
      "r8unorm",
      "rgba8unorm",
    ]);
    atlas.commit();
    const [, , data, start] = h.writeBuffer.mock.calls[0];
    const entry = (data as Uint32Array).slice(start, start + GLYPH_ENTRY_WORDS);
    expect(entry[1]).toBe(
      METRICS.deviceCellWidth | (METRICS.deviceCellHeight << 16),
    );
    // Zero bearing: the quad covers the whole cell.
    expect(entry[2]).toBe(0);
    expect(entry[3]).toBe(GLYPH_ENTRY_FLAG_EXACT);
    const [, pixels, layout, size] = h.writeTexture.mock.calls[0];
    expect(size).toEqual([
      METRICS.deviceCellWidth,
      METRICS.deviceCellHeight,
      1,
    ]);
    expect(layout.bytesPerRow).toBe(METRICS.deviceCellWidth);
    expect(
      Array.from(pixels as Uint8Array).some((value) => value === 255),
    ).toBe(true);
    // A font glyph in the same atlas is not flagged and keeps its own styles.
    const bold = atlas.resolve("A", 1);
    expect(atlas.resolve("A", 0)).not.toBe(bold);
    atlas.commit();
    const words = h.writeBuffer.mock.calls[1][2] as Uint32Array;
    expect(words[bold * GLYPH_ENTRY_WORDS + 3]).toBe(0);
    atlas.dispose();
  });

  it("allocates the colour atlas only for an intrinsic-colour glyph", () => {
    const h = createHarness();
    const atlas = new GlyphAtlas(h.device, METRICS);
    const before = atlas.byteSize;
    const generation = atlas.generation;
    expect(liveTextures(h.textures).map((t) => t.format)).toEqual([
      "r8unorm",
      "rgba8unorm",
    ]);
    const color = atlas.resolve("COLOR", 0);
    atlas.commit();
    expect(atlas.byteSize).toBeGreaterThan(before + 512 * 512);
    expect(atlas.generation).toBeGreaterThan(generation);
    const words = h.writeBuffer.mock.calls[0][2] as Uint32Array;
    expect(words[color * GLYPH_ENTRY_WORDS + 3]).toBe(GLYPH_ENTRY_FLAG_COLOR);
    expect(h.writeTexture.mock.calls[0][0].texture.format).toBe("rgba8unorm");
    expect(h.writeTexture.mock.calls[0][2].bytesPerRow).toBe((8 + 4) * 4);
    atlas.dispose();
  });

  it("grows 1024 to 2048 to 4096 by a GPU copy before reporting it is full", () => {
    const h = createHarness();
    const atlas = new GlyphAtlas(h.device, METRICS);
    expect(atlas.coverageSize).toBe(1_024);
    const generation = atlas.generation;
    // 254x254 glyphs: 16 fit in 1024^2.
    for (let count = 0; count < 16; count += 1) {
      expect(atlas.resolve(`W${count}`, 0)).not.toBe(ATLAS_FULL);
    }
    expect(atlas.coverageSize).toBe(1_024);
    // The 17th distinct big glyph forces growth.
    expect(atlas.resolve("W-grow", 0)).not.toBe(ATLAS_FULL);
    expect(atlas.coverageSize).toBe(2_048);
    expect(atlas.growthCount).toBe(1);
    expect(atlas.generation).toBeGreaterThan(generation);
    expect(h.copyTextureToTexture).toHaveBeenCalledOnce();
    expect(h.copyTextureToTexture.mock.calls[0][2]).toEqual([1_024, 1_024, 1]);
    expect(h.submit).toHaveBeenCalledOnce();
    // The replaced texture survives until the owner reports the submission.
    const retired = h.textures.find(
      (t) => t.width === 1_024 && t.format === "r8unorm",
    );
    expect(retired?.destroyed).toBe(false);
    expect(atlas.hasRetired).toBe(true);
    atlas.releaseRetired(null);
    expect(retired?.destroyed).toBe(true);
    expect(atlas.retiredBytes).toBe(0);

    let index = 0;
    while (atlas.resolve(`W${index}-more`, 0) !== ATLAS_FULL) index += 1;
    expect(atlas.coverageSize).toBe(4_096);
    expect(atlas.growthCount).toBe(2);
    expect(atlas.capacityFailureCount).toBeGreaterThan(0);
    // At least the area of a 4096 atlas worth of 254x254 glyphs was placed.
    expect(atlas.glyphCount).toBeGreaterThan(200);
    atlas.dispose();
  });

  it("respects the device texture limit", () => {
    const h = createHarness(2_048);
    const atlas = new GlyphAtlas(h.device, METRICS);
    let index = 0;
    while (atlas.resolve(`W${index}`, 0) !== ATLAS_FULL) index += 1;
    expect(atlas.coverageSize).toBe(2_048);
    expect(atlas.growthCount).toBe(1);
    atlas.dispose();
  });

  it("flushes into a new epoch and reuses the whole area", () => {
    const h = createHarness();
    const atlas = new GlyphAtlas(h.device, METRICS);
    const epoch = atlas.epoch;
    atlas.resolve("A", 0);
    atlas.resolve("B", 0);
    atlas.flush();
    expect(atlas.epoch).toBe(epoch + 1);
    expect(atlas.glyphCount).toBe(0);
    expect(atlas.flushCount).toBe(1);
    expect(atlas.resolve("B", 0)).toBe(0);
    atlas.commit();
    // Only the new entry is uploaded.
    expect(
      h.writeBuffer.mock.calls[h.writeBuffer.mock.calls.length - 1]?.[4],
    ).toBe(GLYPH_ENTRY_WORDS);
    atlas.dispose();
  });

  it("grows the glyph table with its contents and retires the old buffer", () => {
    const h = createHarness();
    const atlas = new GlyphAtlas(h.device, METRICS);
    const generation = atlas.generation;
    const table = atlas.tableBuffer;
    for (let codepoint = 0x100; codepoint < 0x100 + 1_025; codepoint += 1) {
      expect(atlas.resolve(String.fromCodePoint(codepoint), 0)).not.toBe(
        ATLAS_FULL,
      );
    }
    expect(atlas.tableBuffer).not.toBe(table);
    expect(atlas.generation).toBeGreaterThan(generation);
    expect(atlas.hasRetired).toBe(true);
    atlas.commit();
    const call = h.writeBuffer.mock.calls[h.writeBuffer.mock.calls.length - 1];
    expect(call?.[1]).toBe(0);
    expect(call?.[4]).toBe(1_025 * GLYPH_ENTRY_WORDS);
    atlas.releaseRetired(null);
    atlas.dispose();
  });

  it("destroys retired resources only after the submission promise settles", async () => {
    const h = createHarness();
    const atlas = new GlyphAtlas(h.device, METRICS);
    for (let index = 0; index < 17; index += 1) atlas.resolve(`W${index}`, 0);
    const retired = h.textures.find(
      (t) => t.width === 1_024 && t.format === "r8unorm",
    );
    let settle: () => void = () => {};
    atlas.releaseRetired(new Promise<void>((resolve) => (settle = resolve)));
    expect(retired?.destroyed).toBe(false);
    settle();
    await Promise.resolve();
    await Promise.resolve();
    expect(retired?.destroyed).toBe(true);
    atlas.dispose();
  });

  it("releases every GPU and CPU byte when suspended and rebuilds on resume", () => {
    const h = createHarness();
    const atlas = new GlyphAtlas(h.device, METRICS);
    atlas.resolve("A", 0);
    atlas.resolve("COLOR", 0);
    const epoch = atlas.epoch;
    atlas.suspend();
    expect(atlas.byteSize).toBe(0);
    expect(atlas.cpuByteSize).toBe(0);
    expect(liveTextures(h.textures)).toHaveLength(0);
    expect(h.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(atlas.epoch).toBeGreaterThan(epoch);
    expect(() => atlas.resolve("A", 0)).toThrow("suspended");
    atlas.resume(h.device);
    expect(atlas.resolve("A", 0)).toBe(0);
    expect(atlas.byteSize).toBeGreaterThan(1_048_576);
    atlas.dispose();
    expect(() => atlas.resolve("A", 0)).toThrow("disposed");
  });

  it("cleans a partially built atlas when a texture allocation fails", () => {
    const h = createHarness();
    const destroy = vi.fn();
    const create = vi.mocked(h.device.createTexture);
    create.mockImplementationOnce(
      () => ({ createView: () => ({}), destroy }) as unknown as GPUTexture,
    );
    create.mockImplementationOnce(() => {
      throw new Error("allocation failed");
    });
    expect(() => new GlyphAtlas(h.device, METRICS)).toThrow(
      "allocation failed",
    );
    expect(destroy).toHaveBeenCalledOnce();
  });
});
