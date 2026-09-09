import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  WebGpuRuntimeSurface,
  WebGpuSharedResources,
} from "./WebGpuTerminalRuntime";
import { WebGpuTerminalRuntime } from "./WebGpuTerminalRuntime";

const runtimes: WebGpuTerminalRuntime[] = [];
async function createRuntime() {
  const runtime = await WebGpuTerminalRuntime.create();
  runtimes.push(runtime);
  return runtime;
}

describe("WebGpuTerminalRuntime", () => {
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("coalesces all dirty surfaces into one window submission", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const first = createSurface();
    const second = createSurface();
    runtime.register(first);
    runtime.register(second);

    runtime.schedule(first);
    runtime.schedule(first);
    runtime.schedule(second);

    expect(harness.frames.size).toBe(1);
    harness.flushFrame();
    expect(first.renderFrame).toHaveBeenCalledOnce();
    expect(second.renderFrame).toHaveBeenCalledOnce();
    expect(harness.submit).toHaveBeenCalledOnce();
    expect(harness.onSubmittedWorkDone).toHaveBeenCalledOnce();
    expect(runtime.diagnostics()).toMatchObject({
      surfaceCount: 2,
      pendingSurfaces: 0,
      submittedFrames: 1,
    });
    runtime.dispose();
  });

  it("uses the RAF timestamp so callback jitter does not skip eligible frames", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    runtime.register(surface);
    for (let frame = 0; frame < 60; frame++) {
      runtime.schedule(surface);
      vi.advanceTimersByTime(frame % 2 ? 17 : 16);
      h.flushFrame((frame * 1_000) / 60);
      await Promise.resolve();
    }
    expect(surface.renderFrame).toHaveBeenCalledTimes(60);
  });

  it("retains dirty work while hidden and resumes once visible", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    runtime.register(surface);

    harness.setVisible(false);
    harness.notifyVisibility();
    runtime.schedule(surface);
    expect(harness.frames.size).toBe(0);
    expect(runtime.diagnostics().pendingSurfaces).toBe(1);

    harness.setVisible(true);
    harness.notifyVisibility();
    expect(surface.handleVisibilityChange).toHaveBeenCalledWith(true, false);
    expect(harness.frames.size).toBe(1);
    harness.flushFrame();
    expect(surface.renderFrame).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("cancels pending work and notifies surfaces when the window hides", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    runtime.register(surface);
    runtime.schedule(surface);

    harness.setVisible(false);
    harness.notifyVisibility();

    expect(surface.handleVisibilityChange).toHaveBeenCalledWith(false, false);
    expect(harness.cancelledFrames).toEqual([1]);
    expect(runtime.diagnostics().pendingSurfaces).toBe(1);
    runtime.dispose();
  });

  it("cancels a pending frame after its final surface unregisters", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    runtime.register(surface);
    runtime.schedule(surface);
    runtime.unregister(surface);

    expect(harness.cancelledFrames).toEqual([1]);
    expect(harness.frames.size).toBe(0);
    expect(runtime.diagnostics().pendingSurfaces).toBe(0);
    runtime.dispose();
  });

  it("bounds outstanding GPU frames and coalesces output while the GPU is stalled", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const completions: (() => void)[] = [];
    harness.onSubmittedWorkDone.mockImplementation(
      () =>
        new Promise<undefined>((resolve) =>
          completions.push(() => resolve(undefined)),
        ),
    );
    const runtime = await createRuntime();
    const surface = createSurface();
    runtime.register(surface);
    for (let frame = 0; frame < 2; frame++) {
      runtime.schedule(surface);
      vi.advanceTimersByTime(17);
      harness.flushFrame();
    }
    for (let update = 0; update < 10_000; update++) runtime.schedule(surface);
    vi.advanceTimersByTime(60_000);
    expect(harness.submit).toHaveBeenCalledTimes(2);
    expect(harness.frames.size).toBe(0);
    expect(runtime.diagnostics()).toMatchObject({
      inFlightFrames: 2,
      peakInFlightFrames: 2,
      pendingSurfaces: 1,
    });
    completions[0]();
    await Promise.resolve();
    expect(harness.frames.size).toBe(1);
    harness.flushFrame();
    expect(harness.submit).toHaveBeenCalledTimes(3);
    runtime.dispose();
    for (const complete of completions) complete();
    await Promise.resolve();
    expect(harness.frames.size).toBe(0);
  });

  it("defers device recreation while hidden and resumes it once visible", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    runtime.register(surface);
    harness.setVisible(false);
    harness.notifyVisibility();
    harness.loseDevice();
    await Promise.resolve();
    expect(harness.requestDevice).toHaveBeenCalledOnce();
    expect(harness.destroyDevice).toHaveBeenCalledOnce();
    expect(surface.handleVisibilityChange).toHaveBeenCalledWith(false, true);
    harness.setVisible(true);
    harness.notifyVisibility();
    await vi.waitFor(() =>
      expect(runtime.diagnostics().deviceRecoveries).toBe(1),
    );
    expect(harness.requestDevice).toHaveBeenCalledTimes(2);
    expect(surface.handleVisibilityChange).toHaveBeenLastCalledWith(
      true,
      false,
    );
    expect(harness.frames.size).toBe(1);
  });

  it("destroys a replacement device that arrives after runtime disposal", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    let deliver: (device: GPUDevice) => void = () => {};
    harness.requestDevice.mockImplementationOnce(
      () =>
        new Promise<GPUDevice>((resolve) => {
          deliver = resolve;
        }),
    );
    harness.loseDevice();
    await vi.waitFor(() =>
      expect(harness.requestDevice).toHaveBeenCalledTimes(2),
    );
    runtime.dispose();
    deliver(harness.device);
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.destroyDevice).toHaveBeenCalledTimes(2);
    expect(harness.frames.size).toBe(0);
    expect(runtime.diagnostics().deviceRecoveries).toBe(0);
  });

  it("quarantines a replacement that is lost while its pipelines are still compiling", async () => {
    const h = createHarness();
    const runtime = await createRuntime();
    let finishPipeline: (pipeline: GPURenderPipeline) => void = () => {};
    vi.mocked(h.device.createRenderPipelineAsync).mockImplementationOnce(
      () =>
        new Promise<GPURenderPipeline>((resolve) => {
          finishPipeline = resolve;
        }),
    );
    h.loseDevice();
    await vi.waitFor(() =>
      expect(h.device.createRenderPipelineAsync).toHaveBeenCalledTimes(4),
    );
    h.loseDevice();
    await Promise.resolve();
    expect(runtime.diagnostics().healthy).toBe(false);
    expect(h.requestDevice).toHaveBeenCalledTimes(2);
    finishPipeline({} as GPURenderPipeline);
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.diagnostics().deviceRecoveries).toBe(0);
    expect(h.frames.size).toBe(0);
  });

  it("releases the warm glyph atlas after the bounded idle window", async () => {
    vi.useFakeTimers();
    createHarness();
    const runtime = await createRuntime();
    const lease = runtime.acquireGlyphAtlas(METRICS, 1);

    expect(runtime.diagnostics()).toMatchObject({
      atlasCount: 1,
      unusedAtlasCount: 0,
    });
    lease.release();
    expect(runtime.diagnostics().unusedAtlasCount).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(runtime.diagnostics()).toMatchObject({
      atlasCount: 0,
      atlasBytes: 0,
      atlasCpuBytes: 0,
    });
    runtime.dispose();
  });

  it("defers idle atlas reclamation while uploads are encoded but unsubmitted", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const runtime = await createRuntime();
    const lease = runtime.acquireGlyphAtlas(METRICS, 1);
    const pending = vi
      .spyOn(lease.atlas, "hasEncodedUploads", "get")
      .mockReturnValue(true);
    lease.release();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runtime.diagnostics().atlasCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    pending.mockReturnValue(false);
    const surface = createSurface();
    runtime.register(surface);
    runtime.schedule(surface);
    h.flushFrame();
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.diagnostics().atlasCount).toBe(0);
  });

  it("releases hidden atlas textures while retaining one bounded warm glyph cache", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const runtime = await createRuntime();
    const lease = runtime.acquireGlyphAtlas(METRICS, 1);
    lease.release();

    harness.setVisible(false);
    harness.notifyVisibility();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(runtime.diagnostics()).toMatchObject({
      atlasCount: 1,
      atlasBytes: 0,
      atlasCpuBytes: 1_048_576,
    });
    harness.setVisible(true);
    harness.notifyVisibility();
    const restored = runtime.acquireGlyphAtlas(METRICS, 1);
    expect(restored.atlas).toBe(lease.atlas);
    expect(runtime.diagnostics().atlasBytes).toBe(1_048_580);
    restored.release();
    runtime.dispose();
  });

  it("rearms deferred atlas cleanup after submission without another dirty surface", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    let complete = () => {};
    h.onSubmittedWorkDone.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          complete = () => resolve(undefined);
        }),
    );
    const runtime = await createRuntime();
    const lease = runtime.acquireGlyphAtlas(METRICS, 1);
    const surface = createSurface();
    surface.renderFrame.mockImplementation((encoder) => {
      lease.atlas.glyph(65, null, 0);
      lease.atlas.encodePendingUploads(encoder);
      expect(lease.atlas.hasEncodedUploads).toBe(true);
      lease.release();
      expect(vi.getTimerCount()).toBe(0);
      return true;
    });
    runtime.register(surface);
    runtime.schedule(surface);
    h.flushFrame();
    expect(h.submit).toHaveBeenCalledOnce();
    expect(lease.atlas.hasEncodedUploads).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    expect(runtime.diagnostics().pendingSurfaces).toBe(0);
    complete();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runtime.diagnostics().atlasCount).toBe(0);
    expect(h.frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isolates a contended surface without duplicating normal atlas leases", async () => {
    createHarness();
    const runtime = await createRuntime();
    const first = runtime.acquireGlyphAtlas(METRICS, 1);
    const second = runtime.acquireGlyphAtlas(METRICS, 1);
    const isolated = runtime.acquireIsolatedGlyphAtlas(METRICS, 1, "surface-2");

    expect(first.atlas).toBe(second.atlas);
    expect(isolated.atlas).not.toBe(first.atlas);
    expect(first.isolated).toBe(false);
    expect(isolated.isolated).toBe(true);
    expect(runtime.diagnostics()).toMatchObject({
      atlasCount: 2,
      isolatedAtlasCount: 1,
      atlasResets: 0,
      atlasCapacityFailures: 0,
    });

    first.release();
    second.release();
    isolated.release();
    runtime.dispose();
  });

  it("redraws only the owner of an isolated atlas reset", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const first = createSurface();
    const second = createSurface();
    runtime.register(first);
    runtime.register(second);
    const shared = runtime.acquireGlyphAtlas(METRICS, 1, first);
    const isolated = runtime.acquireIsolatedGlyphAtlas(
      METRICS,
      1,
      "surface-2",
      second,
    );

    isolated.atlas.resetForRebuild();
    expect(runtime.diagnostics().pendingSurfaces).toBe(1);
    harness.flushFrame();
    expect(first.renderFrame).not.toHaveBeenCalled();
    expect(second.renderFrame).toHaveBeenCalledOnce();

    shared.release();
    isolated.release();
    runtime.dispose();
  });

  it("quarantines a device after an asynchronous validation error", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    runtime.register(surface);

    harness.reportValidationError("invalid texture upload");

    expect(surface.handleRuntimeError).toHaveBeenCalledOnce();
    expect(runtime.diagnostics()).toMatchObject({
      healthy: false,
      lastError: "WebGPU validation error: invalid texture upload",
      pendingSurfaces: 0,
      atlasCount: 0,
      atlasBytes: 0,
    });
    expect(harness.destroyDevice).toHaveBeenCalledOnce();
    expect(() => runtime.register(createSurface())).toThrow(
      "WebGPU terminal runtime is disabled",
    );
    runtime.dispose();
  });
});

function createHarness() {
  let visible = true;
  let visibilityListener: (() => void) | null = null;
  let uncapturedErrorListener:
    | ((event: { error: { message: string } }) => void)
    | null = null;
  let nextFrame = 1;
  const frames = new Map<number, (frameAt?: number) => void>();
  const cancelledFrames: number[] = [];
  const submit = vi.fn();
  const onSubmittedWorkDone = vi.fn(async () => undefined);
  const destroyDevice = vi.fn();
  let loseDevice: (info: GPUDeviceLostInfo) => void = () => {};
  const device = {
    addEventListener: vi.fn(
      (
        name: string,
        listener: (event: { error: { message: string } }) => void,
      ) => {
        if (name === "uncapturederror") uncapturedErrorListener = listener;
      },
    ),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createRenderPipelineAsync: vi.fn(async () => ({})),
    createSampler: vi.fn(() => ({})),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => ({
      width: (descriptor.size as number[])[0],
      height: (descriptor.size as number[])[1],
      format: descriptor.format,
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    })),
    createBuffer: vi.fn(({ size }: GPUBufferDescriptor) => ({
      size,
      getMappedRange: () => new ArrayBuffer(size),
      unmap: vi.fn(),
      destroy: vi.fn(),
    })),
    createCommandEncoder: vi.fn(() => ({
      finish: vi.fn(() => ({})),
      copyBufferToTexture: vi.fn(),
    })),
    destroy: destroyDevice,
    lost: new Promise<GPUDeviceLostInfo>((resolve) => {
      loseDevice = resolve;
    }),
    queue: { submit, onSubmittedWorkDone },
  } as unknown as GPUDevice;

  vi.stubGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2 });
  vi.stubGlobal("GPUTextureUsage", { COPY_DST: 1, TEXTURE_BINDING: 2 });
  vi.stubGlobal("GPUBufferUsage", { COPY_SRC: 1 });
  const requestDevice = vi.fn(async () => device);
  vi.stubGlobal("navigator", {
    gpu: {
      requestAdapter: vi.fn(async () => ({
        requestDevice,
      })),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    },
  });
  vi.stubGlobal("document", {
    get visibilityState() {
      return visible ? "visible" : "hidden";
    },
    addEventListener: vi.fn((name: string, listener: () => void) => {
      if (name === "visibilitychange") visibilityListener = listener;
    }),
    removeEventListener: vi.fn(),
    createElement: vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        clearRect: vi.fn(),
        measureText: () => ({}),
        fillText: vi.fn(),
        getImageData: (
          _x: number,
          _y: number,
          width: number,
          height: number,
        ) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
      })),
    })),
  });
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: (frameAt?: number) => void) => {
      const handle = nextFrame++;
      frames.set(handle, callback);
      return handle;
    },
  );
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    cancelledFrames.push(handle);
    frames.delete(handle);
  });

  return {
    frames,
    cancelledFrames,
    submit,
    onSubmittedWorkDone,
    destroyDevice,
    device,
    requestDevice,
    loseDevice() {
      const resolve = loseDevice;
      Object.assign(device, {
        lost: new Promise<GPUDeviceLostInfo>((done) => {
          loseDevice = done;
        }),
      });
      resolve({
        reason: "unknown",
        message: "simulated sleep loss",
      } as GPUDeviceLostInfo);
    },
    setVisible(value: boolean): void {
      visible = value;
    },
    notifyVisibility(): void {
      visibilityListener?.();
    },
    flushFrame(frameAt?: number): void {
      const entry = frames.entries().next().value;
      if (!entry) throw new Error("No WebGPU frame is pending");
      const [handle, callback] = entry;
      frames.delete(handle);
      callback(frameAt);
    },
    reportValidationError(message: string): void {
      uncapturedErrorListener?.({ error: { message } });
    },
  };
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

function createSurface() {
  return {
    renderFrame: vi.fn(
      (_encoder: GPUCommandEncoder, _resources: WebGpuSharedResources) => true,
    ),
    handleRuntimeReset: vi.fn(),
    handleRuntimeError: vi.fn(),
    handleVisibilityChange: vi.fn<(visible: boolean) => void>(),
    isFocused: vi.fn(() => true),
  } satisfies WebGpuRuntimeSurface;
}
