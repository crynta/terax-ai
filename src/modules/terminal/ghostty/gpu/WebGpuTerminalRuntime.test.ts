import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  WebGpuRuntimeSurface,
  WebGpuSharedResources,
} from "./WebGpuTerminalRuntime";
import { WebGpuTerminalRuntime } from "./WebGpuTerminalRuntime";

describe("WebGpuTerminalRuntime", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("coalesces all dirty surfaces into one window submission", async () => {
    const harness = createHarness();
    const runtime = await WebGpuTerminalRuntime.create();
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
    expect(harness.onSubmittedWorkDone).not.toHaveBeenCalled();
    expect(runtime.diagnostics()).toMatchObject({
      surfaceCount: 2,
      pendingSurfaces: 0,
      submittedFrames: 1,
    });
    runtime.dispose();
  });

  it("retains dirty work while hidden and resumes once visible", async () => {
    const harness = createHarness();
    const runtime = await WebGpuTerminalRuntime.create();
    const surface = createSurface();
    runtime.register(surface);

    harness.setVisible(false);
    runtime.schedule(surface);
    expect(harness.frames.size).toBe(0);
    expect(runtime.diagnostics().pendingSurfaces).toBe(1);

    harness.setVisible(true);
    harness.notifyVisibility();
    expect(surface.handleVisibilityChange).toHaveBeenCalledWith(true);
    expect(harness.frames.size).toBe(1);
    harness.flushFrame();
    expect(surface.renderFrame).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("cancels a pending frame after its final surface unregisters", async () => {
    const harness = createHarness();
    const runtime = await WebGpuTerminalRuntime.create();
    const surface = createSurface();
    runtime.register(surface);
    runtime.schedule(surface);
    runtime.unregister(surface);

    expect(harness.cancelledFrames).toEqual([1]);
    expect(harness.frames.size).toBe(0);
    expect(runtime.diagnostics().pendingSurfaces).toBe(0);
    runtime.dispose();
  });

  it("releases the warm glyph atlas after the bounded idle window", async () => {
    vi.useFakeTimers();
    createHarness();
    const runtime = await WebGpuTerminalRuntime.create();
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

  it("isolates a contended surface without duplicating normal atlas leases", async () => {
    createHarness();
    const runtime = await WebGpuTerminalRuntime.create();
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
    const runtime = await WebGpuTerminalRuntime.create();
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
    const runtime = await WebGpuTerminalRuntime.create();
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
  const frames = new Map<number, () => void>();
  const cancelledFrames: number[] = [];
  const submit = vi.fn();
  const onSubmittedWorkDone = vi.fn(async () => undefined);
  const destroyDevice = vi.fn();
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
    createTexture: vi.fn(() => ({
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    })),
    createCommandEncoder: vi.fn(() => ({ finish: vi.fn(() => ({})) })),
    destroy: destroyDevice,
    lost: new Promise<GPUDeviceLostInfo>(() => {}),
    queue: { submit, onSubmittedWorkDone },
  } as unknown as GPUDevice;

  vi.stubGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2 });
  vi.stubGlobal("GPUTextureUsage", { COPY_DST: 1, TEXTURE_BINDING: 2 });
  vi.stubGlobal("navigator", {
    gpu: {
      requestAdapter: vi.fn(async () => ({
        requestDevice: vi.fn(async () => device),
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
      getContext: vi.fn(() => ({})),
    })),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    const handle = nextFrame++;
    frames.set(handle, callback);
    return handle;
  });
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
    setVisible(value: boolean): void {
      visible = value;
    },
    notifyVisibility(): void {
      visibilityListener?.();
    },
    flushFrame(): void {
      const entry = frames.entries().next().value;
      if (!entry) throw new Error("No WebGPU frame is pending");
      const [handle, callback] = entry;
      frames.delete(handle);
      callback();
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
  } satisfies WebGpuRuntimeSurface;
}
