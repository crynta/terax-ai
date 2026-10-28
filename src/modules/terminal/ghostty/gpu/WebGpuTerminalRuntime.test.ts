import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebGpuRuntimeSurface } from "./WebGpuTerminalRuntime";
import { WebGpuTerminalRuntime } from "./WebGpuTerminalRuntime";
import type { CssRect } from "./PaneRects";

import {
  beginTerminalResizeInteraction,
  endTerminalResizeInteraction,
} from "@/modules/terminal/lib/terminalResizeInteraction";
import { resetTerminalResizeGestureForTest } from "@/modules/terminal/lib/terminalResizeGesture";

const GESTURE = {};
const runtimes: WebGpuTerminalRuntime[] = [];
async function createRuntime() {
  sharedArea = null;
  const runtime = await WebGpuTerminalRuntime.create();
  runtimes.push(runtime);
  return runtime;
}

describe("WebGpuTerminalRuntime", () => {
  afterEach(() => {
    endTerminalResizeInteraction(GESTURE);
    resetTerminalResizeGestureForTest();
    for (const runtime of runtimes.splice(0)) runtime.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates no encoder when dirty notifications resolve to unchanged pixels", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    join(runtime, surface);
    // The first frame of a window always draws.
    runtime.schedule(surface);
    h.flushFrame();
    expect(h.submit).toHaveBeenCalledOnce();
    vi.mocked(h.device.createCommandEncoder).mockClear();
    h.gpuContext.getCurrentTexture.mockClear();

    surface.prepareFrame.mockReturnValue(false);
    for (let notification = 0; notification < 20; notification++) {
      runtime.schedule(surface);
      vi.advanceTimersByTime(17);
      h.flushFrame();
    }
    expect(surface.prepareFrame).toHaveBeenCalledTimes(21);
    expect(h.device.createCommandEncoder).not.toHaveBeenCalled();
    expect(h.gpuContext.getCurrentTexture).not.toHaveBeenCalled();
    expect(h.submit).toHaveBeenCalledOnce();
  });

  it("coalesces all dirty surfaces into one window submission", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const first = createSurface();
    const second = createSurface();
    join(runtime, first);
    join(runtime, second);

    runtime.schedule(first);
    runtime.schedule(first);
    runtime.schedule(second);

    expect(harness.frames.size).toBe(1);
    harness.flushFrame();
    expect(first.prepareFrame).toHaveBeenCalledOnce();
    expect(second.prepareFrame).toHaveBeenCalledOnce();
    expect(harness.submit).toHaveBeenCalledOnce();
    // One canvas texture and one pass drew both panes.
    expect(harness.gpuContext.getCurrentTexture).toHaveBeenCalledOnce();
    expect(harness.pass.end).toHaveBeenCalledOnce();
    expect(first.encode).toHaveBeenCalledOnce();
    expect(second.encode).toHaveBeenCalledOnce();
    // One frame, one wait; both surfaces rode the same submission.
    expect(harness.onSubmittedWorkDone).toHaveBeenCalledOnce();
    expect(runtime.diagnostics()).toMatchObject({
      surfaceCount: 2,
      pendingSurfaces: 0,
      submittedFrames: 1,
      inFlightFrames: 1,
    });
    runtime.dispose();
  });

  it("uses the RAF timestamp so callback jitter does not skip eligible frames", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    join(runtime, surface);
    for (let frame = 0; frame < 60; frame++) {
      runtime.schedule(surface);
      vi.advanceTimersByTime(frame % 2 ? 17 : 16);
      h.flushFrame((frame * 1_000) / 60);
      await Promise.resolve();
    }
    expect(surface.prepareFrame).toHaveBeenCalledTimes(60);
  });

  it("retains dirty work while hidden and resumes once visible", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    join(runtime, surface);

    harness.setVisible(false);
    harness.notifyVisibility();
    runtime.schedule(surface);
    expect(harness.frames.size).toBe(0);
    expect(runtime.diagnostics().pendingSurfaces).toBe(1);

    harness.setVisible(true);
    harness.notifyVisibility();
    expect(surface.handleVisibilityChange).toHaveBeenCalledWith(true);
    expect(harness.frames.size).toBe(1);
    harness.flushFrame();
    expect(surface.prepareFrame).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("cancels pending work and notifies surfaces when the window hides", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    join(runtime, surface);
    runtime.schedule(surface);

    harness.setVisible(false);
    harness.notifyVisibility();

    expect(surface.handleVisibilityChange).toHaveBeenCalledWith(false);
    expect(harness.cancelledFrames).toEqual([1]);
    expect(runtime.diagnostics().pendingSurfaces).toBe(1);
    runtime.dispose();
  });

  it("cancels a pending frame after its final surface unregisters", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    join(runtime, surface);
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
    join(runtime, surface);
    for (let frame = 0; frame < 2; frame++) {
      runtime.schedule(surface);
      vi.advanceTimersByTime(17);
      harness.flushFrame();
    }
    for (let update = 0; update < 10_000; update++) runtime.schedule(surface);
    vi.advanceTimersByTime(60_000);
    expect(harness.submit).toHaveBeenCalledTimes(2);
    expect(harness.frames.size).toBe(0);
    // One wait at a time: the second frame is covered by the next wait, not a second one.
    expect(completions).toHaveLength(1);
    expect(runtime.diagnostics()).toMatchObject({
      inFlightFrames: 2,
      peakInFlightFrames: 2,
      pendingSurfaces: 1,
      workDoneWaits: 1,
    });
    expect(runtime.diagnostics().stalledFrameRequests).toBeGreaterThan(0);
    completions[0]();
    await Promise.resolve();
    // The first frame is confirmed, so a third may go while the second is still being waited on.
    expect(runtime.diagnostics().inFlightFrames).toBe(1);
    expect(completions).toHaveLength(2);
    expect(harness.frames.size).toBe(1);
    harness.flushFrame();
    expect(harness.submit).toHaveBeenCalledTimes(3);
    expect(runtime.diagnostics().inFlightFrames).toBe(2);
    runtime.dispose();
    for (const complete of completions) complete();
    await Promise.resolve();
    expect(harness.frames.size).toBe(0);
  });

  it("draws every prepared change in the frame that prepared it, whatever the GPU's pace", async () => {
    // Randomized pane output against a GPU that confirms work late and unevenly: a pane whose
    // prepareFrame reported a change must reach the same flush's submission, and once the GPU
    // catches up no dirty pane may be left behind (a lost change would sit undrawn until the
    // next unrelated one).
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
    join(runtime, surface);
    let seed = 11;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    // The first frame of a window always draws (it is dirty by itself); start from there.
    runtime.schedule(surface);
    harness.flushFrame(0);
    completions.shift()?.();
    await Promise.resolve();
    const baseline = harness.submit.mock.calls.length;
    let changedFlushes = 0;
    let owed = false;
    surface.prepareFrame.mockImplementation(() => {
      // Most flushes find a change; some find the damage resolved to nothing.
      owed = random() < 0.7;
      return owed;
    });
    let now = 0;
    for (let step = 0; step < 600; step++) {
      if (random() < 0.8) runtime.schedule(surface);
      now += 4 + random() * 20;
      vi.advanceTimersByTime(4 + random() * 20);
      if (random() < 0.5 && completions.length > 0) {
        completions.shift()?.();
        await Promise.resolve();
      }
      if (harness.frames.size === 0) continue;
      owed = false;
      const before = harness.submit.mock.calls.length;
      harness.flushFrame(now);
      const submitted = harness.submit.mock.calls.length - before;
      if (owed) changedFlushes += 1;
      expect(submitted).toBe(owed ? 1 : 0);
    }
    // The GPU catches up; whatever is still dirty must now be drawn.
    for (let settle = 0; settle < 50; settle++) {
      while (completions.length > 0) {
        completions.shift()?.();
        await Promise.resolve();
      }
      vi.advanceTimersByTime(40);
      now += 40;
      owed = false;
      surface.prepareFrame.mockImplementation(() => true);
      if (harness.frames.size > 0) {
        harness.flushFrame(now);
        changedFlushes += 1;
      }
    }
    expect(changedFlushes).toBeGreaterThan(40);
    expect(runtime.diagnostics().pendingSurfaces).toBe(0);
    expect(harness.submit.mock.calls.length - baseline).toBe(changedFlushes);
  });

  it("defers device recreation while hidden and resumes it once visible", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    join(runtime, surface);
    harness.setVisible(false);
    harness.notifyVisibility();
    harness.loseDevice();
    await Promise.resolve();
    expect(harness.requestDevice).toHaveBeenCalledOnce();
    expect(harness.destroyDevice).toHaveBeenCalledOnce();
    expect(surface.handleDeviceLoss).toHaveBeenCalledOnce();
    harness.setVisible(true);
    harness.notifyVisibility();
    await vi.waitFor(() =>
      expect(runtime.diagnostics().deviceRecoveries).toBe(1),
    );
    expect(harness.requestDevice).toHaveBeenCalledTimes(2);
    expect(surface.handleVisibilityChange).toHaveBeenLastCalledWith(true);
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
    const lease = runtime.acquireGlyphAtlas(METRICS);

    expect(runtime.diagnostics()).toMatchObject({
      atlasCount: 1,
      unusedAtlasCount: 0,
    });
    expect(runtime.diagnostics().atlasBytes).toBeGreaterThan(1_048_576);
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

  it("defers idle atlas reclamation while replaced resources await a submission", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const runtime = await createRuntime();
    const lease = runtime.acquireGlyphAtlas(METRICS);
    const retired = vi
      .spyOn(lease.atlas, "hasRetired", "get")
      .mockReturnValue(true);
    lease.release();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runtime.diagnostics().atlasCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    retired.mockReturnValue(false);
    const surface = createSurface();
    join(runtime, surface);
    runtime.schedule(surface);
    h.flushFrame();
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.diagnostics().atlasCount).toBe(0);
  });

  it("pauses through a long occlusion and releases no canvas, atlas texture or device", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    join(runtime, surface);
    runtime.schedule(surface);
    harness.flushFrame();
    const atlas = runtime.acquireGlyphAtlas(METRICS, surface);
    const atlasBytes = runtime.diagnostics().atlasBytes;
    expect(atlasBytes).toBeGreaterThan(1_048_576);
    const canvases = runtime.diagnostics().canvases;
    expect(canvases).toMatchObject({ active: 1, colorBytes: 800 * 600 * 4 });

    harness.setVisible(false);
    harness.notifyVisibility();
    runtime.schedule(surface);
    // Far past the old two second reclaim delay and the 30 second idle atlas lifetime.
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(surface.handleVisibilityChange).toHaveBeenLastCalledWith(false);
    expect(surface.handleDeviceLoss).not.toHaveBeenCalled();
    expect(harness.frames.size).toBe(0);
    expect(harness.destroyDevice).not.toHaveBeenCalled();
    expect(harness.gpuContext.unconfigure).not.toHaveBeenCalled();
    expect(runtime.diagnostics()).toMatchObject({
      atlasCount: 1,
      atlasBytes,
      canvases: {
        active: 1,
        idle: 0,
        destroyed: 0,
        colorBytes: 800 * 600 * 4,
        backingStoreResizes: 1,
      },
    });

    harness.setVisible(true);
    harness.notifyVisibility();
    expect(surface.handleVisibilityChange).toHaveBeenLastCalledWith(true);
    expect(harness.frames.size).toBe(1);
    // Resuming redraws the retained canvas without reallocating it.
    harness.flushFrame();
    expect(harness.submit).toHaveBeenCalledTimes(2);
    expect(runtime.diagnostics().canvases.backingStoreResizes).toBe(1);
    atlas.release();
    runtime.dispose();
  });

  it("keeps the window canvas through device recovery and points it at the new device", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    join(runtime, surface);
    runtime.schedule(surface);
    harness.flushFrame();
    expect(harness.gpuContext.configure).toHaveBeenCalledTimes(1);

    harness.loseDevice();
    await vi.waitFor(() =>
      expect(runtime.diagnostics().deviceRecoveries).toBe(1),
    );
    expect(surface.handleDeviceLoss).toHaveBeenCalledOnce();
    expect(runtime.diagnostics().canvases).toMatchObject({
      active: 1,
      created: 1,
      reconfigured: 1,
      destroyed: 0,
    });
    // Same element configured again for the new device, never unconfigured.
    expect(harness.gpuContext.configure).toHaveBeenCalledTimes(2);
    expect(harness.gpuContext.unconfigure).not.toHaveBeenCalled();
    expect(harness.canvasesCreated).toBe(1);
    // It redraws on the replacement device without reallocating.
    expect(harness.frames.size).toBe(1);
    harness.flushFrame();
    expect(runtime.diagnostics().canvases.backingStoreResizes).toBe(1);
  });

  it("tears its window canvases down only when the runtime is disposed", async () => {
    const harness = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    join(runtime, surface);
    runtime.schedule(surface);
    harness.flushFrame();
    runtime.unregister(surface);
    expect(harness.gpuContext.unconfigure).not.toHaveBeenCalled();
    expect(runtime.diagnostics().canvases).toMatchObject({
      idle: 1,
      destroyed: 0,
    });
    runtime.dispose();
    expect(harness.gpuContext.unconfigure).toHaveBeenCalledTimes(1);
  });

  it("draws every visible pane into its device rectangle with a scissor, in one pass", async () => {
    const h = createHarness();
    const runtime = await createRuntime();
    const area = createArea({ left: 10, top: 20, width: 800, height: 600 });
    const left = createSurface();
    const right = createSurface();
    join(runtime, left, { left: 10, top: 20, width: 399, height: 600 }, area);
    join(runtime, right, { left: 410, top: 20, width: 400, height: 600 }, area);
    runtime.schedule(left);
    runtime.schedule(right);
    h.flushFrame();

    expect(h.pass.setViewport.mock.calls).toEqual([
      [0, 0, 399, 600, 0, 1],
      [400, 0, 400, 600, 0, 1],
    ]);
    expect(h.pass.setScissorRect.mock.calls).toEqual([
      [0, 0, 399, 600],
      [400, 0, 400, 600],
    ]);
    // Viewport and scissor are set before each pane encodes.
    expect(left.encode.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.pass.setViewport.mock.invocationCallOrder[0],
    );
    expect(right.encode.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.pass.setScissorRect.mock.invocationCallOrder[1],
    );
  });

  it("redraws panes that did not change when a neighbour did, because canvas textures are not preserved", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const runtime = await createRuntime();
    const quiet = createSurface();
    const busy = createSurface();
    join(runtime, quiet, { ...FULL, width: 400 });
    join(runtime, busy, { ...FULL, left: 400, width: 400 });
    runtime.schedule(quiet);
    runtime.schedule(busy);
    h.flushFrame(performance.now());
    await vi.advanceTimersByTimeAsync(40);
    quiet.encode.mockClear();
    busy.encode.mockClear();

    quiet.prepareFrame.mockReturnValue(false);
    runtime.schedule(busy);
    runtime.schedule(quiet);
    await vi.advanceTimersByTimeAsync(40);
    h.flushFrame(performance.now());
    expect(h.submit).toHaveBeenCalledTimes(2);
    expect(quiet.encode).toHaveBeenCalledOnce();
    expect(busy.encode).toHaveBeenCalledOnce();
  });

  it("never reallocates, reconfigures or recreates the canvas on tab switches between different pane geometries", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const runtime = await createRuntime();
    const single = createSurface();
    const pair = [createSurface(), createSurface()];
    const fullBinding = join(runtime, single).binding;
    runtime.schedule(single);
    h.flushFrame();
    expect(runtime.diagnostics().canvases.backingStoreResizes).toBe(1);

    // Tab B: two panes of different geometry replace the single pane.
    const present = async () => {
      await vi.advanceTimersByTimeAsync(40);
      h.flushFrame();
    };
    for (let cycle = 0; cycle < 40; cycle++) {
      runtime.unregister(single);
      join(runtime, pair[0], { ...FULL, width: 399 });
      join(runtime, pair[1], { ...FULL, left: 401, width: 399 });
      runtime.schedule(pair[0]);
      runtime.schedule(pair[1]);
      await present();
      runtime.unregister(pair[0]);
      runtime.unregister(pair[1]);
      join(runtime, single);
      runtime.schedule(single);
      await present();
    }
    void fullBinding;

    expect(h.canvasesCreated).toBe(1);
    expect(runtime.diagnostics().canvases).toMatchObject({
      created: 1,
      destroyed: 0,
      backingStoreResizes: 1,
      reconfigured: 0,
    });
    expect(h.gpuContext.configure).toHaveBeenCalledTimes(1);
    expect(h.gpuContext.unconfigure).not.toHaveBeenCalled();
  });

  it("follows a divider drag with viewports only, and prepares the panes that moved at once whatever their pace", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const runtime = await createRuntime();
    const focused = createSurface();
    const background = createSurface();
    background.isFocused.mockReturnValue(false);
    const left = join(runtime, focused, { ...FULL, width: 400 });
    const right = join(runtime, background, { ...FULL, left: 400, width: 400 });
    runtime.schedule(focused);
    runtime.schedule(background);
    h.flushFrame(0);
    await vi.advanceTimersByTimeAsync(1);
    background.prepareFrame.mockClear();
    beginTerminalResizeInteraction(GESTURE);

    for (let step = 1; step <= 60; step++) {
      const divider = 400 + step * 4;
      left.binding?.setBounds({ ...FULL, width: divider });
      right.binding?.setBounds({
        ...FULL,
        left: divider,
        width: 800 - divider,
      });
      runtime.schedule(focused);
      vi.advanceTimersByTime(17);
      h.flushFrame(step * 17);
      await Promise.resolve();
    }
    endTerminalResizeInteraction(GESTURE);

    expect(runtime.diagnostics().canvases).toMatchObject({
      backingStoreResizes: 1,
      created: 1,
    });
    // The background pane would only present at its tick, but its rectangle moved every step.
    expect(background.prepareFrame.mock.calls.length).toBeGreaterThanOrEqual(
      60,
    );
    expect(h.pass.setViewport).toHaveBeenLastCalledWith(640, 0, 160, 600, 0, 1);
  });

  it("reallocates at most twice for a window drag, then compacts, and never destroys the canvas", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("screen", { availWidth: 1600, availHeight: 1000 });
    const h = createHarness();
    const runtime = await createRuntime();
    const area = createArea({ left: 0, top: 0, width: 800, height: 600 });
    const surface = createSurface();
    const { binding } = join(runtime, surface, FULL, area);
    runtime.schedule(surface);
    h.flushFrame(0);
    const resizes = () => runtime.diagnostics().canvases.backingStoreResizes;
    expect(resizes()).toBe(1);
    Object.assign(window, { innerWidth: 800, innerHeight: 600 });
    beginTerminalResizeInteraction(GESTURE);

    const step = async (width: number, height: number) => {
      Object.assign(window, { innerWidth: width, innerHeight: height });
      binding?.setBounds({ left: 0, top: 0, width, height });
      h.resizeArea(area, width, height);
      runtime.schedule(surface);
      await vi.advanceTimersByTimeAsync(17);
      h.flushFrame(performance.now());
    };
    // Shrink to a third, grow back: no reallocation at all.
    for (let width = 800; width >= 270; width -= 10)
      await step(width, Math.round(width * 0.75));
    for (let width = 270; width <= 800; width += 10)
      await step(width, Math.round(width * 0.75));
    expect(resizes()).toBe(1);
    // Past the original size: one allocation, to the room the screen leaves.
    for (let width = 800; width <= 1200; width += 10)
      await step(width, Math.round(width * 0.75));
    expect(resizes()).toBe(2);
    expect(h.canvasesCreated).toBe(1);
    expect(runtime.diagnostics().canvases.windows[0]).toMatchObject({
      width: 1600,
      height: 1000,
    });

    // The gesture ends: the canvas compacts to the area once.
    endTerminalResizeInteraction(GESTURE);
    await vi.advanceTimersByTimeAsync(300);
    h.flushFrame(performance.now());
    expect(resizes()).toBe(3);
    expect(runtime.diagnostics().canvases.windows[0].width).toBeLessThan(1400);
    expect(h.gpuContext.unconfigure).not.toHaveBeenCalled();
  });

  it("hides the canvas, keeping its size, when the last pane leaves", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    join(runtime, surface);
    runtime.schedule(surface);
    h.flushFrame();
    const canvas = vi
      .mocked(document.createElement)
      .mock.results.find(
        (r) => (r.value as { getContext?: unknown }).getContext,
      )?.value as {
      style: { visibility: string };
      width: number;
      height: number;
    };
    expect(canvas.style.visibility).toBe("visible");
    runtime.unregister(surface);
    await vi.advanceTimersByTimeAsync(300);
    expect(canvas.style.visibility).toBe("hidden");
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(runtime.diagnostics().canvases).toMatchObject({
      idle: 1,
      active: 0,
    });
    expect(h.frames.size).toBe(0);
  });

  it("gives a remounted terminal area the canvas the old one left, instead of a new one", async () => {
    const h = createHarness();
    const runtime = await createRuntime();
    const first = createSurface();
    const oldArea = createArea();
    join(runtime, first, FULL, oldArea);
    runtime.schedule(first);
    h.flushFrame();
    runtime.unregister(first);
    oldArea.isConnected = false;

    const newArea = createArea();
    const second = createSurface();
    join(runtime, second, FULL, newArea);
    runtime.schedule(second);
    h.flushFrame();
    expect(h.canvasesCreated).toBe(1);
    expect(runtime.diagnostics().canvases).toMatchObject({
      created: 1,
      reused: 1,
      destroyed: 0,
    });
    expect(newArea.insertBefore).toHaveBeenCalledOnce();
  });

  it("draws two terminal areas in one submission", async () => {
    const h = createHarness();
    const runtime = await createRuntime();
    const a = createSurface();
    const b = createSurface();
    join(runtime, a, FULL, createArea());
    join(runtime, b, FULL, createArea());
    runtime.schedule(a);
    runtime.schedule(b);
    h.flushFrame();
    expect(h.canvasesCreated).toBe(2);
    expect(h.gpuContext.getCurrentTexture).toHaveBeenCalledTimes(2);
    expect(h.submit).toHaveBeenCalledOnce();
  });

  it("lets a pane lift its DOM background once the GPU finished its first frame", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    join(runtime, surface);
    runtime.schedule(surface);
    h.flushFrame(performance.now());
    expect(surface.handleCanvasRevealed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40);
    expect(surface.handleCanvasRevealed).toHaveBeenCalledOnce();
    // Later frames do not reveal again.
    runtime.schedule(surface);
    await vi.advanceTimersByTimeAsync(40);
    h.flushFrame(performance.now());
    await vi.advanceTimersByTimeAsync(40);
    expect(h.submit).toHaveBeenCalledTimes(2);
    expect(surface.handleCanvasRevealed).toHaveBeenCalledOnce();
  });

  it("mirrors the native cost of every submitted frame to the garbage collector", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const runtime = await createRuntime();
    const surface = createSurface();
    join(runtime, surface);
    for (let frame = 0; frame < 30; frame++) {
      runtime.schedule(surface);
      await vi.advanceTimersByTimeAsync(40);
      h.flushFrame(performance.now());
    }
    const mirror = runtime.diagnostics().gcMirror;
    expect(mirror.frames).toBe(runtime.diagnostics().submittedFrames);
    expect(mirror.frames).toBe(30);
    expect(mirror.allocations).toBeGreaterThan(0);
    expect(mirror.allocatedBytes).toBeGreaterThan(0);
    expect(mirror.allocatedBytes).toBeLessThanOrEqual(
      30 * mirror.bytesPerFrame,
    );
  });

  describe("a shared glyph atlas", () => {
    /**
     * A pane that binds the atlas's current table and texture the way the real surface does,
     * rasterizes glyphs when asked, and records any draw that names a destroyed resource.
     */
    function createAtlasPane(runtime: WebGpuTerminalRuntime) {
      const pane = createSurface();
      const state = {
        lease: null as ReturnType<
          WebGpuTerminalRuntime["acquireGlyphAtlas"]
        > | null,
        boundGeneration: 0,
        table: null as GPUBuffer | null,
        coverage: null as GPUTextureView | null,
        pending: [] as string[],
        indices: new Map<string, number>(),
        violations: [] as string[],
      };
      const atlas = () =>
        (state.lease as NonNullable<typeof state.lease>).atlas;
      const bind = () => {
        state.table = atlas().tableBuffer;
        state.coverage = atlas().coverageTextureView;
        state.boundGeneration = atlas().generation;
      };
      state.lease = runtime.acquireGlyphAtlas(METRICS, pane);
      bind();
      pane.prepareFrame.mockImplementation(() => {
        const texts = state.pending.splice(0);
        for (const text of texts)
          state.indices.set(text, atlas().resolve(text, 0));
        atlas().commit();
        if (state.boundGeneration !== atlas().generation) bind();
        return true;
      });
      const rebind = vi.fn(() => {
        if (state.boundGeneration !== atlas().generation) bind();
      });
      Object.assign(pane, { rebindAtlas: rebind });
      pane.drawable.mockImplementation(
        () => state.boundGeneration === atlas().generation,
      );
      const destroyed = (resource: { destroy: unknown } | null) =>
        resource !== null &&
        vi.mocked(resource.destroy as () => void).mock.calls.length > 0;
      pane.encode.mockImplementation(() => {
        if (destroyed(state.table)) state.violations.push("table");
        const texture = (state.coverage as unknown as { texture: GPUTexture })
          .texture;
        if (destroyed(texture)) state.violations.push("coverage texture");
      });
      return { pane, state, rebind };
    }

    /** Views remember their texture, so a draw can be checked against what was destroyed. */
    const trackTextures = (h: ReturnType<typeof createHarness>) =>
      vi
        .mocked(h.device.createTexture)
        .mockImplementation((descriptor: GPUTextureDescriptor) => {
          const texture = {
            width: (descriptor.size as number[])[0],
            height: (descriptor.size as number[])[1],
            format: descriptor.format,
            createView: vi.fn(() => ({ texture })),
            destroy: vi.fn(),
          };
          return texture as unknown as GPUTexture;
        });

    /** Lets the work-done promises resolve so retired resources are destroyed. */
    const settle = async () => {
      for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    };

    it("grows its glyph table under one pane while a split neighbour idles, without the neighbour drawing a destroyed resource", async () => {
      vi.useFakeTimers();
      const h = createHarness();
      trackTextures(h);
      const runtime = await createRuntime();
      const busy = createAtlasPane(runtime);
      const idle = createAtlasPane(runtime);
      join(runtime, busy.pane, { ...FULL, width: 400 });
      join(runtime, idle.pane, { ...FULL, left: 400, width: 400 });
      const atlas = busy.state.lease?.atlas as NonNullable<
        typeof busy.state.lease
      >["atlas"];
      expect(idle.state.lease?.atlas).toBe(atlas);

      // Both panes show some text.
      busy.state.pending.push("a", "b");
      idle.state.pending.push("x", "y", "z");
      runtime.schedule(busy.pane);
      runtime.schedule(idle.pane);
      h.flushFrame(0);
      await settle();
      const firstTable = atlas.tableBuffer;
      const idleIndices = new Map(idle.state.indices);
      const idleGeneration = idle.state.boundGeneration;
      idle.pane.prepareFrame.mockClear();

      // The busy pane rasterizes far more distinct glyphs than the 1,024-entry table holds.
      busy.state.pending.push(
        ...Array.from({ length: 1_300 }, (_, i) =>
          String.fromCodePoint(0x4e00 + i),
        ),
      );
      runtime.schedule(busy.pane);
      await vi.advanceTimersByTimeAsync(40);
      h.flushFrame(performance.now());
      // The idle pane did not prepare, yet it was rebound before the window encoded it.
      expect(idle.pane.prepareFrame).not.toHaveBeenCalled();
      expect(idle.rebind).toHaveBeenCalled();
      expect(atlas.tableBuffer).not.toBe(firstTable);
      expect(idle.state.boundGeneration).toBe(atlas.generation);
      expect(idle.state.boundGeneration).toBeGreaterThan(idleGeneration);
      expect(idle.pane.encode).toHaveBeenCalledTimes(2);
      await settle();
      // The retired table is gone once the frame completed ...
      expect(vi.mocked(firstTable.destroy)).toHaveBeenCalledOnce();

      // ... and the next frame draws the idle pane from the new one.
      busy.state.pending.push("!");
      runtime.schedule(busy.pane);
      await vi.advanceTimersByTimeAsync(40);
      h.flushFrame(performance.now());
      await settle();
      expect(idle.pane.encode).toHaveBeenCalledTimes(3);
      expect(idle.state.table).toBe(atlas.tableBuffer);
      expect(idle.state.violations).toEqual([]);
      expect(busy.state.violations).toEqual([]);
      expect(idle.pane.handleRuntimeError).not.toHaveBeenCalled();
      expect(runtime.diagnostics()).toMatchObject({
        healthy: true,
        lastError: null,
        atlasGrowths: 0,
      });
      expect(h.destroyDevice).not.toHaveBeenCalled();
      // The idle pane's glyphs keep their indices, and the new table holds their entries.
      for (const [text, index] of idleIndices)
        expect(atlas.resolve(text, 0)).toBe(index);
      const uploads = vi
        .mocked(h.device.queue.writeBuffer)
        .mock.calls.filter(([buffer]) => buffer === atlas.tableBuffer);
      const whole = uploads.find(([, offset]) => offset === 0);
      if (!whole) throw new Error("the new glyph table was not uploaded whole");
      const data = whole[2] as Uint32Array;
      const words = new Uint32Array(data.buffer, data.byteOffset, data.length);
      for (const index of idleIndices.values())
        expect(words[index * 4 + 1]).not.toBe(0);
    });

    it("prepares every pane that uses an atlas in the frame that flushes it, whatever its pace", async () => {
      vi.useFakeTimers();
      const h = createHarness();
      trackTextures(h);
      const runtime = await createRuntime();
      const focused = createAtlasPane(runtime);
      const background = createAtlasPane(runtime);
      background.pane.isFocused.mockReturnValue(false);
      join(runtime, focused.pane, { ...FULL, width: 400 });
      join(runtime, background.pane, { ...FULL, left: 400, width: 400 });
      focused.state.pending.push("a");
      background.state.pending.push("b");
      runtime.schedule(focused.pane);
      runtime.schedule(background.pane);
      h.flushFrame(0);
      await vi.advanceTimersByTimeAsync(1);
      focused.pane.prepareFrame.mockClear();
      background.pane.prepareFrame.mockClear();

      // A full atlas asks for a flush: every glyph index is invalid from this frame on.
      vi.advanceTimersByTime(8);
      const atlasEpoch = focused.state.lease?.atlas.epoch ?? 0;
      focused.state.lease?.requestFlush();
      // The first frame the pacer allows: the focused pane is due, the background one is not.
      for (let wait = 0; wait < 200 && h.frames.size === 0; wait++)
        await vi.advanceTimersByTimeAsync(1);
      h.flushFrame(performance.now());
      expect(focused.state.lease?.atlas.epoch).toBeGreaterThan(atlasEpoch);
      // The background pane's tick is far off, but its uploaded cells name flushed indices.
      expect(focused.pane.prepareFrame).toHaveBeenCalledOnce();
      expect(background.pane.prepareFrame).toHaveBeenCalledOnce();
    });
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
  const texture = { createView: vi.fn(() => ({})) };
  const gpuContext = {
    configure: vi.fn(),
    unconfigure: vi.fn(),
    getCurrentTexture: vi.fn(() => texture),
  };
  const pass = {
    setViewport: vi.fn(),
    setScissorRect: vi.fn(),
    end: vi.fn(),
  };
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
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      finish: vi.fn(() => ({})),
      beginRenderPass: vi.fn(() => pass),
      copyTextureToTexture: vi.fn(),
    })),
    limits: { maxTextureDimension2D: 8_192 },
    destroy: destroyDevice,
    lost: new Promise<GPUDeviceLostInfo>((resolve) => {
      loseDevice = resolve;
    }),
    queue: {
      submit,
      onSubmittedWorkDone,
      writeBuffer: vi.fn(),
      writeTexture: vi.fn(),
    },
  } as unknown as GPUDevice;

  vi.stubGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2 });
  vi.stubGlobal("GPUTextureUsage", {
    COPY_DST: 1,
    TEXTURE_BINDING: 2,
    COPY_SRC: 4,
  });
  vi.stubGlobal("GPUBufferUsage", { STORAGE: 1, COPY_DST: 2 });
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
    createElement: vi.fn((tag: string) => ({
      width: tag === "canvas" ? 300 : 0,
      height: tag === "canvas" ? 150 : 0,
      style: {},
      setAttribute: vi.fn(),
      remove: vi.fn(),
      getContext: vi.fn((kind: string) =>
        kind === "webgpu"
          ? gpuContext
          : {
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
            },
      ),
    })),
  });
  const windowListeners: Array<[string, () => void]> = [];
  vi.stubGlobal("window", {
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: vi.fn((name: string, listener: () => void) =>
      windowListeners.push([name, listener]),
    ),
    removeEventListener: vi.fn(),
  });
  const observers: FakeResizeObserver[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class implements FakeResizeObserver {
      readonly targets: unknown[] = [];
      constructor(readonly callback: (entries: unknown[]) => void) {
        observers.push(this);
      }
      observe(target: unknown) {
        this.targets.push(target);
      }
      disconnect() {
        this.targets.length = 0;
      }
    },
  );
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

  const harness = {
    frames,
    cancelledFrames,
    pass,
    observers,
    windowListeners,
    submit,
    onSubmittedWorkDone,
    destroyDevice,
    gpuContext,
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
    /** The observer of an area reports a new size, as the engine does after layout. */
    resizeArea(area: FakeElement, width: number, height: number) {
      area.rect = { left: area.rect.left, top: area.rect.top, width, height };
      for (const observer of observers) {
        if (observer.targets.includes(area))
          observer.callback([
            {
              contentRect: { width, height },
              devicePixelContentBoxSize: [
                { inlineSize: width, blockSize: height },
              ],
            },
          ]);
      }
    },
    get canvasesCreated() {
      return vi
        .mocked(document.createElement)
        .mock.calls.filter(([tag]) => tag === "canvas").length;
    },
  };
  return harness;
}

type FakeResizeObserver = {
  readonly targets: unknown[];
  readonly callback: (entries: unknown[]) => void;
};

type FakeElement = {
  rect: CssRect;
  isConnected: boolean;
  insertBefore: ReturnType<typeof vi.fn>;
  getBoundingClientRect(): CssRect;
  closest(selector: string): FakeElement | null;
  parentElement: FakeElement | null;
};

/** A terminal area (what holds the window canvas) as the DOM would give it. */
function createArea(
  rect: CssRect = { left: 0, top: 0, width: 800, height: 600 },
): FakeElement {
  const area: FakeElement = {
    rect,
    isConnected: true,
    insertBefore: vi.fn(),
    getBoundingClientRect: () => area.rect,
    closest: () => area,
    parentElement: null,
  };
  return area;
}

/** A pane host inside an area. */
function createHost(area: FakeElement, rect: CssRect): FakeElement {
  const host: FakeElement = {
    rect,
    isConnected: true,
    insertBefore: vi.fn(),
    getBoundingClientRect: () => host.rect,
    closest: (selector) => (selector === "[data-terminal-area]" ? area : null),
    parentElement: area,
  };
  return host;
}

let sharedArea: FakeElement | null = null;
const FULL: CssRect = { left: 0, top: 0, width: 800, height: 600 };

/**
 * Registers a pane the way a surface does (with its host) and reports its layout, which the
 * real surface does from its resize observer.
 */
function join(
  runtime: WebGpuTerminalRuntime,
  surface: ReturnType<typeof createSurface>,
  rect: CssRect = FULL,
  area: FakeElement | null = null,
) {
  sharedArea ??= createArea();
  const target = area ?? sharedArea;
  const host = createHost(target, rect);
  const binding = runtime.register(surface, host as unknown as HTMLElement);
  binding?.setBounds(rect);
  return { binding, host, area: target };
}

const METRICS = {
  font: {
    family: "monospace",
    size: 14,
    lineHeight: 1.2,
    letterSpacing: 0,
    weight: "400",
  },
  scale: 1,
  deviceCellWidth: 8,
  deviceCellHeight: 16,
  deviceBaseline: 12,
  cellWidth: 8,
  cellHeight: 16,
  baseline: 12,
} as const;

function createSurface() {
  return {
    prepareFrame: vi.fn((_resources?: unknown, _budget?: unknown) => true),
    drawable: vi.fn(() => true),
    background: vi.fn(() => [10, 20, 30] as const),
    encode: vi.fn(),
    handleCanvasRevealed: vi.fn(),
    handleRuntimeReset: vi.fn(),
    handleRuntimeError: vi.fn(),
    handleVisibilityChange: vi.fn<(visible: boolean) => void>(),
    handleDeviceLoss: vi.fn(),
    isFocused: vi.fn(() => true),
  } satisfies WebGpuRuntimeSurface;
}
