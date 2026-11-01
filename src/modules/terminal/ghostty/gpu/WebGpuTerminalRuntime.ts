import { smoothHooks } from "@/bench/smoothHooks";
import { subscribeTerminalResizeInteraction } from "@/modules/terminal/lib/terminalResizeInteraction";
import { SurfaceFramePacer } from "@/modules/terminal/ghostty/SurfaceFramePacer";
import {
  subscribeWindowPresentation,
  terminalWindowPresentation,
} from "@/modules/terminal/ghostty/windowPresentation";
import type { WindowPresentation } from "@/modules/terminal/ghostty/WindowPresentationPolicy";
import {
  bindTerminalWindowFocus,
  terminalFrameIntervalMs,
  terminalWindowFocused,
} from "../renderScheduling";
import { GlyphAtlas } from "./GlyphAtlas";
import type { RasterBudget } from "./GlyphMap";
import {
  GcPressureMirror,
  gcPressureOptionsFromStorage,
  type GcPressureStats,
} from "./GcPressure";
import { BACKGROUND_SHADER, GLYPH_SHADER } from "./shaders";
import type { TerminalFontMetrics } from "./terminalVisuals";
import {
  findTerminalArea,
  type PaneBinding,
  WebGpuWindowCanvas,
  type WindowCanvasConfiguration,
  type WindowCanvasPane,
  type WindowCanvasStats,
  type WindowFrameStart,
  windowFrameNeeded,
} from "./WebGpuWindowCanvas";

const MAX_ATLAS_COUNT = 8;
const MAX_WARM_UNUSED_ATLASES = 1;
const ATLAS_IDLE_TTL_MS = 30_000;
const MAX_IN_FLIGHT_FRAMES = 2;
export const GPU_COMPLETION_TIMEOUT_MS = 5_000;
/** Glyph rasterization allowed per frame across all surfaces. */
export const RASTER_BUDGET_MS = 2;
/** Larger allowance for a surface's first frame, so text appears whole. */
export const FIRST_FRAME_RASTER_BUDGET_MS = 8;
const ATLAS_FLUSH_COOLDOWN_MS = 250;

export type WebGpuSharedResources = {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly backgroundPipeline: GPURenderPipeline;
  readonly glyphPipeline: GPURenderPipeline;
  readonly bindGroupLayout: GPUBindGroupLayout;
  /** Stands in for the search mask while no search is active. */
  readonly emptyStorage: GPUBuffer;
  readonly generation: number;
};

export interface WebGpuRuntimeSurface extends WindowCanvasPane {
  handleWindowFocus?(focused: boolean): void;
  /**
   * Uploads whatever changed since the last frame (cells, glyphs, uniform). True when the
   * pane's pixels differ and a window frame must draw them. Encodes nothing: the window
   * canvas draws every visible pane after all surfaces prepared.
   */
  prepareFrame(
    resources: WebGpuSharedResources,
    budget?: RasterBudget,
  ): boolean;
  /** The pane's first frame reached the screen: its DOM background can step aside. */
  handleCanvasRevealed?(): void;
  /**
   * The shared glyph atlas replaced a texture or its table since this pane bound them (another
   * pane grew it). Rebinds without uploading anything, so the pane never draws a destroyed
   * resource whatever its pace. Called after every pane prepared, before the window encodes.
   */
  rebindAtlas?(resources: WebGpuSharedResources): void;
  handleRuntimeReset(resources: WebGpuSharedResources): void;
  handleRuntimeError(error: Error): void;
  /** Pause or resume. Pausing stops rendering and timers and releases no GPU resource. */
  handleVisibilityChange(visible: boolean): void;
  /** The device is gone: drop what belongs to it, keep the canvas for the replacement. */
  handleDeviceLoss(): void;
  isFocused(): boolean;
}

type AtlasEntry = {
  readonly key: string;
  readonly users: Set<WebGpuRuntimeSurface>;
  readonly atlas: GlyphAtlas;
  references: number;
  lastUsed: number;
  flushRequested: boolean;
  lastFlush: number;
  /** Atlas generation the users were last rebound for (see `rebindAtlasUsers`). */
  seenGeneration: number;
};

export type GlyphAtlasLease = {
  readonly key: string;
  readonly atlas: GlyphAtlas;
  /**
   * The atlas is full at its largest size. The runtime flushes it before the
   * next frame; every user then re-rasterizes the glyphs it shows.
   */
  requestFlush(): void;
  release(): void;
};

export type WebGpuCanvasStats = {
  /** Window canvases with at least one pane, and the ones kept for the next area. */
  readonly active: number;
  readonly idle: number;
  readonly parked: number;
  readonly colorBytes: number;
  readonly created: number;
  readonly reused: number;
  readonly reconfigured: number;
  readonly destroyed: number;
  /** Backing-store allocations over all window canvases (a tab switch adds none). */
  readonly backingStoreResizes: number;
  readonly windowFrames: number;
  readonly windows: readonly WindowCanvasStats[];
};

export type WebGpuRuntimeStats = {
  readonly canvases: WebGpuCanvasStats;
  readonly gcMirror: GcPressureStats;
  readonly generation: number;
  readonly surfaceCount: number;
  readonly atlasCount: number;
  readonly atlasBytes: number;
  readonly atlasCpuBytes: number;
  readonly glyphCount: number;
  readonly atlasUploads: number;
  readonly atlasUploadedBytes: number;
  readonly unusedAtlasCount: number;
  readonly atlasFlushes: number;
  readonly atlasGrowths: number;
  readonly atlasCapacityFailures: number;
  readonly submittedFrames: number;
  readonly deviceRecoveries: number;
  readonly recoveryPending: boolean;
  readonly pendingSurfaces: number;
  readonly windowFocused: boolean;
  readonly targetFrameIntervalMs: number;
  readonly frameScheduled: boolean;
  readonly healthy: boolean;
  readonly lastError: string | null;
  readonly inFlightFrames: number;
  readonly peakInFlightFrames: number;
  readonly stagingBytes: number;
  /** Animation-frame callbacks run, and how many of them found no pane due. */
  readonly animationFrames: number;
  readonly idleAnimationFrames: number;
  /** Timer wakeups used to sleep until a frame is due. */
  readonly timerWakeups: number;
  /** `onSubmittedWorkDone` waits issued, and how long they took to resolve. */
  readonly workDoneWaits: number;
  readonly workDoneLatency: LatencyStats;
  /** Frame requests that found the in-flight bound reached and had to wait for a confirmation. */
  readonly stalledFrameRequests: number;
  /** Time from a pane turning dirty to the start of the frame that draws it. */
  readonly frameLatency: {
    readonly focused: LatencyStats;
    readonly background: LatencyStats;
  };
};

type LatencyStats = {
  readonly count: number;
  readonly sumMs: number;
  readonly maxMs: number;
};

class LatencyTracker {
  count = 0;
  sumMs = 0;
  maxMs = 0;
  record(ms: number): void {
    this.count += 1;
    this.sumMs += ms;
    if (ms > this.maxMs) this.maxMs = ms;
  }
  snapshot(): LatencyStats {
    return { count: this.count, sumMs: this.sumMs, maxMs: this.maxMs };
  }
}

export class WebGpuTerminalRuntime {
  /** One canvas per terminal area (a window has one); never destroyed while the runtime lives. */
  private readonly windows = new Map<HTMLElement, WebGpuWindowCanvas>();
  private readonly paneWindows = new Map<
    WebGpuRuntimeSurface,
    WebGpuWindowCanvas
  >();
  private windowsCreated = 0;
  private windowsDestroyed = 0;
  private windowsReused = 0;
  private readonly gcMirror = new GcPressureMirror(
    gcPressureOptionsFromStorage(),
  );
  private readonly surfaces = new Set<WebGpuRuntimeSurface>();
  private dirtySurfaces = new Set<WebGpuRuntimeSurface>();
  private renderSurfaces = new Set<WebGpuRuntimeSurface>();
  /**
   * Panes that must prepare in this frame whatever their pace: their rectangle changed, or an
   * atlas flush invalidated the glyph indices their uploaded cells name.
   */
  private readonly movedSurfaces = new Set<WebGpuRuntimeSurface>();
  private readonly atlases = new Map<string, AtlasEntry>();
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat = "bgra8unorm";
  private backgroundPipeline: GPURenderPipeline | null = null;
  private glyphPipeline: GPURenderPipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private emptyStorage: GPUBuffer | null = null;
  private animationFrame: number | null = null;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private frameTimerDueAt = 0;
  private atlasReapDeferred = false;
  private atlasReapTimer: ReturnType<typeof setTimeout> | null = null;
  private recovering: Promise<void> | null = null;
  private pendingRecoveryReason: string | null = null;
  private generation = 0;
  private submittedFrames = 0;
  /** Frames the GPU is not yet known to have finished: submitted minus confirmed. */
  private inFlightFrames = 0;
  private completionTimer: ReturnType<typeof setTimeout> | null = null;
  private confirmedFrames = 0;
  private peakInFlightFrames = 0;
  private animationFrames = 0;
  private idleAnimationFrames = 0;
  private timerWakeups = 0;
  private workDoneWaits = 0;
  private pendingWaits = 0;
  private stalledFrameRequests = 0;
  private readonly workDoneLatency = new LatencyTracker();
  private readonly focusedLatency = new LatencyTracker();
  private readonly backgroundLatency = new LatencyTracker();
  private latestWait: { through: number; completion: Promise<unknown> } | null =
    null;
  private deviceRecoveries = 0;
  private fatalError: Error | null = null;
  private windowFocused = terminalWindowFocused();
  private readonly pacer = new SurfaceFramePacer();
  private unbindWindowFocus: () => void = () => {};
  private unbindPresentation: () => void = () => {};
  private unbindResizeInteraction: () => void = () => {};
  private disposed = false;

  private constructor() {}

  static async create(): Promise<WebGpuTerminalRuntime> {
    const runtime = new WebGpuTerminalRuntime();
    try {
      await runtime.initializeDevice();
      runtime.unbindPresentation = subscribeWindowPresentation(
        runtime.handleVisibility,
      );
      runtime.unbindWindowFocus = bindTerminalWindowFocus(
        runtime.handleWindowFocus,
      );
      runtime.unbindResizeInteraction = subscribeTerminalResizeInteraction(
        runtime.handleResizeInteraction,
      );
      return runtime;
    } catch (error) {
      runtime.dispose();
      throw error;
    }
  }

  /**
   * Registers a surface for frames. With a `host` the surface also joins the window canvas of
   * the terminal area the host lives in and gets the binding through which it reports its
   * layout and reads its rectangle.
   */
  register(
    surface: WebGpuRuntimeSurface,
    host?: HTMLElement,
  ): PaneBinding | null {
    this.assertLive();
    this.assertHealthy();
    let binding: PaneBinding | null = null;
    if (host) binding = this.joinWindow(surface, host);
    this.surfaces.add(surface);
    surface.handleWindowFocus?.(this.windowFocused);
    const state = terminalWindowPresentation();
    surface.handleVisibilityChange(
      state.visible && !this.pendingRecoveryReason && !this.recovering,
    );
    this.armCompletionTimer();
    return binding;
  }

  unregister(surface: WebGpuRuntimeSurface): void {
    this.surfaces.delete(surface);
    if (this.surfaces.size === 0) this.clearCompletionTimer();
    this.dirtySurfaces.delete(surface);
    this.renderSurfaces.delete(surface);
    const target = this.paneWindows.get(surface);
    if (target) {
      this.paneWindows.delete(surface);
      target.removePane(surface);
      // The panes left in the window must clear what the departed one drew.
      this.scheduleWindow(target);
    }
    if (this.dirtySurfaces.size === 0) this.cancelScheduledFrame();
  }

  private joinWindow(
    surface: WebGpuRuntimeSurface,
    host: HTMLElement,
  ): PaneBinding {
    const area = findTerminalArea(host);
    let target = this.windows.get(area);
    if (!target) {
      // An area that is gone (a remounted stack) hands its canvas over: the element is never
      // destroyed, because WebKit would keep its swapchain.
      for (const [oldArea, candidate] of this.windows) {
        if (candidate.paneCount > 0 || oldArea.isConnected) continue;
        this.windows.delete(oldArea);
        target = candidate;
        this.windowsReused += 1;
        break;
      }
      if (!target) {
        const created: WebGpuWindowCanvas = new WebGpuWindowCanvas(
          this.canvasConfiguration(),
          { requestFrame: () => this.scheduleWindow(created) },
        );
        this.windowsCreated += 1;
        target = created;
      }
      this.windows.set(area, target);
    }
    target.reconfigure(this.canvasConfiguration());
    target.mount(area);
    this.paneWindows.set(surface, target);
    return target.addPane(surface, host);
  }

  private scheduleWindow(target: WebGpuWindowCanvas): void {
    const pane = target.firstPane() as WebGpuRuntimeSurface | undefined;
    if (pane) this.schedule(pane);
  }

  private canvasConfiguration(): WindowCanvasConfiguration {
    const resources = this.resources();
    return {
      device: resources.device,
      format: resources.format,
      generation: resources.generation,
    };
  }

  /** While a resize gesture is live every pane follows the layout at display rate. */
  private readonly handleResizeInteraction = (active: boolean): void => {
    this.pacer.setGesture(active);
    if (!this.disposed) this.requestFrame();
  };

  interact(surface: WebGpuRuntimeSurface): void {
    if (this.disposed || !this.surfaces.has(surface)) return;
    this.pacer.interact(surface, performance.now());
    if (this.frameTimer !== null) {
      clearTimeout(this.frameTimer);
      this.frameTimer = null;
    }
    this.requestFrame();
  }

  schedule(surface: WebGpuRuntimeSurface): void {
    if (this.disposed || this.fatalError || !this.surfaces.has(surface)) return;
    this.dirtySurfaces.add(surface);
    this.pacer.dirty(surface, performance.now());
    this.requestFrame();
  }

  acquireGlyphAtlas(
    metrics: TerminalFontMetrics,
    user?: WebGpuRuntimeSurface,
  ): GlyphAtlasLease {
    this.assertLive();
    const key = fontAtlasKey(metrics);
    let entry = this.atlases.get(key);
    if (!entry) {
      this.evictUnusedAtlas();
      if (this.atlases.size >= MAX_ATLAS_COUNT) {
        throw new Error(
          `Terminal glyph atlas budget exhausted (${MAX_ATLAS_COUNT} active atlases)`,
        );
      }
      entry = {
        key,
        users: new Set<WebGpuRuntimeSurface>(),
        atlas: new GlyphAtlas(this.resources().device, metrics),
        references: 0,
        lastUsed: performance.now(),
        flushRequested: false,
        lastFlush: Number.NEGATIVE_INFINITY,
        seenGeneration: 0,
      };
      entry.seenGeneration = entry.atlas.generation;
      this.atlases.set(key, entry);
    }
    const owned = entry;
    owned.atlas.resume(this.resources().device);
    owned.references += 1;
    if (user) owned.users.add(user);
    owned.lastUsed = performance.now();
    this.scheduleAtlasReap();

    let released = false;
    return {
      key,
      atlas: owned.atlas,
      requestFlush: () => {
        if (released || owned.flushRequested) return;
        owned.flushRequested = true;
        const wait =
          owned.lastFlush + ATLAS_FLUSH_COOLDOWN_MS - performance.now();
        if (wait <= 0) {
          for (const surface of owned.users) this.schedule(surface);
          return;
        }
        // A working set larger than the atlas must not flush every frame.
        setTimeout(() => {
          for (const surface of owned.users) this.schedule(surface);
        }, wait);
      },
      release: () => {
        if (released) return;
        released = true;
        owned.references = Math.max(0, owned.references - 1);
        if (user) owned.users.delete(user);
        owned.lastUsed = performance.now();
        this.scheduleAtlasReap();
      },
    };
  }

  resources(): WebGpuSharedResources {
    this.assertLive();
    if (
      !this.device ||
      !this.backgroundPipeline ||
      !this.glyphPipeline ||
      !this.bindGroupLayout ||
      !this.emptyStorage
    ) {
      throw new Error("WebGPU terminal runtime is not ready");
    }
    return {
      device: this.device,
      format: this.format,
      backgroundPipeline: this.backgroundPipeline,
      glyphPipeline: this.glyphPipeline,
      bindGroupLayout: this.bindGroupLayout,
      emptyStorage: this.emptyStorage,
      generation: this.generation,
    };
  }

  diagnostics(): WebGpuRuntimeStats {
    let atlasBytes = 0;
    let atlasCpuBytes = 0;
    let glyphCount = 0;
    let atlasUploads = 0;
    let atlasUploadedBytes = 0;
    let unusedAtlasCount = 0;
    let atlasFlushes = 0;
    let atlasGrowths = 0;
    let atlasCapacityFailures = 0;
    let stagingBytes = 0;
    for (const entry of this.atlases.values()) {
      atlasBytes += entry.atlas.byteSize;
      atlasCpuBytes += entry.atlas.cpuByteSize;
      glyphCount += entry.atlas.glyphCount;
      atlasUploads += entry.atlas.uploadCount;
      atlasUploadedBytes += entry.atlas.uploadedBytes;
      atlasFlushes += entry.atlas.flushCount;
      atlasGrowths += entry.atlas.growthCount;
      atlasCapacityFailures += entry.atlas.capacityFailureCount;
      stagingBytes += entry.atlas.retiredBytes;
      if (entry.references === 0) unusedAtlasCount += 1;
    }
    return {
      canvases: this.canvasStats(),
      gcMirror: this.gcMirror.diagnostics(),
      generation: this.generation,
      surfaceCount: this.surfaces.size,
      atlasCount: this.atlases.size,
      atlasBytes,
      atlasCpuBytes,
      glyphCount,
      atlasUploads,
      atlasUploadedBytes,
      unusedAtlasCount,
      atlasFlushes,
      atlasGrowths,
      atlasCapacityFailures,
      submittedFrames: this.submittedFrames,
      inFlightFrames: this.inFlightFrames,
      peakInFlightFrames: this.peakInFlightFrames,
      animationFrames: this.animationFrames,
      idleAnimationFrames: this.idleAnimationFrames,
      timerWakeups: this.timerWakeups,
      workDoneWaits: this.workDoneWaits,
      workDoneLatency: this.workDoneLatency.snapshot(),
      stalledFrameRequests: this.stalledFrameRequests,
      frameLatency: {
        focused: this.focusedLatency.snapshot(),
        background: this.backgroundLatency.snapshot(),
      },
      stagingBytes,
      deviceRecoveries: this.deviceRecoveries,
      recoveryPending:
        this.recovering !== null || this.pendingRecoveryReason !== null,
      pendingSurfaces: this.dirtySurfaces.size,
      windowFocused: this.windowFocused,
      targetFrameIntervalMs: terminalFrameIntervalMs(
        this.windowFocused,
        this.hasFocusedSurface(),
      ),
      frameScheduled: this.animationFrame !== null || this.frameTimer !== null,
      healthy: this.fatalError === null,
      lastError: this.fatalError?.message ?? null,
    };
  }

  private canvasStats(): WebGpuCanvasStats {
    const windows = [...this.windows.values()].map((target) =>
      target.diagnostics(),
    );
    let colorBytes = 0;
    let backingStoreResizes = 0;
    let windowFrames = 0;
    let reconfigured = 0;
    let active = 0;
    for (const stats of windows) {
      colorBytes += stats.colorBytes;
      backingStoreResizes += stats.reallocations;
      windowFrames += stats.frames;
      reconfigured += stats.reconfigured;
      if (stats.panes > 0) active += 1;
    }
    return {
      active,
      idle: windows.length - active,
      parked: 0,
      colorBytes,
      created: this.windowsCreated,
      reused: this.windowsReused,
      reconfigured,
      destroyed: this.windowsDestroyed,
      backingStoreResizes,
      windowFrames,
      windows,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unbindPresentation();
    this.unbindWindowFocus();
    this.unbindResizeInteraction();
    this.cancelScheduledFrame();
    if (this.atlasReapTimer !== null) clearTimeout(this.atlasReapTimer);
    this.atlasReapTimer = null;
    this.dirtySurfaces.clear();
    this.renderSurfaces.clear();
    this.surfaces.clear();
    for (const entry of this.atlases.values()) entry.atlas.dispose();
    this.atlases.clear();
    this.disposeWindows();
    this.releaseDevice();
  }

  /** Final teardown of the canvases: the runtime never presents again. */
  private disposeWindows(): void {
    for (const target of this.windows.values()) {
      target.dispose();
      this.windowsDestroyed += 1;
    }
    this.windows.clear();
    this.paneWindows.clear();
  }

  /**
   * Occlusion and sleep pause: no frame is scheduled and surfaces cancel their timers, but every
   * canvas, buffer and atlas texture stays exactly as it is (see WebGpuWindowCanvas for why).
   */
  private readonly handleVisibility = ({
    visible,
  }: WindowPresentation): void => {
    if (visible && (this.pendingRecoveryReason || this.recovering)) {
      if (this.pendingRecoveryReason)
        void this.recoverDevice(this.pendingRecoveryReason);
      return;
    }
    if (!visible) {
      this.cancelScheduledFrame();
      this.clearCompletionTimer();
    }
    for (const surface of this.surfaces) {
      surface.handleVisibilityChange(visible);
    }
    if (visible) {
      this.armCompletionTimer();
      this.pacer.reset();
      for (const target of this.windows.values()) target.markDirty();
      this.requestFrame();
    }
  };

  private readonly handleWindowFocus = (focused: boolean): void => {
    if (this.windowFocused === focused) return;
    this.windowFocused = focused;
    for (const surface of this.surfaces) surface.handleWindowFocus?.(focused);
    this.cancelScheduledFrame();
    this.requestFrame();
  };

  private requestFrame(): void {
    if (
      this.inFlightFrames >= MAX_IN_FLIGHT_FRAMES &&
      this.dirtySurfaces.size > 0
    )
      this.stalledFrameRequests += 1;
    if (
      this.disposed ||
      this.animationFrame !== null ||
      this.recovering ||
      this.pendingRecoveryReason ||
      this.inFlightFrames >= MAX_IN_FLIGHT_FRAMES ||
      this.fatalError ||
      this.dirtySurfaces.size === 0 ||
      !terminalWindowPresentation().visible
    ) {
      return;
    }
    const plan = this.pacer.plan(
      this.dirtySurfaces,
      this.windowFocused,
      performance.now(),
    );
    if (plan.kind === "idle") return;
    const now = performance.now();
    if (this.frameTimer !== null) {
      // A pane that turns dirty while the page sleeps for a later deadline (a background tick)
      // must not wait for that sleep: keep it only if it already ends in time.
      if (
        plan.kind === "wait" &&
        now + plan.delayMs >= this.frameTimerDueAt - 0.5
      )
        return;
      clearTimeout(this.frameTimer);
      this.frameTimer = null;
    }
    if (plan.kind === "wait") {
      // Sleep until a callback requested then lands on a vsync that can serve the deadline.
      this.frameTimerDueAt = now + plan.delayMs;
      this.frameTimer = setTimeout(() => {
        this.frameTimer = null;
        this.timerWakeups += 1;
        this.requestFrame();
      }, plan.delayMs);
      return;
    }
    this.animationFrame = requestAnimationFrame((frameAt) =>
      this.flushFrame(frameAt),
    );
  }

  private flushFrame(frameAt = performance.now()): void {
    const benchStart = __TERAX_BENCH__ ? performance.now() : 0;
    this.animationFrame = null;
    this.pacer.frameStarted(frameAt);
    this.animationFrames += 1;
    if (
      this.disposed ||
      this.recovering ||
      this.pendingRecoveryReason ||
      this.inFlightFrames >= MAX_IN_FLIGHT_FRAMES ||
      !terminalWindowPresentation().visible ||
      this.dirtySurfaces.size === 0
    )
      return;
    const batch = this.dirtySurfaces;
    this.dirtySurfaces = this.renderSurfaces;
    this.renderSurfaces = batch;
    try {
      const resources = this.resources();
      // Layout first: backing stores are committed and every pane's rectangle recomputed, so a
      // pane that moved can prepare against its new rectangle in this very frame whatever its
      // pace. Reads no DOM, except the occasional geometry check.
      const starts = new Map<WebGpuWindowCanvas, WindowFrameStart>();
      for (const target of this.windows.values()) {
        if (target.paneCount === 0) continue;
        target.verifyGeometry(frameAt);
        const start = target.beginFrame();
        starts.set(target, start);
        for (const pane of start.moved) {
          const surface = pane as WebGpuRuntimeSurface;
          if (!this.surfaces.has(surface)) continue;
          batch.add(surface);
          this.movedSurfaces.add(surface);
        }
      }
      const changed = new Set<WebGpuWindowCanvas>();
      let due = 0;
      // Flushes happen before any surface prepares, so no upload in this frame
      // can read indices that a later flush would invalidate.
      this.applyAtlasFlushes(batch);
      const budget = createRasterBudget(RASTER_BUDGET_MS);

      for (const surface of batch) {
        if (!this.surfaces.has(surface)) continue;
        if (
          !this.movedSurfaces.has(surface) &&
          !this.pacer.due(surface, this.windowFocused, frameAt)
        ) {
          this.dirtySurfaces.add(surface);
          continue;
        }
        due += 1;
        const waited = this.pacer.waited(surface, frameAt);
        if (waited !== undefined)
          (surface.isFocused()
            ? this.focusedLatency
            : this.backgroundLatency
          ).record(waited);
        // Before preparing: a change the upload itself schedules (a glyph backlog) is a new wait.
        this.pacer.settled(surface);
        try {
          if (surface.prepareFrame(resources, budget)) {
            this.pacer.presented(surface, frameAt);
            const target = this.paneWindows.get(surface);
            if (target) changed.add(target);
          }
        } catch (error) {
          surface.handleRuntimeError(toError(error));
        }
      }
      this.movedSurfaces.clear();
      // A pane that grew the shared atlas retired textures and the glyph table the other panes'
      // bind groups still name, whether or not those panes prepared in this frame. Rebind them
      // before anything is encoded and before the retired resources are released.
      this.rebindAtlasUsers(resources);

      if (due === 0) this.idleAnimationFrames += 1;
      // One command buffer for every window; a window with nothing new draws nothing and
      // acquires no texture.
      let encoder: GPUCommandEncoder | null = null;
      let rendered = false;
      const revealed: WebGpuRuntimeSurface[] = [];
      for (const [target, start] of starts) {
        if (
          !windowFrameNeeded({
            paneChanged: changed.has(target),
            dirty: target.isDirty,
            reallocated: start.reallocated,
            moved: start.moved.length,
            drawable: target.drawableCount(),
          })
        )
          continue;
        target.consumeDirty();
        encoder ??= resources.device.createCommandEncoder({
          label: "Terax terminal window frame",
        });
        const result = target.encode(encoder, resources);
        if (result.drawn > 0) rendered = true;
        for (const pane of result.revealed)
          revealed.push(pane as WebGpuRuntimeSurface);
      }
      let submitted = false;
      if (encoder && rendered) {
        resources.device.queue.submit([encoder.finish()]);
        this.submittedFrames += 1;
        if (__TERAX_BENCH__) {
          const now = performance.now();
          smoothHooks()?.frame(now, now - benchStart);
        }
        this.inFlightFrames += 1;
        submitted = true;
        this.gcMirror.noteFrame();
        this.peakInFlightFrames = Math.max(
          this.peakInFlightFrames,
          this.inFlightFrames,
        );
        // One wait at a time: frames submitted while it is pending are covered by the next one,
        // which starts as soon as this one resolves. A burst therefore costs a wait per GPU round
        // trip instead of one per frame, and a frame is held back only while two are unconfirmed.
        if (this.pendingWaits === 0) this.confirmFrames();
        if (revealed.length > 0) this.revealAfterPresent(revealed);
      }
      // Anything an atlas replaced this frame may still be named by commands
      // just submitted; without a submission nothing can reference it.
      let completion: Promise<unknown> | null = null;
      for (const entry of this.atlases.values()) {
        if (!entry.atlas.hasRetired) continue;
        if (submitted) completion ??= this.confirmFrames();
        entry.atlas.releaseRetired(completion);
      }
    } catch (error) {
      this.disable(toError(error));
    }
    batch.clear();
    if (this.atlasReapDeferred) {
      this.atlasReapDeferred = false;
      this.scheduleAtlasReap();
    }
    this.requestFrame();
  }

  /**
   * A pane's DOM background hides the canvas until its first frame is on screen; the runtime
   * lifts it once the GPU finished that frame, so tab switches never flash the card behind.
   */
  private revealAfterPresent(panes: readonly WebGpuRuntimeSurface[]): void {
    const generation = this.generation;
    void this.confirmFrames().then(
      () => {
        if (this.disposed || generation !== this.generation) return;
        for (const pane of panes) {
          if (this.surfaces.has(pane)) pane.handleCanvasRevealed?.();
        }
      },
      () => {},
    );
  }

  /**
   * Waits for everything submitted so far. Frames submitted afterwards are not covered, so the
   * bookkeeping is by count: a wait confirms the frames that existed when it was issued.
   */
  private confirmFrames(): Promise<unknown> {
    const through = this.submittedFrames;
    if (this.latestWait?.through === through) return this.latestWait.completion;
    const generation = this.generation;
    const completion = this.device?.queue.onSubmittedWorkDone();
    if (!completion) return Promise.resolve();
    this.workDoneWaits += 1;
    this.pendingWaits += 1;
    this.latestWait = { through, completion };
    this.armCompletionTimer();
    const issuedAt = performance.now();
    void completion.then(
      () => {
        if (this.disposed || generation !== this.generation) return;
        this.clearCompletionTimer();
        this.pendingWaits = Math.max(0, this.pendingWaits - 1);
        this.workDoneLatency.record(performance.now() - issuedAt);
        this.confirmedFrames = Math.max(this.confirmedFrames, through);
        this.inFlightFrames = Math.max(
          0,
          this.submittedFrames - this.confirmedFrames,
        );
        if (this.inFlightFrames > 0 && this.pendingWaits === 0)
          this.confirmFrames();
        this.armCompletionTimer();
        this.requestFrame();
      },
      (error: unknown) => {
        if (this.disposed || generation !== this.generation || this.fatalError)
          return;
        void this.recoverDevice(toError(error).message);
      },
    );
    return completion;
  }

  private armCompletionTimer(): void {
    if (
      this.completionTimer !== null ||
      this.pendingWaits === 0 ||
      this.surfaces.size === 0 ||
      this.disposed ||
      this.fatalError ||
      !terminalWindowPresentation().visible
    )
      return;
    this.completionTimer = setTimeout(() => {
      this.completionTimer = null;
      this.disable(new Error("WebGPU frame completion timed out"));
    }, GPU_COMPLETION_TIMEOUT_MS);
  }

  private clearCompletionTimer(): void {
    if (this.completionTimer !== null) clearTimeout(this.completionTimer);
    this.completionTimer = null;
  }

  private rebindAtlasUsers(resources: WebGpuSharedResources): void {
    for (const entry of this.atlases.values()) {
      const generation = entry.atlas.generation;
      if (generation === entry.seenGeneration) continue;
      entry.seenGeneration = generation;
      for (const surface of entry.users) {
        if (!this.surfaces.has(surface)) continue;
        try {
          surface.rebindAtlas?.(resources);
        } catch (error) {
          surface.handleRuntimeError(toError(error));
        }
      }
    }
  }

  /**
   * Flushes the atlases that asked for it (between frames, before any pane prepares). A flush
   * invalidates every glyph index, so each user prepares in this very frame whatever its pace:
   * a pane that waited for its tick would be drawn with indices that now name other glyphs.
   */
  private applyAtlasFlushes(batch: Set<WebGpuRuntimeSurface>): void {
    const now = performance.now();
    for (const entry of this.atlases.values()) {
      if (!entry.flushRequested || !entry.atlas.active) continue;
      if (now < entry.lastFlush + ATLAS_FLUSH_COOLDOWN_MS) continue;
      entry.flushRequested = false;
      entry.lastFlush = now;
      entry.atlas.flush();
      for (const surface of entry.users) {
        if (!this.surfaces.has(surface)) continue;
        batch.add(surface);
        this.movedSurfaces.add(surface);
      }
    }
  }

  private hasFocusedSurface(): boolean {
    for (const surface of this.surfaces) {
      if (surface.isFocused()) return true;
    }
    return false;
  }

  private cancelScheduledFrame(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    if (this.frameTimer !== null) clearTimeout(this.frameTimer);
    this.frameTimer = null;
  }

  private async initializeDevice(): Promise<void> {
    if (typeof navigator === "undefined" || !("gpu" in navigator)) {
      throw new Error("WebGPU is unavailable in this webview");
    }
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "low-power",
    });
    this.assertLive();
    if (!adapter) throw new Error("No compatible WebGPU adapter was found");
    const device = await adapter.requestDevice({
      label: "Terax shared terminal renderer",
    });
    if (this.disposed || this.fatalError) {
      device.destroy();
      this.assertLive();
      this.assertHealthy();
    }
    device.addEventListener("uncapturederror", (event) => {
      if (this.disposed || this.device !== device) return;
      this.disable(
        new Error(`WebGPU validation error: ${event.error.message}`),
      );
    });

    this.device = device;
    this.inFlightFrames = 0;
    this.pendingWaits = 0;
    this.confirmedFrames = this.submittedFrames;
    this.generation += 1;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    let initialized = false;
    const generation = this.generation;
    void device.lost.then((info) => {
      if (
        !this.disposed &&
        !this.fatalError &&
        generation === this.generation
      ) {
        const reason = info.message || String(info.reason);
        if (!initialized || this.recovering) {
          this.disable(
            new Error(
              `WebGPU device was lost during initialization: ${reason}`,
            ),
          );
        } else void this.recoverDevice(reason);
      }
    });
    await this.createSharedResources(device, this.format);
    this.assertLive();
    this.assertHealthy();
    initialized = true;
    const configuration = this.canvasConfiguration();
    for (const target of this.windows.values())
      target.reconfigure(configuration);
  }

  private async createSharedResources(
    device: GPUDevice,
    format: GPUTextureFormat,
  ): Promise<void> {
    const visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const storage = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility,
      buffer: { type: "read-only-storage" },
    });
    const atlasTexture = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: "unfilterable-float" },
    });
    this.bindGroupLayout = device.createBindGroupLayout({
      label: "Terax terminal bindings",
      entries: [
        { binding: 0, visibility, buffer: { type: "uniform" } },
        storage(1),
        storage(2),
        storage(3),
        storage(4),
        atlasTexture(5),
        atlasTexture(6),
      ],
    });
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

    const backgroundModule = device.createShaderModule({
      label: "Terax terminal background shader",
      code: BACKGROUND_SHADER,
    });
    const glyphModule = device.createShaderModule({
      label: "Terax terminal glyph shader",
      code: GLYPH_SHADER,
    });
    const [backgroundPipeline, glyphPipeline] = await Promise.all([
      device.createRenderPipelineAsync({
        label: "Terax terminal background pipeline",
        layout,
        vertex: { module: backgroundModule, entryPoint: "vertex_main" },
        fragment: {
          module: backgroundModule,
          entryPoint: "fragment_main",
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list" },
      }),
      device.createRenderPipelineAsync({
        label: "Terax terminal glyph pipeline",
        layout,
        vertex: { module: glyphModule, entryPoint: "vertex_main" },
        fragment: {
          module: glyphModule,
          entryPoint: "fragment_main",
          targets: [
            {
              format,
              blend: {
                color: {
                  srcFactor: "src-alpha",
                  dstFactor: "one-minus-src-alpha",
                },
                alpha: {
                  srcFactor: "one",
                  dstFactor: "one-minus-src-alpha",
                },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list" },
      }),
    ]);
    this.assertLive();
    this.assertHealthy();
    this.backgroundPipeline = backgroundPipeline;
    this.glyphPipeline = glyphPipeline;
    this.emptyStorage = device.createBuffer({
      label: "Terax terminal empty storage",
      size: 16,
      usage: GPUBufferUsage.STORAGE,
    });
  }

  private recoverDevice(reason: string): Promise<void> {
    if (this.disposed || this.fatalError) return Promise.resolve();
    if (this.recovering) return this.recovering;
    this.cancelScheduledFrame();
    if (!this.pendingRecoveryReason) {
      this.pendingRecoveryReason = reason;
      for (const surface of this.surfaces) surface.handleDeviceLoss();
      for (const entry of this.atlases.values()) entry.atlas.suspend();
      this.releaseDevice();
    }
    if (!terminalWindowPresentation().visible) return Promise.resolve();
    this.pendingRecoveryReason = null;
    this.recovering = (async () => {
      try {
        await this.initializeDevice();
        this.deviceRecoveries += 1;
        const state = terminalWindowPresentation();
        for (const surface of this.surfaces) {
          surface.handleVisibilityChange(state.visible);
          this.dirtySurfaces.add(surface);
        }
      } catch (error) {
        if (!this.disposed)
          this.disable(
            new Error(
              `WebGPU recovery failed after ${reason}: ${toError(error).message}`,
            ),
          );
      } finally {
        this.recovering = null;
        this.requestFrame();
      }
    })();
    return this.recovering;
  }

  private evictUnusedAtlas(): void {
    if (this.atlases.size < MAX_ATLAS_COUNT) return;
    let oldest: AtlasEntry | null = null;
    for (const entry of this.atlases.values()) {
      if (entry.references > 0 || entry.atlas.hasRetired) continue;
      if (!oldest || entry.lastUsed < oldest.lastUsed) oldest = entry;
    }
    if (!oldest) return;
    oldest.atlas.dispose();
    this.atlases.delete(oldest.key);
  }

  private scheduleAtlasReap(): void {
    if (this.atlasReapTimer !== null) clearTimeout(this.atlasReapTimer);
    this.atlasReapTimer = null;
    if (this.disposed) return;

    const unused = [...this.atlases.values()]
      .filter((entry) => entry.references === 0)
      .sort((left, right) => right.lastUsed - left.lastUsed);
    for (const entry of unused.slice(MAX_WARM_UNUSED_ATLASES)) {
      if (entry.atlas.hasRetired) {
        this.atlasReapDeferred = true;
        continue;
      }
      entry.atlas.dispose();
      this.atlases.delete(entry.key);
    }

    const warm = unused[0];
    if (!warm || !this.atlases.has(warm.key)) return;
    if (warm.atlas.hasRetired) {
      this.atlasReapDeferred = true;
      return;
    }
    const remaining = Math.max(
      1,
      Math.ceil(ATLAS_IDLE_TTL_MS - (performance.now() - warm.lastUsed)),
    );
    this.atlasReapTimer = setTimeout(() => {
      this.atlasReapTimer = null;
      this.reapIdleAtlas();
    }, remaining);
  }

  private reapIdleAtlas(): void {
    if (this.disposed) return;
    const now = performance.now();
    for (const entry of this.atlases.values()) {
      if (entry.references === 0 && now - entry.lastUsed >= ATLAS_IDLE_TTL_MS) {
        if (entry.atlas.hasRetired) {
          this.atlasReapDeferred = true;
          continue;
        }
        entry.atlas.dispose();
        this.atlases.delete(entry.key);
      }
    }
    this.scheduleAtlasReap();
  }

  private disable(error: Error): void {
    if (this.disposed || this.fatalError) return;
    this.fatalError = error;
    this.cancelScheduledFrame();
    this.dirtySurfaces.clear();
    this.renderSurfaces.clear();
    for (const surface of [...this.surfaces]) {
      surface.handleRuntimeError(error);
    }
    if (this.atlasReapTimer !== null) clearTimeout(this.atlasReapTimer);
    this.atlasReapTimer = null;
    for (const entry of this.atlases.values()) entry.atlas.dispose();
    this.atlases.clear();
    // The runtime never presents again, so its canvases have no further use.
    this.disposeWindows();
    this.releaseDevice();
  }

  /**
   * Drops the device. Window canvases stay in place and are reconfigured for the next
   * generation (`WebGpuWindowCanvas.reconfigure`), because destroying a presented one would
   * leave its swapchain behind.
   */
  private releaseDevice(): void {
    this.clearCompletionTimer();
    this.generation += 1;
    this.inFlightFrames = 0;
    this.pendingWaits = 0;
    this.confirmedFrames = this.submittedFrames;
    this.device?.destroy();
    this.device = null;
    this.backgroundPipeline = null;
    this.glyphPipeline = null;
    this.bindGroupLayout = null;
    this.emptyStorage = null;
  }

  private assertHealthy(): void {
    if (this.fatalError) {
      throw new Error(
        `WebGPU terminal runtime is disabled: ${this.fatalError.message}`,
      );
    }
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("WebGPU terminal runtime is disposed");
  }
}

let sharedRuntime: WebGpuTerminalRuntime | null = null;
let sharedRuntimePromise: Promise<WebGpuTerminalRuntime> | null = null;

export function getWebGpuTerminalRuntime(): Promise<WebGpuTerminalRuntime> {
  sharedRuntimePromise ??= WebGpuTerminalRuntime.create()
    .then((runtime) => {
      sharedRuntime = runtime;
      return runtime;
    })
    .catch((error) => {
      sharedRuntime = null;
      sharedRuntimePromise = null;
      throw error;
    });
  return sharedRuntimePromise;
}

export function webGpuTerminalRuntimeDiagnostics(): WebGpuRuntimeStats | null {
  return sharedRuntime?.diagnostics() ?? null;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void sharedRuntimePromise
      ?.then((runtime) => runtime.dispose())
      .catch(() => undefined);
    sharedRuntime = null;
    sharedRuntimePromise = null;
  });
}

function fontAtlasKey(metrics: TerminalFontMetrics): string {
  const font = metrics.font;
  return [
    font.family,
    font.size,
    font.weight,
    font.lineHeight,
    font.letterSpacing,
    metrics.scale,
    metrics.deviceCellWidth,
    metrics.deviceCellHeight,
    metrics.deviceBaseline,
  ].join("|");
}

/** A per-frame wall-clock allowance for glyph rasterization. */
export function createRasterBudget(limitMs: number): RasterBudget {
  const start = performance.now();
  return {
    exhausted: (allowanceMs = limitMs) =>
      performance.now() - start >= allowanceMs,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
