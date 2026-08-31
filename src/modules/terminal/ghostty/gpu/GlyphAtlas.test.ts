import { afterEach, describe, expect, it, vi } from "vitest";
import { GlyphAtlas, GlyphAtlasCapacityError } from "./GlyphAtlas";
import type { TerminalFontMetrics } from "./terminalVisuals";

describe("WebGPU GlyphAtlas", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("batches monochrome glyph coverage through one aligned staging copy", async () => {
    const harness = createHarness("monochrome");
    const atlas = new GlyphAtlas(harness.device, METRICS, 1, vi.fn());
    atlas.glyph(65, null, 0);
    atlas.glyph(66, null, 0);
    atlas.encodePendingUploads(harness.encoder);

    expect(atlas.hasEncodedUploads).toBe(true);
    expect(atlas.byteSize).toBe(1_048_580);
    expect(atlas.cpuByteSize).toBe(1_048_576);
    expect(harness.createBuffer).toHaveBeenCalledOnce();
    expect(harness.copyBufferToTexture).toHaveBeenCalledOnce();
    expect(harness.copyBufferToTexture.mock.calls[0][0].bytesPerRow).toBe(256);
    expect(atlas.uploadCount).toBe(1);
    expect(atlas.uploadedBytes).toBeGreaterThan(0);
    expect(harness.mappedBuffers[0].some((byte) => byte !== 0)).toBe(true);

    atlas.completeSubmission();
    await Promise.resolve();
    await Promise.resolve();
    expect(atlas.hasEncodedUploads).toBe(false);
    expect(harness.stagingDestroy).toHaveBeenCalledOnce();
    atlas.dispose();
  });

  it("allocates the fixed color atlas only after a native color glyph", () => {
    const harness = createHarness("color");
    const onReset = vi.fn();
    const atlas = new GlyphAtlas(harness.device, METRICS, 1, onReset);

    const glyph = atlas.glyph(0x1f600, null, 0);

    expect(glyph.intrinsicColor).toBe(true);
    expect(atlas.byteSize).toBe(2_097_152);
    expect(atlas.cpuByteSize).toBe(2_097_152);
    expect(onReset).toHaveBeenCalledOnce();
    atlas.dispose();
  });

  it("reports capacity without invalidating a shared atlas", () => {
    const harness = createHarness("large-monochrome");
    const onReset = vi.fn();
    const atlas = new GlyphAtlas(harness.device, METRICS, 1, onReset);

    for (let codepoint = 0x100; codepoint < 0x110; codepoint += 1) {
      atlas.glyph(codepoint, null, 0);
    }
    expect(() => atlas.glyph(0x110, null, 0)).toThrow(GlyphAtlasCapacityError);
    expect(atlas.generation).toBe(1);
    expect(atlas.capacityFailureCount).toBe(1);
    expect(onReset).not.toHaveBeenCalled();

    atlas.resetForRebuild();
    expect(atlas.generation).toBe(2);
    expect(atlas.resetCount).toBe(1);
    expect(onReset).toHaveBeenCalledOnce();
    atlas.dispose();
  });
});

function createHarness(mode: "monochrome" | "color" | "large-monochrome") {
  const stagingDestroy = vi.fn();
  const mappedBuffers: Uint8Array[] = [];
  const createBuffer = vi.fn((descriptor: GPUBufferDescriptor) => {
    const mapped = new ArrayBuffer(Number(descriptor.size));
    mappedBuffers.push(new Uint8Array(mapped));
    return {
      getMappedRange: vi.fn(() => mapped),
      unmap: vi.fn(),
      destroy: stagingDestroy,
    } as unknown as GPUBuffer;
  });
  const createTexture = vi.fn(() => ({
    createView: vi.fn(() => ({})),
    destroy: vi.fn(),
  })) as unknown as GPUDevice["createTexture"];
  const copyBufferToTexture = vi.fn();
  const encoder = { copyBufferToTexture } as unknown as GPUCommandEncoder;
  const queue = {
    onSubmittedWorkDone: vi.fn(async () => undefined),
  } as unknown as GPUQueue;
  const device = {
    createBuffer,
    createTexture,
    queue,
  } as unknown as GPUDevice;
  const large = mode === "large-monochrome";
  const pixelWidth = large ? 256 : 12;
  const pixelHeight = large ? 256 : 16;
  const pixels = new Uint8ClampedArray(pixelWidth * pixelHeight * 4);
  if (mode === "color") {
    pixels[0] = 255;
    pixels[1] = 80;
    pixels[2] = 20;
    pixels[3] = 255;
  } else {
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = 255;
    }
  }
  const context = {
    clearRect: vi.fn(),
    fillText: vi.fn(),
    getImageData: vi.fn(() => ({ data: pixels })),
    measureText: vi.fn(() => ({
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: large ? 252 : 8,
      actualBoundingBoxAscent: large ? 250 : 10,
      actualBoundingBoxDescent: 2,
    })),
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillStyle: "white",
  } as unknown as CanvasRenderingContext2D;
  vi.stubGlobal("document", {
    createElement: vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
    })),
  });
  vi.stubGlobal("GPUTextureUsage", { COPY_DST: 1, TEXTURE_BINDING: 2 });
  vi.stubGlobal("GPUBufferUsage", { COPY_SRC: 1 });
  return {
    device,
    encoder,
    createBuffer,
    copyBufferToTexture,
    stagingDestroy,
    mappedBuffers,
  };
}

const METRICS: TerminalFontMetrics = {
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
};
