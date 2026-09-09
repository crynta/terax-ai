import { describe, expect, it, vi } from "vitest";
import type {
  TerminalFontMetrics,
  TerminalGpuTheme,
} from "../gpu/terminalVisuals";
import {
  MAX_WEBGL_RENDERER_SLOTS,
  WEBGL_RENDERER_IDLE_TTL_MS,
  type WebGlRuntimeDependencies,
  type WebGlRuntimeSurface,
  WebGlTerminalRuntime,
} from "./WebGlTerminalRuntime";
import type {
  WebGlRendererProfile,
  WebGlCellRenderer,
} from "./WebGlCellRenderer";

describe("WebGlTerminalRuntime", () => {
  it.each([true, false])(
    "retires a failed reconfiguration (idle: %s)",
    (idle) => {
      const h = createHarness();
      const runtime = new WebGlTerminalRuntime(h.dependencies);
      const surface = createSurface();
      runtime.acquire(surface, {} as HTMLElement, PROFILE);
      if (idle) runtime.release(surface);
      h.renderers[0].configure.mockImplementationOnce(() => {
        throw new Error("reconfigure failed");
      });
      expect(() =>
        runtime.acquire(surface, {} as HTMLElement, PROFILE),
      ).toThrow("reconfigure failed");
      expect(runtime.diagnostics().slotCount).toBe(0);
      expect(h.renderers[0].dispose).toHaveBeenCalledOnce();
      runtime.acquire(surface, {} as HTMLElement, PROFILE);
      expect(h.renderers).toHaveLength(2);
      runtime.dispose();
    },
  );

  it("interrupts an unfocused pacing timer for user input and returns to idle afterward", () => {
    const h = createHarness();
    h.windowFocused = false;
    const runtime = new WebGlTerminalRuntime(h.dependencies);
    const surface = createSurface();
    runtime.acquire(surface, {} as HTMLElement, PROFILE);
    runtime.schedule(surface);
    h.flushFrame();
    runtime.schedule(surface);
    expect(h.timers).toHaveLength(1);
    runtime.interact(surface);
    expect(h.timers).toHaveLength(0);
    expect(h.frames).toHaveLength(1);
    h.advanceTime(17);
    h.flushFrame();
    expect(surface.renderFrame).toHaveBeenCalledTimes(2);
    runtime.interact(surface);
    expect(h.frames).toHaveLength(0);
    expect(h.timers).toHaveLength(0);
    runtime.dispose();
  });

  it("coalesces surface work into one window-scoped frame", () => {
    const harness = createHarness();
    const runtime = new WebGlTerminalRuntime(harness.dependencies);
    const surface = createSurface();
    runtime.acquire(surface, {} as HTMLElement, PROFILE);

    runtime.schedule(surface);
    runtime.schedule(surface);
    runtime.schedule(surface);

    expect(harness.frames).toHaveLength(1);
    harness.flushFrame();
    expect(surface.renderFrame).toHaveBeenCalledTimes(1);
    expect(runtime.diagnostics()).toMatchObject({
      activeSlots: 1,
      dirtySurfaces: 0,
      submittedFrames: 1,
    });
    runtime.dispose();
  });

  it("paces sustained focused rendering at 60 frames per second", () => {
    const harness = createHarness();
    const runtime = new WebGlTerminalRuntime(harness.dependencies);
    const surface = createSurface();
    runtime.acquire(surface, {} as HTMLElement, PROFILE);

    runtime.schedule(surface);
    harness.flushFrame();
    runtime.schedule(surface);

    expect(harness.frames).toHaveLength(1);
    expect(harness.timers).toHaveLength(0);
    harness.advanceTime(17);
    harness.flushFrame();
    expect(surface.renderFrame).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it("bounds active contexts and retains only one warm idle renderer", () => {
    const harness = createHarness();
    const runtime = new WebGlTerminalRuntime(harness.dependencies);
    const surfaces = Array.from(
      { length: MAX_WEBGL_RENDERER_SLOTS },
      createSurface,
    );
    for (const surface of surfaces) {
      runtime.acquire(surface, {} as HTMLElement, PROFILE);
    }
    expect(runtime.diagnostics()).toMatchObject({
      slotCount: MAX_WEBGL_RENDERER_SLOTS,
      activeSlots: MAX_WEBGL_RENDERER_SLOTS,
    });
    expect(() =>
      runtime.acquire(createSurface(), {} as HTMLElement, PROFILE),
    ).toThrow(/pool exhausted/);

    for (const surface of surfaces) runtime.release(surface);
    harness.advanceTime(WEBGL_RENDERER_IDLE_TTL_MS + 1);
    harness.flushTimer();

    expect(runtime.diagnostics()).toMatchObject({
      slotCount: 1,
      activeSlots: 0,
      idleSlots: 1,
    });
    expect(
      harness.renderers.filter(
        (renderer) => renderer.dispose.mock.calls.length > 0,
      ),
    ).toHaveLength(MAX_WEBGL_RENDERER_SLOTS - 1);
    runtime.dispose();
  });

  it("keeps idle reclamation scheduled when another surface acquires a renderer", () => {
    const h = createHarness();
    const runtime = new WebGlTerminalRuntime(h.dependencies);
    const surfaces = [createSurface(), createSurface(), createSurface()];
    for (const surface of surfaces)
      runtime.acquire(surface, {} as HTMLElement, PROFILE);
    expect(h.timers).toHaveLength(0);
    runtime.release(surfaces[0]);
    runtime.release(surfaces[1]);
    runtime.acquire(createSurface(), {} as HTMLElement, PROFILE);
    h.advanceTime(WEBGL_RENDERER_IDLE_TTL_MS + 1);
    h.flushTimer();
    expect(runtime.diagnostics()).toMatchObject({
      activeSlots: 2,
      idleSlots: 0,
    });
    runtime.dispose();
  });

  it("does not submit frames while the webview is hidden", () => {
    const harness = createHarness();
    const runtime = new WebGlTerminalRuntime(harness.dependencies);
    const surface = createSurface();
    runtime.acquire(surface, {} as HTMLElement, PROFILE);

    harness.visible = false;
    runtime.schedule(surface);
    expect(harness.frames).toHaveLength(0);
    expect(runtime.diagnostics().dirtySurfaces).toBe(1);

    harness.visible = true;
    harness.notifyVisibility();
    expect(harness.frames).toHaveLength(1);
    harness.flushFrame();
    expect(surface.renderFrame).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it("cancels a pending frame when its final surface releases", () => {
    const harness = createHarness();
    const runtime = new WebGlTerminalRuntime(harness.dependencies);
    const surface = createSurface();
    runtime.acquire(surface, {} as HTMLElement, PROFILE);
    runtime.schedule(surface);
    runtime.release(surface);

    expect(harness.cancelledFrames).toEqual([1]);
    expect(runtime.diagnostics().dirtySurfaces).toBe(0);
    runtime.dispose();
  });

  it("rolls back a failed renderer acquisition without poisoning the pool", () => {
    const harness = createHarness({ failFirstConfigure: true });
    const runtime = new WebGlTerminalRuntime(harness.dependencies);
    expect(() =>
      runtime.acquire(createSurface(), {} as HTMLElement, PROFILE),
    ).toThrow("configure failed");
    expect(runtime.diagnostics()).toMatchObject({
      slotCount: 0,
      activeSlots: 0,
    });

    const surface = createSurface();
    runtime.acquire(surface, {} as HTMLElement, PROFILE);
    expect(runtime.diagnostics()).toMatchObject({
      slotCount: 1,
      activeSlots: 1,
    });
    runtime.dispose();
  });

  it("discards a poisoned renderer before reacquiring a fresh slot", () => {
    const harness = createHarness();
    const runtime = new WebGlTerminalRuntime(harness.dependencies);
    const surface = createSurface();
    runtime.acquire(surface, {} as HTMLElement, PROFILE);

    expect(runtime.discard(surface)).toBe(true);
    expect(harness.renderers[0].dispose).toHaveBeenCalledOnce();
    expect(runtime.diagnostics()).toMatchObject({
      slotCount: 0,
      activeSlots: 0,
    });

    runtime.acquire(surface, {} as HTMLElement, PROFILE);
    expect(harness.renderers).toHaveLength(2);
    expect(runtime.diagnostics().activeSlots).toBe(1);
    runtime.dispose();
  });

  it("destroys every idle context when the document is hidden", () => {
    const harness = createHarness();
    const runtime = new WebGlTerminalRuntime(harness.dependencies);
    const surface = createSurface();
    runtime.acquire(surface, {} as HTMLElement, PROFILE);
    runtime.release(surface);

    runtime.trimForHiddenDocument();

    expect(runtime.diagnostics()).toMatchObject({
      slotCount: 0,
      activeSlots: 0,
      idleSlots: 0,
    });
    expect(harness.renderers[0].dispose).toHaveBeenCalledOnce();
    runtime.dispose();
  });
});

type RendererDouble = {
  readonly configure: ReturnType<typeof vi.fn>;
  readonly resetModel: ReturnType<typeof vi.fn>;
  readonly attach: ReturnType<typeof vi.fn>;
  readonly detach: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly diagnostics: ReturnType<typeof vi.fn>;
};

function createHarness(options: { failFirstConfigure?: boolean } = {}) {
  let now = 0;
  let nextFrame = 1;
  let nextTimer = 100;
  let failedConfigure = false;
  let visibilityListener: (() => void) | null = null;
  let focusListener: ((focused: boolean) => void) | null = null;
  const frameCallbacks = new Map<number, () => void>();
  const timerCallbacks = new Map<number, () => void>();
  const renderers: RendererDouble[] = [];
  const cancelledFrames: number[] = [];

  const dependencies: WebGlRuntimeDependencies = {
    createRenderer: () => {
      const renderer: RendererDouble = {
        configure: vi.fn(() => {
          if (options.failFirstConfigure && !failedConfigure) {
            failedConfigure = true;
            throw new Error("configure failed");
          }
        }),
        resetModel: vi.fn(),
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
        diagnostics: vi.fn(() => ({
          cells: 0,
          glyphs: 0,
          atlasBytes: 1024,
          cpuBufferBytes: 2048,
          frames: 0,
          uploads: 0,
          contextRecoveries: 0,
        })),
      };
      renderers.push(renderer);
      return renderer as unknown as WebGlCellRenderer;
    },
    now: () => now,
    isVisible: () => harness.visible,
    isWindowFocused: () => harness.windowFocused,
    requestFrame: (callback) => {
      const handle = nextFrame;
      nextFrame += 1;
      frameCallbacks.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      cancelledFrames.push(handle);
      frameCallbacks.delete(handle);
    },
    setTimer: (callback) => {
      const handle = nextTimer;
      nextTimer += 1;
      timerCallbacks.set(handle, callback);
      return handle;
    },
    clearTimer: (handle) => timerCallbacks.delete(handle),
    bindVisibility: (callback) => {
      visibilityListener = callback;
      return () => {
        visibilityListener = null;
      };
    },
    bindWindowFocus: (callback) => {
      focusListener = callback;
      return () => {
        focusListener = null;
      };
    },
  };

  const harness = {
    visible: true,
    windowFocused: true,
    dependencies,
    renderers,
    cancelledFrames,
    get frames(): readonly number[] {
      return [...frameCallbacks.keys()];
    },
    get timers(): readonly number[] {
      return [...timerCallbacks.keys()];
    },
    advanceTime(delta: number): void {
      now += delta;
    },
    flushFrame(): void {
      const entry = frameCallbacks.entries().next().value;
      if (!entry) throw new Error("No frame is pending");
      const [handle, callback] = entry;
      frameCallbacks.delete(handle);
      callback();
    },
    flushTimer(): void {
      const entry = timerCallbacks.entries().next().value;
      if (!entry) throw new Error("No timer is pending");
      const [handle, callback] = entry;
      timerCallbacks.delete(handle);
      callback();
    },
    notifyVisibility(): void {
      visibilityListener?.();
    },
    notifyFocus(focused: boolean): void {
      focusListener?.(focused);
    },
  };
  return harness;
}

function createSurface(): WebGlRuntimeSurface & {
  readonly renderFrame: ReturnType<typeof vi.fn>;
} {
  return {
    renderFrame: vi.fn(() => true),
    handleRendererError: vi.fn(),
    isFocused: vi.fn(() => true),
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

const THEME: TerminalGpuTheme = {
  background: [0, 0, 0],
  foreground: [255, 255, 255],
  cursor: [255, 255, 255],
  selection: { color: [80, 80, 80], alpha: 0.5 },
  palette: [],
};

const PROFILE: WebGlRendererProfile = {
  metrics: METRICS,
  theme: THEME,
  scale: 1,
};
