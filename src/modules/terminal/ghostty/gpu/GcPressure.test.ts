import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GC_MIRROR_BATCH_BYTES,
  GC_MIRROR_FACTOR,
  GC_MIRROR_MAX_BYTES_PER_SECOND,
  allocateMirrorBuffer,
  GcPressureMirror,
  gcPressureOptionsFromStorage,
  NATIVE_BYTES_PER_FRAME,
} from "./GcPressure";

afterEach(() => vi.unstubAllGlobals());

describe("GcPressureMirror", () => {
  it("weighs a frame at ten times the native cost it pins", () => {
    const sizes: number[] = [];
    const mirror = new GcPressureMirror({
      allocate: (bytes) => sizes.push(bytes),
    });
    mirror.noteFrame();
    expect(sizes).toEqual([NATIVE_BYTES_PER_FRAME * GC_MIRROR_FACTOR]);
    expect(mirror.diagnostics()).toMatchObject({
      enabled: true,
      frames: 1,
      allocations: 1,
      bytesPerFrame: 129_000,
    });
  });

  it("allocates nothing until a batch of frames has built up", () => {
    const allocate = vi.fn();
    const mirror = new GcPressureMirror({
      bytesPerFrame: 12_900,
      batchBytes: GC_MIRROR_BATCH_BYTES,
      allocate,
    });
    const framesPerBatch = Math.ceil(GC_MIRROR_BATCH_BYTES / 12_900);
    for (let frame = 1; frame < framesPerBatch; frame++) mirror.noteFrame();
    expect(allocate).not.toHaveBeenCalled();
    mirror.noteFrame();
    expect(allocate).toHaveBeenCalledOnce();
  });

  /** A mirror on a fake clock, fed frames at a steady rate. */
  function run(framesPerSecond: number, seconds: number, options = {}) {
    const sizes: number[] = [];
    let clock = 0;
    const mirror = new GcPressureMirror({
      allocate: (bytes) => sizes.push(bytes),
      now: () => clock,
      ...options,
    });
    const frames = Math.round(framesPerSecond * seconds);
    for (let frame = 0; frame < frames; frame++) {
      clock += 1000 / framesPerSecond;
      mirror.noteFrame();
    }
    return {
      sizes,
      mirror,
      total: sizes.reduce((sum, bytes) => sum + bytes, 0),
    };
  }

  it("mirrors the whole cost without drifting over many frames", () => {
    const { sizes, total } = run(100, 60, {
      bytesPerFrame: 12_900,
      batchBytes: 64 * 1024,
    });
    // Under the cap everything owed is allocated except what is still below one batch.
    expect(total).toBeLessThanOrEqual(6_000 * 12_900);
    expect(6_000 * 12_900 - total).toBeLessThan(64 * 1024);
    expect(
      sizes.every((bytes) => bytes >= 64 * 1024 && bytes < 64 * 1024 + 12_900),
    ).toBe(true);
  });

  it("mirrors every frame of a 25 fps stream, the case the weight was measured at", () => {
    const { sizes, mirror } = run(25, 60);
    expect(sizes).toHaveLength(25 * 60);
    expect(new Set(sizes)).toEqual(new Set([129_000]));
    expect(mirror.diagnostics().allocations).toBe(25 * 60);
  });

  it("caps the mirrored bytes per second at the display rate instead of allocating a buffer per frame", () => {
    const seconds = 20;
    const { sizes, total, mirror } = run(120, seconds);
    const cap = GC_MIRROR_MAX_BYTES_PER_SECOND;
    // The old behaviour was 120 buffers of 129 KB a second (15 MB/s).
    expect(120 * seconds * 129_000).toBeGreaterThan(3 * cap * seconds);
    expect(total).toBeLessThanOrEqual(cap * seconds + cap / 4);
    // The allowance is used, not left idle: the cadence the collector sees is the 25 fps one.
    expect(total).toBeGreaterThan(cap * seconds * 0.9);
    expect(sizes.length).toBeLessThan(120 * seconds * 0.6);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(4 * GC_MIRROR_BATCH_BYTES);
    expect(mirror.diagnostics()).toMatchObject({
      frames: 120 * seconds,
      maxBytesPerSecond: cap,
    });
  });

  it("does not store up cost the cap held back: a stall is followed by one burst, not a debt", () => {
    const sizes: number[] = [];
    let clock = 0;
    const mirror = new GcPressureMirror({
      allocate: (bytes) => sizes.push(bytes),
      now: () => clock,
    });
    // A long run of frames in the same instant (a backlog drained at once).
    for (let frame = 0; frame < 5_000; frame++) mirror.noteFrame();
    const burst = sizes.reduce((sum, bytes) => sum + bytes, 0);
    expect(burst).toBeLessThanOrEqual(GC_MIRROR_MAX_BYTES_PER_SECOND / 4);
    sizes.length = 0;
    // Time passing refills at the cap; frames after it owe at most one burst.
    clock += 10_000;
    for (let frame = 0; frame < 5_000; frame++) mirror.noteFrame();
    expect(sizes.reduce((sum, bytes) => sum + bytes, 0)).toBeLessThanOrEqual(
      GC_MIRROR_MAX_BYTES_PER_SECOND / 4,
    );
  });

  it("can run uncapped for experiments", () => {
    const { sizes } = run(120, 5, { maxBytesPerSecond: 0 });
    expect(sizes).toHaveLength(600);
    // Frames in one instant (no time passes) are not special either.
    const same: number[] = [];
    const mirror = new GcPressureMirror({
      maxBytesPerSecond: 0,
      now: () => 0,
      allocate: (bytes) => same.push(bytes),
    });
    for (let frame = 0; frame < 50; frame++) mirror.noteFrame();
    expect(same).toHaveLength(50);
  });

  it("never allocates a buffer big enough to be a full collection's trigger", () => {
    const { sizes } = run(60, 600);
    expect(Math.max(...sizes)).toBeLessThan(1024 * 1024);
  });

  it("is inert when disabled", () => {
    const allocate = vi.fn();
    const mirror = new GcPressureMirror({ bytesPerFrame: 0, allocate });
    for (let frame = 0; frame < 10_000; frame++) mirror.noteFrame();
    expect(allocate).not.toHaveBeenCalled();
    expect(mirror.diagnostics().enabled).toBe(false);
  });

  it("allocates real ArrayBuffers by default", () => {
    const mirror = new GcPressureMirror({
      bytesPerFrame: 40_000,
      batchBytes: 64 * 1024,
    });
    mirror.noteFrame(2);
    expect(mirror.diagnostics().allocations).toBe(1);
    expect(mirror.diagnostics().allocatedBytes).toBe(80_000);
  });
});

describe("allocateMirrorBuffer", () => {
  const prototype = ArrayBuffer.prototype as { transfer?: unknown };
  const original = Object.getOwnPropertyDescriptor(prototype, "transfer");
  afterEach(() => {
    if (original) Object.defineProperty(prototype, "transfer", original);
    else delete prototype.transfer;
  });

  it("detaches the buffer at once when the engine can, so no pages stay resident", () => {
    const transfer = vi.fn();
    Object.defineProperty(prototype, "transfer", {
      value: transfer,
      configurable: true,
      writable: true,
    });
    allocateMirrorBuffer(65_536);
    expect(transfer).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("tolerates an engine without ArrayBuffer.prototype.transfer", () => {
    Object.defineProperty(prototype, "transfer", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(() => allocateMirrorBuffer(65_536)).not.toThrow();
  });

  it("is what a default mirror allocates with", () => {
    const transfer = vi.fn();
    Object.defineProperty(prototype, "transfer", {
      value: transfer,
      configurable: true,
      writable: true,
    });
    new GcPressureMirror({ bytesPerFrame: 40_000 }).noteFrame(2);
    expect(transfer).toHaveBeenCalledExactlyOnceWith(0);
  });
});

describe("gcPressureOptionsFromStorage", () => {
  const read = (value: string | null | Error) => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          if (value instanceof Error) throw value;
          return value;
        },
      },
    });
    return gcPressureOptionsFromStorage();
  };

  it("reads the override and ignores bad values", () => {
    expect(read(null)).toEqual({});
    expect(read("off")).toEqual({ bytesPerFrame: 0 });
    expect(read("20000")).toEqual({
      bytesPerFrame: 20000,
      batchBytes: undefined,
    });
    expect(read("20000:131072")).toEqual({
      bytesPerFrame: 20000,
      batchBytes: 131072,
    });
    expect(read("soon")).toEqual({
      bytesPerFrame: undefined,
      batchBytes: undefined,
    });
    expect(read(new Error("blocked"))).toEqual({});
  });
});
