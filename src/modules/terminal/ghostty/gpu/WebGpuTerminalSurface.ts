import { terminalWindowFocused } from "@/modules/terminal/ghostty/renderScheduling";
import { bindTerminalInteraction } from "@/modules/terminal/ghostty/input/terminalInteraction";
import {
  isClampedScrollEcho,
  TerminalScrollbarSync,
} from "@/modules/terminal/ghostty/gpu/terminalScrollbar";
import { terminalWindowPresentation } from "@/modules/terminal/ghostty/windowPresentation";
import type { TerminalSurface } from "@/modules/terminal/backend/contracts";
import { smoothHooks } from "@/bench/smoothHooks";
import { noteTerminalHostResize } from "@/modules/terminal/lib/terminalResizeGesture";
import {
  subscribeTerminalResizeInteraction,
  terminalResizeInteractionActive,
} from "@/modules/terminal/lib/terminalResizeInteraction";
import { TerminalResizeSync } from "@/modules/terminal/lib/terminalResizeSync";
import type { Rgb } from "../core/packedCells";
import type {
  GhosttyGpuFrame,
  GhosttyTerminalModelApi,
} from "../GhosttyTerminalModel";
import { GhosttySearchController } from "../search/GhosttySearchController";
import { TerminalSelectionController } from "../selection/TerminalSelectionController";
import { DevicePixelRatioMonitor } from "./DevicePixelRatioMonitor";
import { TerminalGlyphMap, type RasterBudget } from "./GlyphMap";
import { type DeviceRect, deviceRectsEqual } from "./PaneRects";
import { ScreenUniform, type ScreenUniformState } from "./ScreenUniform";
import { SCREEN_UNIFORM_BYTES } from "./shaders";
import { fitTerminalViewport } from "./TerminalFit";
import {
  TerminalFitQueue,
  type TerminalFitBounds,
  type TerminalFitQueueDiagnostics,
} from "./TerminalFitQueue";
import {
  cursorRect,
  decorationMetrics,
  leftOverhangPadding,
  NO_SELECTION,
  selectionUniform,
} from "./terminalGeometry";
import {
  devicePixelScale,
  metricsEqual,
  metricsForScale,
  rgbToCss,
  type TerminalFontMetrics,
  type TerminalGpuTheme,
} from "./terminalVisuals";
import {
  detectPlatform,
  textContrastFor,
  type TextContrast,
} from "./textContrast";
import {
  CELL_RECORD_BYTES,
  compactWebGpuCellCapacity,
  MAX_WEBGPU_SURFACE_CELLS,
  nextWebGpuCellCapacity,
  packSearchMask,
} from "./WebGpuCellBuffer";
import {
  createRasterBudget,
  FIRST_FRAME_RASTER_BUDGET_MS,
  type GlyphAtlasLease,
  getWebGpuTerminalRuntime,
  RASTER_BUDGET_MS,
  type WebGpuRuntimeSurface,
  type WebGpuSharedResources,
  type WebGpuTerminalRuntime,
} from "./WebGpuTerminalRuntime";
import type { PaneBinding } from "./WebGpuWindowCanvas";

const CURSOR_BLINK_MS = 600;
const TEXT_BLINK_MS = 600;
const TEXT_CONTRAST_STORAGE_KEY = "terax:terminal-text-contrast";

export type WebGpuTerminalSurfaceOptions = {
  readonly model: GhosttyTerminalModelApi;
  readonly metrics: TerminalFontMetrics;
  readonly theme: TerminalGpuTheme;
  readonly cursorBlink: boolean;
  readonly cursorStyle: "block" | "underline" | "bar";
  readonly onResize: (cols: number, rows: number) => void;
  readonly onError: (error: Error) => void;
  readonly onFirstFrame?: () => void;
  readonly onFrame?: () => void;
  readonly onRequestFocus?: () => void;
  readonly onOpenLink?: (uri: string) => void;
};

export type WebGpuTerminalSurfaceStats = {
  readonly frames: number;
  /** The pane's rectangle in the shared window canvas, device pixels; null before layout. */
  readonly viewport: DeviceRect | null;
  /** Grid changes applied (model and PTY resized together) and held back while a resize gesture was live. */
  readonly gridResizes: number;
  readonly deferredGridResizes: number;
  readonly cellCompactions: number;
  readonly cellCapacity: number;
  readonly bufferBytes: number;
  readonly cpuBufferBytes: number;
  readonly gpuBufferBytes: number;
  readonly canvasColorBytes: number;
  readonly estimatedSwapchainBytes: number;
  readonly cols: number;
  readonly rows: number;
  readonly scale: number;
  readonly deviceCellWidth: number;
  readonly deviceCellHeight: number;
  readonly visible: boolean;
  readonly documentSuspended: boolean;
  readonly focused: boolean;
  readonly uploads: number;
  readonly uploadedBytes: number;
  readonly pendingGlyphs: number;
  readonly fit: TerminalFitQueueDiagnostics;
};

/** App lab: stable id of a surface in the smoothness probe. */
let benchSurfaceSeq = 0;

export class WebGpuTerminalSurface
  implements TerminalSurface, WebGpuRuntimeSurface
{
  readonly backend = "ghostty-webgpu" as const;
  /** App lab: id of this surface in the smoothness probe. */
  readonly benchId = ++benchSurfaceSeq;

  private binding: PaneBinding | null = null;
  private readonly input = document.createElement("textarea");
  private readonly root = document.createElement("div");
  private readonly scrollbar = document.createElement("div");
  private readonly scrollbarContent = document.createElement("div");
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribeDamage: () => void;
  private readonly unsubscribeResizeInteraction: () => void;
  private readonly unsubscribeInteraction: () => void;
  private readonly selection: TerminalSelectionController;
  private readonly search: GhosttySearchController;
  private readonly pixelRatioMonitor: DevicePixelRatioMonitor;
  private readonly fitQueue = new TerminalFitQueue();
  private readonly resizeSync: TerminalResizeSync;
  /** Newest host measurement the grid has not followed yet (a resize gesture is live). */
  private heldBounds: TerminalFitBounds | null = null;
  private gridResizeCount = 0;
  private deferredGridResizeCount = 0;
  private atlasLease: GlyphAtlasLease | null = null;
  private glyphMap = new TerminalGlyphMap();
  private atlasBlocked = false;
  private uniformBuffer: GPUBuffer | null = null;
  private cellsBuffer: GPUBuffer | null = null;
  private glyphMapBuffer: GPUBuffer | null = null;
  private searchBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private bindGroupDirty = true;
  private readonly screen = new ScreenUniform();
  private searchScratch = new Uint8Array(0);
  private searchRevision = -1;
  private forcePresent = true;
  private needsResync = true;
  private blinkingCells = 0;
  private theme: TerminalGpuTheme;
  private metrics: TerminalFontMetrics;
  private contrast: TextContrast;
  private cellCapacity = 0;
  private host: HTMLElement | null = null;
  private visible = true;
  private readonly scrollbarSync = new TerminalScrollbarSync();
  private scrollbarViewportHeight = 0;
  private focused = false;
  private documentSuspended = !terminalWindowPresentation().visible;
  private runtimeRegistered = false;
  private resizeInteractionActive = terminalResizeInteractionActive();
  private compactAfterResize = false;
  private nativeCursorVisible = false;
  private windowFocused = terminalWindowFocused();
  private cursorVisible = true;
  private cursorEnabled = true;
  private cursorBlinking: boolean;
  private cursorTimer: number | null = null;
  private textBlinkVisible = true;
  private textBlinkTimer: number | null = null;
  private forceFullRedraw = true;
  private runtimeGeneration = 0;
  private frameCount = 0;
  private cellCompactionCount = 0;
  private uploadCount = 0;
  private uploadedBytes = 0;
  private contentRevision: number;
  private hoveredCell = -1;
  private hoveredLink: string | null = null;
  private mouseDownLink: string | null = null;
  private applyingFit = false;
  private disposed = false;
  /** The window canvas has shown this pane's first frame; until then its DOM covers the canvas. */
  private revealed = false;
  /** A frame was prepared and its bind group is ready, so the window canvas can draw the pane. */
  private hasFrame = false;
  /** Glyph instances of the last prepared frame. */
  private drawCells = 0;
  /** What the uniform last held, kept to repack it when only the pane's rectangle moves. */
  private lastScreenState: ScreenUniformState | null = null;

  private constructor(
    private readonly runtime: WebGpuTerminalRuntime,
    private readonly options: WebGpuTerminalSurfaceOptions,
  ) {
    this.metrics = metricsForScale(options.metrics, devicePixelScale());
    this.contrast = currentTextContrast(this.metrics.scale);
    this.pixelRatioMonitor = new DevicePixelRatioMonitor(() =>
      this.resizeToHost(),
    );
    this.resizeSync = new TerminalResizeSync({
      model: {
        get cols() {
          return options.model.cols;
        },
        get rows() {
          return options.model.rows;
        },
        resize: (cols, rows) => {
          this.applyingFit = true;
          try {
            options.model.resize(cols, rows);
          } finally {
            this.applyingFit = false;
          }
        },
      },
      notify: options.onResize,
    });
    this.cursorBlinking = options.cursorBlink;
    this.theme = options.theme;
    options.model.setCursorOptions(options.cursorStyle, options.cursorBlink);
    this.contentRevision = options.model.revision();
    this.root.className = "absolute inset-0 overflow-hidden";
    this.root.style.userSelect = "none";
    this.updateRootBackground();
    this.root.setAttribute("data-terax-ghostty-surface", "webgpu");
    this.root.setAttribute("data-terax-terminal-surface", "");
    this.input.setAttribute("aria-label", "Terminal input");
    this.input.setAttribute("autocapitalize", "off");
    this.input.setAttribute("autocomplete", "off");
    this.input.setAttribute("spellcheck", "false");
    this.input.style.cssText =
      "position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;resize:none;pointer-events:none;";
    this.scrollbar.setAttribute("aria-label", "Terminal scrollback");
    this.scrollbar.setAttribute("role", "scrollbar");
    this.scrollbar.style.cssText =
      "position:absolute;inset:0 0 0 auto;z-index:10;width:11px;overflow-x:hidden;overflow-y:scroll;overscroll-behavior:contain;visibility:hidden;";
    this.scrollbarContent.style.cssText = "width:1px;height:1px;";
    this.scrollbar.append(this.scrollbarContent);
    this.root.append(this.input, this.scrollbar);

    this.unsubscribeInteraction = bindTerminalInteraction(
      this.root,
      this.handleInteraction,
    );
    this.selection = new TerminalSelectionController({
      model: options.model,
      target: this.root,
      cellSize: () => this.cellSize(),
      gridShiftY: () => this.gridShiftY(),
      shouldIgnoreTarget: (target) =>
        target instanceof Node && this.scrollbar.contains(target),
      onChange: () => {
        if (this.applyingFit) return;
        this.runtime.schedule(this);
      },
    });
    this.search = new GhosttySearchController(options.model, () => {
      if (this.applyingFit) return;
      this.runtime.schedule(this);
    });

    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      noteTerminalHostResize(this);
      const bounds = this.boundsFromEntry(entry);
      if (__TERAX_BENCH__) this.benchWant(bounds);
      this.queueFit(bounds);
    });
    this.unsubscribeDamage = options.model.subscribeDamage(() => {
      if (!this.visible || this.documentSuspended || !this.host) return;
      this.cursorVisible = true;
      this.textBlinkVisible = true;
      this.search.invalidate();
      if (!this.applyingFit) this.runtime.schedule(this);
      this.armCursorBlink();
    });
    this.unsubscribeResizeInteraction = subscribeTerminalResizeInteraction(
      (active) => {
        this.resizeInteractionActive = active;
        if (active) return;
        // The gesture is over: the grid follows the final size once (one reflow, one SIGWINCH)
        // and what the drag grew is compacted. The host is measured when the fit runs, in the
        // next frame, not now: the last pointer move may not have been laid out yet.
        this.compactAfterResize = true;
        this.fitQueue.request();
        this.runtime.schedule(this);
      },
    );
    this.root.addEventListener("pointerdown", this.handlePointerDown);
    this.root.addEventListener("mousemove", this.handleLinkMouseMove);
    this.root.addEventListener("mousedown", this.handleLinkMouseDown);
    this.root.addEventListener("mouseup", this.handleLinkMouseUp);
    this.root.addEventListener("mouseleave", this.handleLinkMouseLeave);
    this.scrollbar.addEventListener("scroll", this.handleScroll);
  }

  static async create(
    options: WebGpuTerminalSurfaceOptions,
  ): Promise<WebGpuTerminalSurface> {
    const runtime = await getWebGpuTerminalRuntime();
    return new WebGpuTerminalSurface(runtime, options);
  }

  attach(container: HTMLElement): void {
    this.assertLive();
    if (this.host === container) return;
    if (this.host) this.detach();

    this.host = container;
    container.appendChild(this.root);
    observeHost(this.resizeObserver, container);
    window.addEventListener?.("resize", this.handleWindowResize);
    this.pixelRatioMonitor.start();
    this.scrollbarSync.forget();
    if (this.visible) {
      this.activateGpuResources();
      if (!this.documentSuspended) this.resizeToHost();
    }
    this.updateScrollbar();
    this.forceFullRedraw = true;
    if (this.visible) this.runtime.schedule(this);
  }

  detach(): void {
    if (!this.host) return;
    this.resizeObserver.disconnect();
    window.removeEventListener?.("resize", this.handleWindowResize);
    this.fitQueue.clear();
    this.heldBounds = null;
    this.pixelRatioMonitor.stop();
    this.clearCursorTimer();
    this.clearTextBlinkTimer();
    this.deactivateGpuResources();
    this.root.remove();
    this.host = null;
  }

  focus(): void {
    if (!this.host || !this.visible) return;
    this.input.focus({ preventScroll: true });
  }

  handleWindowFocus(focused: boolean): void {
    this.windowFocused = focused;
    const wasVisible = this.cursorVisible;
    const textWasVisible = this.textBlinkVisible;
    this.cursorVisible = true;
    this.armCursorBlink();
    this.syncTextBlink();
    if ((!wasVisible && this.nativeCursorVisible) || !textWasVisible)
      this.runtime.schedule(this);
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    this.cursorVisible = true;
    if (focused) this.armCursorBlink();
    else this.clearCursorTimer();
    this.runtime.schedule(this);
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.scrollbarSync.invalidate();
    this.root.style.visibility = visible ? "visible" : "hidden";
    if (visible) {
      if (!this.documentSuspended) this.search.resume();
      try {
        if (this.host && !this.uniformBuffer) {
          this.activateGpuResources();
          if (!this.documentSuspended) this.resizeToHost();
        }
      } catch (error) {
        this.options.onError(toError(error));
        return;
      }
      this.forceFullRedraw = true;
      this.runtime.schedule(this);
      this.armCursorBlink();
    } else {
      this.clearCursorTimer();
      this.clearTextBlinkTimer();
      this.textBlinkVisible = true;
      this.search.suspend();
      this.selection.suspend();
      this.deactivateGpuResources();
      this.options.model.releasePresentationResources();
    }
  }

  setCursorOptions(blink: boolean, style: "block" | "underline" | "bar"): void {
    this.options.model.setCursorOptions(style, blink);
    this.cursorBlinking = blink;
    this.cursorVisible = true;
    this.armCursorBlink();
    this.runtime.schedule(this);
  }

  setTheme(theme: TerminalGpuTheme): void {
    this.theme = theme;
    this.updateRootBackground();
    this.forceFullRedraw = true;
    this.runtime.schedule(this);
  }

  setFontMetrics(metrics: TerminalFontMetrics): void {
    const next = metricsForScale(metrics, devicePixelScale());
    if (metricsEqual(this.metrics, next)) return;
    this.metrics = next;
    if (this.documentSuspended) {
      // Paused: the canvas stays configured and sized. The buffers and the atlas lease are tied to
      // the old metrics, so they are rebuilt when presentation resumes.
      this.releaseGpuResources();
      return;
    }
    if (this.host && this.uniformBuffer) {
      this.handleRuntimeReset(this.runtime.resources());
      this.resizeToHost();
      this.forceFullRedraw = true;
      this.runtime.schedule(this);
    }
    this.updateScrollbar();
  }

  /** CSS-pixel cell size (device cell / ratio); hit-testing and overlays use it. */
  cellSize(): { readonly width: number; readonly height: number } {
    return { width: this.metrics.cellWidth, height: this.metrics.cellHeight };
  }

  /**
   * CSS pixels the drawn grid is moved up inside the pane while it waits for a resize gesture to
   * end (see `gridShift`). Hit-testing adds it to the pointer's offset, so a click lands on the
   * cell that is drawn under it.
   */
  gridShiftY(): number {
    return (this.lastScreenState?.shiftY ?? 0) / this.metrics.scale;
  }

  setCursorEnabled(enabled: boolean): void {
    if (this.cursorEnabled === enabled) return;
    this.cursorEnabled = enabled;
    this.cursorVisible = true;
    this.armCursorBlink();
    this.runtime.schedule(this);
  }

  getSelection(): string | null {
    this.selection.reconcile();
    return this.selection.text();
  }

  searchController(): GhosttySearchController {
    return this.search;
  }

  inputElement(): HTMLTextAreaElement {
    return this.input;
  }

  eventTarget(): HTMLElement {
    return this.root;
  }

  requestFrame(): void {
    this.runtime.schedule(this);
  }

  isFocused(): boolean {
    return this.focused;
  }

  /** The window canvas can draw this pane: it prepared a frame and its bindings exist. */
  drawable(): boolean {
    return (
      !this.disposed &&
      this.visible &&
      this.hasFrame &&
      // A replaced buffer leaves the old bind group naming a destroyed one until the next
      // prepared frame rebinds it; so does an atlas another pane grew (see `rebindAtlas`).
      !this.bindGroupDirty &&
      this.bindGroup !== null &&
      !this.atlasBindingStale() &&
      this.binding !== null
    );
  }

  /**
   * The shared atlas replaced a texture or its glyph table since this pane's bind group was
   * made. Another pane grows the atlas while this one may not prepare at all in that frame,
   * and the old resources are destroyed once the frame completes. Rebinding needs no upload:
   * the new table holds every glyph written so far. A pane whose own buffers are being
   * replaced rebinds in its next prepared frame.
   */
  rebindAtlas(resources: WebGpuSharedResources): void {
    if (
      this.disposed ||
      this.bindGroupDirty ||
      this.bindGroup === null ||
      !this.atlasBindingStale()
    )
      return;
    this.updateBindGroup(resources);
  }

  private atlasBindingStale(): boolean {
    const lease = this.atlasLease;
    return (
      lease !== null && lease.atlas.generation !== this.boundAtlasGeneration
    );
  }

  background(): Rgb {
    return this.theme.background;
  }

  /** Called inside the window pass; viewport and scissor already cover the pane's rectangle. */
  encode(pass: GPURenderPassEncoder, resources: WebGpuSharedResources): void {
    if (!this.bindGroup) return;
    pass.setBindGroup(0, this.bindGroup);
    pass.setPipeline(resources.backgroundPipeline);
    pass.draw(3);
    pass.setPipeline(resources.glyphPipeline);
    pass.draw(6, this.drawCells);
  }

  handleCanvasRevealed(): void {
    if (this.revealed) return;
    this.revealed = true;
    this.updateRootBackground();
  }

  /**
   * Uploads what changed (cells, glyphs, search mask, uniform) and says whether the pane's pixels
   * differ from what the window canvas last drew. Draws nothing: the window canvas redraws every
   * visible pane in one pass when any of them changed.
   */
  prepareFrame(
    resources: WebGpuSharedResources,
    budget: RasterBudget = createRasterBudget(RASTER_BUDGET_MS),
  ): boolean {
    if (
      this.disposed ||
      !this.visible ||
      this.documentSuspended ||
      !this.binding ||
      !this.cellsBuffer ||
      !this.uniformBuffer ||
      !this.atlasLease
    ) {
      return false;
    }
    if (resources.generation !== this.runtimeGeneration) {
      this.handleRuntimeReset(resources);
      // The replacement buffers have no fitted size yet.
      this.resizeToHost(undefined, false);
    }
    this.applyQueuedFit();
    const model = this.options.model;
    if (model.deferPresentation()) {
      // The previous frame stays on screen (a synchronized update, or a prompt being redrawn
      // after a resize); only the pane's rectangle may still have moved under it.
      return this.refreshHeldViewport(resources.device);
    }
    const revision = model.revision();
    if (revision !== this.contentRevision) {
      this.contentRevision = revision;
      if (this.hoveredCell >= 0) this.clearHoveredLink();
      this.mouseDownLink = null;
    }
    this.selection.reconcile();
    this.search.refreshOverlay();
    this.updateScrollbar();
    const lease = this.atlasLease;
    const device = resources.device;
    if (!lease || !this.cellsBuffer) return false;
    // The frame's cell view borrows WASM memory: upload it and scan it before
    // any other call into the model.
    const atlasStale = lease.atlas.epoch !== this.glyphMap.atlasEpoch;
    const resync = this.needsResync || atlasStale;
    const frame = model.consumeGpuFrame({ resync });
    this.needsResync = false;
    const expectedCells = frame.rows * frame.cols;
    if (expectedCells > MAX_WEBGPU_SURFACE_CELLS) {
      throw new Error(
        `Terminal surface exceeds ${MAX_WEBGPU_SURFACE_CELLS} visible cells`,
      );
    }
    const bufferReplaced = this.ensureCellCapacity(expectedCells, device);
    const cellsUploaded = this.uploadCells(
      frame,
      bufferReplaced || resync,
      device,
    );
    this.blinkingCells = frame.blinkingCells;
    const glyphsChanged = this.updateGlyphs(
      frame,
      atlasStale,
      resync,
      budget,
      device,
    );

    const cursor = model.cursor();
    const viewportOrigin = model.viewportOriginLine();
    this.syncTextBlink();
    const searchChanged = this.updateSearchMask(device);
    const uniformChanged = this.updateScreenUniform(
      frame,
      cursor,
      viewportOrigin,
      device,
    );
    const bindingsChanged = this.updateBindGroup(resources);

    const redraw =
      frame.damage.kind !== "none" ||
      cellsUploaded ||
      glyphsChanged ||
      searchChanged ||
      uniformChanged ||
      bindingsChanged ||
      this.forcePresent ||
      this.forceFullRedraw;
    if (!redraw || !this.bindGroup) {
      this.options.onFrame?.();
      return false;
    }

    if (__TERAX_BENCH__) {
      const now = performance.now();
      if (model.promptErased?.()) smoothHooks()?.blank(this.benchId, now);
      smoothHooks()?.shown(this.benchId, now, frame.cols, frame.rows);
    }
    this.drawCells = expectedCells;
    this.hasFrame = true;
    this.forceFullRedraw = false;
    this.forcePresent = false;
    this.frameCount += 1;
    // Glyphs left over by the raster budget finish on a follow-up frame; a
    // full atlas waits for the runtime's flush instead of spinning.
    if (this.glyphMap.pending > 0 && !this.atlasBlocked) {
      this.runtime.schedule(this);
    }
    if (this.frameCount === 1) this.options.onFirstFrame?.();
    this.options.onFrame?.();
    return true;
  }

  /**
   * While presentation is held the cells, glyph map and grid of the last frame stay as they
   * are, but the window canvas may still have moved or resized the pane's rectangle, and the
   * shader maps the grid onto that rectangle. Repacks the uniform for it.
   */
  private refreshHeldViewport(device: GPUDevice): boolean {
    const state = this.lastScreenState;
    const rect = this.binding?.rect();
    if (!state || !rect || !this.uniformBuffer) return false;
    if (deviceRectsEqual(state.viewport, rect)) return false;
    // The held frame is the grid of the previous size: keep its shift (the cursor row stays on
    // screen, as during the gesture) but never past what the new rectangle leaves out.
    const deficit = Math.max(0, state.rows * state.cellHeight - rect.height);
    const shiftY = Math.min(state.shiftY, deficit);
    this.packAndUpload({ ...state, viewport: rect, shiftY }, device);
    return this.hasFrame;
  }

  handleRuntimeReset(resources: WebGpuSharedResources): void {
    if (!this.host || this.disposed || this.documentSuspended) return;
    this.releaseGpuResources();
    this.initializeGpuResources(resources);
    this.forceFullRedraw = true;
  }

  handleRuntimeError(error: Error): void {
    // The window canvas may be gone before the fallback renderer exists: cover it with the
    // theme colour instead of leaving a transparent pane over nothing.
    this.coverCanvas();
    this.options.onError(error);
  }

  /**
   * Window occlusion, sleep and a lost GPU device all stop here. Pausing cancels timers and
   * rendering and releases nothing: the window canvas keeps its configuration and size, because
   * destroying or shrinking a presented WebGPU canvas makes WebKit retain its swapchain.
   */
  handleVisibilityChange(visible: boolean): void {
    if (!visible) {
      this.documentSuspended = true;
      this.clearCursorTimer();
      this.clearTextBlinkTimer();
      this.search.suspend();
      this.selection.suspend();
      return;
    }
    if (!this.documentSuspended) return;
    this.documentSuspended = false;
    this.cursorVisible = true;
    this.textBlinkVisible = true;
    if (this.visible && this.host) {
      try {
        if (!this.uniformBuffer)
          this.initializeGpuResources(this.runtime.resources());
        this.resizeToHost();
      } catch (error) {
        this.options.onError(toError(error));
        return;
      }
    }
    this.forcePresent = true;
    this.binding?.invalidate();
    if (this.visible) this.search.resume();
    this.armCursorBlink();
    this.syncTextBlink();
    this.runtime.schedule(this);
  }

  /**
   * The GPU device is gone: buffers and the atlas lease belong to it and are dropped now, the
   * window canvas is kept and pointed at the replacement device when presentation resumes.
   */
  handleDeviceLoss(): void {
    this.handleVisibilityChange(false);
    this.releaseGpuResources();
    // Reconfiguring the canvas for the replacement device clears it; the pane covers that
    // until the window canvas shows its first frame again (`WebGpuWindowCanvas.reconfigure`).
    this.coverCanvas();
  }

  /** The pane paints its own background again until the window canvas re-reveals it. */
  private coverCanvas(): void {
    if (!this.revealed) return;
    this.revealed = false;
    this.updateRootBackground();
  }

  diagnostics(): WebGpuTerminalSurfaceStats {
    const retainedBufferBytes =
      (this.cellsBuffer?.size ?? 0) +
      (this.uniformBuffer?.size ?? 0) +
      (this.glyphMapBuffer?.size ?? 0) +
      (this.searchBuffer?.size ?? 0);
    return {
      frames: this.frameCount,
      viewport: this.binding?.rect() ?? null,
      gridResizes: this.gridResizeCount,
      deferredGridResizes: this.deferredGridResizeCount,
      cellCompactions: this.cellCompactionCount,
      cellCapacity: this.cellCapacity,
      bufferBytes: retainedBufferBytes,
      cpuBufferBytes:
        this.screen.data.byteLength +
        this.glyphMap.byteSize +
        this.searchScratch.byteLength,
      gpuBufferBytes: retainedBufferBytes,
      // The swapchain belongs to the window canvas; see the runtime's `canvases`.
      canvasColorBytes: 0,
      estimatedSwapchainBytes: 0,
      cols: this.options.model.cols,
      rows: this.options.model.rows,
      scale: this.metrics.scale,
      deviceCellWidth: this.metrics.deviceCellWidth,
      deviceCellHeight: this.metrics.deviceCellHeight,
      visible: this.visible,
      documentSuspended: this.documentSuspended,
      focused: this.focused,
      uploads: this.uploadCount,
      uploadedBytes: this.uploadedBytes,
      pendingGlyphs: this.glyphMap.pending,
      fit: this.fitQueue.diagnostics(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.detach();
    this.disposed = true;
    this.unsubscribeDamage();
    this.unsubscribeResizeInteraction();
    this.search.dispose();
    this.selection.dispose();
    this.scrollbarSync.dispose();
    this.unsubscribeInteraction();
    this.root.removeEventListener("pointerdown", this.handlePointerDown);
    this.root.removeEventListener("mousemove", this.handleLinkMouseMove);
    this.root.removeEventListener("mousedown", this.handleLinkMouseDown);
    this.root.removeEventListener("mouseup", this.handleLinkMouseUp);
    this.root.removeEventListener("mouseleave", this.handleLinkMouseLeave);
    this.scrollbar.removeEventListener("scroll", this.handleScroll);
  }

  private readonly handlePointerDown = (): void => {
    if (this.options.onRequestFocus) this.options.onRequestFocus();
    else this.focus();
  };

  private readonly handleLinkMouseMove = (event: MouseEvent): void => {
    this.updateHoveredLink(event);
  };

  private readonly handleLinkMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    this.updateHoveredLink(event);
    this.mouseDownLink = this.hoveredLink;
  };

  private readonly handleLinkMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    this.updateHoveredLink(event);
    const uri = this.hoveredLink;
    const activate =
      uri !== null &&
      uri === this.mouseDownLink &&
      this.selection.value === null;
    this.mouseDownLink = null;
    if (!activate) return;
    event.preventDefault();
    this.options.onOpenLink?.(uri);
  };

  private readonly handleLinkMouseLeave = (): void => {
    this.mouseDownLink = null;
    this.clearHoveredLink();
  };

  private readonly handleInteraction = (): void => {
    if (!this.host || !this.visible || this.documentSuspended) return;
    this.runtime.interact(this);
  };

  private readonly handleWindowResize = (): void => {
    this.queueFit();
  };

  // The only place that reads scrollTop: scroll events are rare and the value
  // is the user's, not ours.
  private readonly handleScroll = (): void => {
    if (!this.host || !this.visible || this.documentSuspended) return;
    const scrollTop = this.scrollbar.scrollTop;
    const written = this.scrollbarSync.writtenScrollTop;
    if (scrollTop === written) return;
    this.scrollbarSync.invalidate();
    this.scrollbarSync.observe(scrollTop);
    if (
      isClampedScrollEcho(
        written,
        scrollTop,
        this.scrollbar.scrollHeight,
        this.scrollbar.clientHeight,
      )
    ) {
      // The browser clamped our write to shorter content: not a drag, take the model's position.
      this.updateScrollbar();
      return;
    }
    const { history, offset } = this.options.model.scrollPosition();
    const line = Math.round(scrollTop / this.metrics.cellHeight);
    if (history - line !== offset) {
      this.handleInteraction();
      this.options.model.scrollTo(history - line);
    }
  };

  private updateHoveredLink(event: MouseEvent): void {
    if (
      !this.host ||
      this.scrollbar.contains(event.target as Node) ||
      (this.options.model.modes().mouseTracking && !event.shiftKey)
    ) {
      this.clearHoveredLink();
      return;
    }
    const rect = this.root.getBoundingClientRect();
    const column = Math.floor(
      (event.clientX - rect.left) / this.metrics.cellWidth,
    );
    const row = Math.floor(
      (event.clientY - rect.top + this.gridShiftY()) / this.metrics.cellHeight,
    );
    if (
      column < 0 ||
      column >= this.options.model.cols ||
      row < 0 ||
      row >= this.options.model.rows
    ) {
      this.clearHoveredLink();
      return;
    }
    const cell = row * this.options.model.cols + column;
    if (cell === this.hoveredCell) return;
    this.hoveredCell = cell;
    this.hoveredLink = this.options.model.hyperlinkAtViewportCell(row, column);
    this.root.style.cursor = this.hoveredLink ? "pointer" : "text";
  }

  private clearHoveredLink(): void {
    this.hoveredCell = -1;
    this.hoveredLink = null;
    this.root.style.cursor = "text";
  }

  private initializeGpuResources(resources: WebGpuSharedResources): void {
    if (!this.host) return;
    try {
      this.metrics = metricsForScale(this.metrics, devicePixelScale());
      this.contrast = currentTextContrast(this.metrics.scale);
      this.atlasLease = this.runtime.acquireGlyphAtlas(this.metrics, this);
      this.glyphMap = new TerminalGlyphMap();
      this.atlasBlocked = false;
      this.needsResync = true;
      this.forceFullRedraw = true;
      this.screen.invalidate();
      this.uniformBuffer = resources.device.createBuffer({
        label: "Terax terminal surface uniform",
        size: SCREEN_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.glyphMapBuffer = this.createGlyphMapBuffer(
        resources.device,
        this.glyphMap.capacity,
      );
      this.ensureCellCapacity(
        this.options.model.cols * this.options.model.rows,
        resources.device,
      );
      this.bindGroupDirty = true;
      this.runtimeGeneration = resources.generation;
    } catch (error) {
      this.releaseGpuResources();
      throw error;
    }
  }

  private activateGpuResources(): void {
    if (!this.host) return;
    if (!this.runtimeRegistered) {
      this.binding = this.runtime.register(this, this.host);
      this.runtimeRegistered = true;
    }
    if (this.documentSuspended || this.uniformBuffer) return;
    try {
      this.initializeGpuResources(this.runtime.resources());
    } catch (error) {
      this.leaveWindow();
      this.releaseGpuResources();
      throw error;
    }
  }

  private deactivateGpuResources(): void {
    this.leaveWindow();
    this.releaseGpuResources();
  }

  /** Leaves the window canvas; the canvas itself stays configured and sized for the next pane. */
  private leaveWindow(): void {
    if (this.runtimeRegistered) {
      this.runtime.unregister(this);
      this.runtimeRegistered = false;
    }
    this.binding = null;
    this.revealed = false;
    this.hasFrame = false;
    this.updateRootBackground();
  }

  private releaseGpuResources(): void {
    this.cellsBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.glyphMapBuffer?.destroy();
    this.searchBuffer?.destroy();
    this.cellsBuffer = null;
    this.uniformBuffer = null;
    this.glyphMapBuffer = null;
    this.searchBuffer = null;
    this.bindGroup = null;
    this.bindGroupDirty = true;
    this.searchRevision = -1;
    this.searchScratch = new Uint8Array(0);
    this.atlasLease?.release();
    this.atlasLease = null;
    this.glyphMap = new TerminalGlyphMap();
    this.hasFrame = false;
    this.lastScreenState = null;
    this.cellCapacity = 0;
    this.blinkingCells = 0;
    this.forceFullRedraw = true;
    this.needsResync = true;
  }

  private queueFit(bounds?: TerminalFitBounds): void {
    if (!this.host) return;
    // The pane's rectangle in the window canvas follows the layout at once; the grid follows
    // when the resize gesture ends.
    const measured = bounds ?? this.measureHost();
    this.reportBounds(measured);
    this.fitQueue.request(measured);
    this.runtime.schedule(this);
  }

  /** Tells the window canvas where the host is; the canvas turns it into device pixels. */
  private reportBounds(bounds: TerminalFitBounds): void {
    if (bounds.left === undefined || bounds.top === undefined) return;
    this.binding?.setBounds({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    });
  }

  /** App lab only: the grid this host size asks for, for the smoothness probe. */
  private benchWant(bounds: TerminalFitBounds): void {
    if (!__TERAX_BENCH__) return;
    const fit = fitTerminalViewport(
      bounds.width,
      bounds.height,
      this.metrics,
      bounds.device,
    );
    if (fit)
      smoothHooks()?.want(this.benchId, performance.now(), fit.cols, fit.rows);
  }

  private boundsFromEntry(entry: ResizeObserverEntry): TerminalFitBounds {
    const device = entry.devicePixelContentBoxSize?.[0];
    // Layout is clean inside a ResizeObserver callback, so this read is free.
    const origin = this.root.getBoundingClientRect();
    return {
      width: entry.contentRect.width,
      height: entry.contentRect.height,
      device: device
        ? { width: device.inlineSize, height: device.blockSize }
        : undefined,
      left: origin.left,
      top: origin.top,
    };
  }

  private measureHost(): TerminalFitBounds {
    const rect = this.host?.getBoundingClientRect() ?? {
      width: 0,
      height: 0,
    };
    const origin = this.root.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      left: origin.left,
      top: origin.top,
    };
  }

  private applyQueuedFit(): void {
    if (!this.host) return;
    const bounds = this.fitQueue.take(() => this.measureHost());
    if (bounds) {
      this.resizeToHost(bounds, false, true);
    }
    // Compaction replaces the cell buffer, and while presentation is held (the prompt redraw
    // after the gesture's resize) the pane keeps drawing the old buffer; replacing it would
    // leave the pane without a bind group until the hold ends. The flag stays set, and the
    // frame that ends the hold compacts.
    if (
      this.compactAfterResize &&
      !this.resizeInteractionActive &&
      !this.options.model.presentationSuppressed()
    ) {
      this.compactAfterResize = false;
      this.options.model.compactPresentationResources();
      this.compactCellCapacity();
      this.forceFullRedraw = true;
    }
  }

  /**
   * Fits the grid to the host. `observed` fits come from the host changing size (observer,
   * window resize): while a resize gesture is live they leave the grid and the PTY alone (the
   * pane's rectangle follows the pointer, the existing grid is drawn in it, see
   * `gridShift`) and the final size is applied once when the gesture ends. Every other caller
   * applies at once.
   */
  private resizeToHost(
    measuredBounds?: TerminalFitBounds,
    scheduleRender = true,
    observed = false,
  ): void {
    if (
      !this.host ||
      !this.binding ||
      !this.visible ||
      this.documentSuspended ||
      !this.uniformBuffer
    )
      return;
    this.fitQueue.clear();
    const bounds = measuredBounds ?? this.measureHost();
    this.reportBounds(bounds);
    const scale = devicePixelScale();
    this.scrollbarSync.invalidate();
    this.scrollbarViewportHeight = Math.round(bounds.height);
    if (scale !== this.metrics.scale) {
      // New ratio: re-measure the font, then rebuild atlas and buffers.
      this.metrics = metricsForScale(this.metrics, scale);
      this.handleRuntimeReset(this.runtime.resources());
    }
    const fit = fitTerminalViewport(
      bounds.width,
      bounds.height,
      this.metrics,
      bounds.device,
    );
    if (!fit || !this.binding) return;
    const { cols, rows, pixelWidth, pixelHeight } = fit;
    if (cols * rows > MAX_WEBGPU_SURFACE_CELLS) {
      this.options.onError(
        new Error(
          `Terminal surface exceeds ${MAX_WEBGPU_SURFACE_CELLS} visible cells`,
        ),
      );
      return;
    }

    if (observed && this.resizeInteractionActive) {
      this.heldBounds = bounds;
      this.deferredGridResizeCount += 1;
      return;
    }
    const benchStart = __TERAX_BENCH__ ? performance.now() : 0;
    const outcome = this.resizeSync.request(cols, rows);
    if (__TERAX_BENCH__) {
      const now = performance.now();
      smoothHooks()?.have(
        this.benchId,
        now,
        this.options.model.cols,
        this.options.model.rows,
        outcome === "applied",
        now - benchStart,
      );
    }
    this.heldBounds = null;
    const changed = outcome === "applied";
    if (changed) {
      this.gridResizeCount += 1;
      this.selection.reconcile();
    }
    if (changed) {
      this.options.model.setPixelSize(pixelWidth, pixelHeight);
      this.forceFullRedraw = true;
    }
    this.updateScrollbar();
    if (scheduleRender && changed) this.runtime.schedule(this);
  }

  private updateScrollbar(): void {
    if (!this.host || !this.visible || this.documentSuspended) return;
    this.scrollbarSync.sync(
      this.scrollbarViewportHeight,
      this.scrollbar,
      this.scrollbarContent,
      this.options.model,
      this.metrics.cellHeight,
    );
  }

  /** Grows the cell buffer; true if it was replaced (every row must upload). */
  private ensureCellCapacity(cellCount: number, device: GPUDevice): boolean {
    if (cellCount <= this.cellCapacity && this.cellsBuffer) return false;
    const capacity = nextWebGpuCellCapacity(this.cellCapacity, cellCount);
    this.replaceCellBuffer(capacity, device);
    return true;
  }

  private compactCellCapacity(): void {
    if (!this.cellsBuffer || !this.host || this.documentSuspended) return;
    const required = this.options.model.cols * this.options.model.rows;
    const capacity = compactWebGpuCellCapacity(this.cellCapacity, required);
    if (capacity === null) return;
    this.replaceCellBuffer(capacity, this.runtime.resources().device);
    this.cellCompactionCount += 1;
    this.forceFullRedraw = true;
    this.needsResync = true;
  }

  private replaceCellBuffer(capacity: number, device: GPUDevice): void {
    this.cellsBuffer?.destroy();
    this.cellCapacity = capacity;
    this.cellsBuffer = device.createBuffer({
      label: "Terax terminal cell records",
      size: capacity * CELL_RECORD_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.bindGroupDirty = true;
  }

  private createGlyphMapBuffer(device: GPUDevice, entries: number): GPUBuffer {
    return device.createBuffer({
      label: "Terax terminal glyph map",
      size: entries * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  private uploadCells(
    frame: GhosttyGpuFrame,
    everything: boolean,
    device: GPUDevice,
  ): boolean {
    const buffer = this.cellsBuffer;
    if (!buffer) return false;
    const rowBytes = frame.cols * CELL_RECORD_BYTES;
    const ranges = everything
      ? [{ start: 0, end: frame.rows - 1 }]
      : frame.dirtyRanges;
    for (const range of ranges) {
      const offset = range.start * rowBytes;
      const length = (range.end - range.start + 1) * rowBytes;
      device.queue.writeBuffer(buffer, offset, frame.cells, offset, length);
      this.uploadCount += 1;
      this.uploadedBytes += length;
    }
    return ranges.length > 0;
  }

  /**
   * Maintains `glyph_map`: epoch resets, new ids, recovery after an atlas
   * flush, and rasterization within the frame budget. Returns true if the map
   * changed in a way that needs a redraw.
   */
  private updateGlyphs(
    frame: GhosttyGpuFrame,
    atlasStale: boolean,
    resync: boolean,
    budget: RasterBudget,
    device: GPUDevice,
  ): boolean {
    const lease = this.atlasLease;
    if (!lease) return false;
    const atlas = lease.atlas;
    const map = this.glyphMap;
    const grew = map.ensureCapacity(frame.glyphCount);
    if (frame.epoch !== map.zigEpoch) {
      map.resetForEpoch(frame.epoch);
      map.adoptAtlasEpoch(atlas.epoch);
    } else if (atlasStale) {
      map.invalidateAtlas(atlas.epoch);
    }
    map.add(frame.newGlyphs);
    if (map.recovering) {
      map.scanCells(
        frame.cells,
        frame.cols,
        resync ? [{ start: 0, end: frame.rows - 1 }] : frame.dirtyRanges,
      );
    }

    map.shedBacklog(frame.cells, frame.cols, frame.rows);
    const allowance =
      this.frameCount === 0 || resync
        ? FIRST_FRAME_RASTER_BUDGET_MS
        : undefined;
    const result = map.process(atlas, budget, allowance);
    atlas.commit();
    this.atlasBlocked = result.full;
    if (result.full) lease.requestFlush();

    if (grew || this.glyphMapBuffer === null) {
      this.glyphMapBuffer?.destroy();
      this.glyphMapBuffer = this.createGlyphMapBuffer(device, map.capacity);
      map.markAllDirty();
      this.bindGroupDirty = true;
    }
    const dirty = map.takeDirty();
    if (dirty && this.glyphMapBuffer) {
      const count = Math.min(dirty.end, map.capacity - 1) - dirty.start + 1;
      device.queue.writeBuffer(
        this.glyphMapBuffer,
        dirty.start * 4,
        map.entries,
        dirty.start,
        count,
      );
      this.uploadCount += 1;
      this.uploadedBytes += count * 4;
    }
    return dirty !== null || result.resolved > 0;
  }

  /** Uploads the highlight mask only when it changes; frees it when empty. */
  private updateSearchMask(device: GPUDevice): boolean {
    const revision = this.search.maskRevision;
    if (revision === this.searchRevision) return false;
    this.searchRevision = revision;
    const mask = this.search.viewportMaskBytes();
    if (!mask) {
      if (!this.searchBuffer) return false;
      this.searchBuffer.destroy();
      this.searchBuffer = null;
      this.searchScratch = new Uint8Array(0);
      this.bindGroupDirty = true;
      return true;
    }
    const packed = packSearchMask(mask, this.searchScratch);
    if (packed.buffer !== this.searchScratch.buffer) {
      this.searchScratch = new Uint8Array(packed.buffer as ArrayBuffer);
    }
    if (!this.searchBuffer || this.searchBuffer.size !== packed.byteLength) {
      this.searchBuffer?.destroy();
      this.searchBuffer = device.createBuffer({
        label: "Terax terminal search mask",
        size: packed.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.bindGroupDirty = true;
    }
    device.queue.writeBuffer(this.searchBuffer, 0, packed);
    this.uploadCount += 1;
    this.uploadedBytes += packed.byteLength;
    return true;
  }

  private updateBindGroup(resources: WebGpuSharedResources): boolean {
    const lease = this.atlasLease;
    if (
      !lease ||
      !this.uniformBuffer ||
      !this.cellsBuffer ||
      !this.glyphMapBuffer
    )
      return false;
    const atlas = lease.atlas;
    if (
      !this.bindGroupDirty &&
      this.bindGroup &&
      atlas.generation === this.boundAtlasGeneration
    )
      return false;
    this.bindGroup = resources.device.createBindGroup({
      label: "Terax terminal surface bindings",
      layout: resources.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.cellsBuffer } },
        { binding: 2, resource: { buffer: this.glyphMapBuffer } },
        { binding: 3, resource: { buffer: atlas.tableBuffer } },
        {
          binding: 4,
          resource: { buffer: this.searchBuffer ?? resources.emptyStorage },
        },
        { binding: 5, resource: atlas.coverageTextureView },
        { binding: 6, resource: atlas.colorTextureView },
      ],
    });
    this.boundAtlasGeneration = atlas.generation;
    this.bindGroupDirty = false;
    return true;
  }

  private boundAtlasGeneration = 0;

  private updateScreenUniform(
    frame: GhosttyGpuFrame,
    cursor: ReturnType<GhosttyTerminalModelApi["cursor"]>,
    viewportOriginLine: number,
    device: GPUDevice,
  ): boolean {
    if (!this.uniformBuffer) return false;
    this.nativeCursorVisible =
      cursor.visible &&
      cursor.x >= 0 &&
      cursor.x < frame.cols &&
      cursor.y >= 0 &&
      cursor.y < frame.rows;
    if (cursor.blinking !== this.cursorBlinking) {
      this.cursorBlinking = cursor.blinking;
      this.cursorVisible = true;
    }
    this.armCursorBlink();
    const showCursor =
      this.cursorEnabled && this.cursorVisible && this.nativeCursorVisible;
    const bounds = this.selection.normalizedBounds();
    const theme = this.theme;
    const state: ScreenUniformState = {
      cols: frame.cols,
      rows: frame.rows,
      cellWidth: this.metrics.deviceCellWidth,
      cellHeight: this.metrics.deviceCellHeight,
      viewport: this.binding?.rect() ?? {
        x: 0,
        y: 0,
        width: frame.cols * this.metrics.deviceCellWidth,
        height: frame.rows * this.metrics.deviceCellHeight,
      },
      shiftY: 0,
      textBlinkVisible: this.textBlinkVisible,
      searchActive: this.searchBuffer !== null,
      cursor: showCursor
        ? cursorRect(cursor, cursor.style, this.metrics)
        : null,
      cursorColor: theme.cursor,
      background: theme.background,
      selection: bounds
        ? selectionUniform(bounds, viewportOriginLine, frame.rows)
        : NO_SELECTION,
      selectionColor: theme.selection.color,
      selectionAlpha: theme.selection.alpha,
      decoration: decorationMetrics(this.metrics),
      leftOverhangPadding: leftOverhangPadding(
        this.metrics.font.letterSpacing,
        this.metrics.scale,
      ),
      contrast: this.contrast,
    };
    const shiftY = this.gridShift(state, cursor);
    if (__TERAX_BENCH__ && this.nativeCursorVisible) {
      // The cursor the application asked for, whatever phase its blink is in.
      const rect = cursorRect(cursor, cursor.style, this.metrics);
      const bottom = rect.y + rect.height - shiftY;
      smoothHooks()?.cursor(
        this.benchId,
        bottom > 0 && bottom <= state.viewport.height + 1,
      );
    }
    return this.packAndUpload({ ...state, shiftY }, device);
  }

  /**
   * While the grid is waiting for a resize gesture to end, a pane that became shorter than its
   * grid shows the grid moved up, just enough to keep the cursor row on screen (a prompt at the
   * bottom stays visible, as in a native terminal) and never past the grid's own height.
   * Narrower panes clip on the right, taller or wider ones are padded with the background.
   */
  private gridShift(
    state: ScreenUniformState,
    cursor: ReturnType<GhosttyTerminalModelApi["cursor"]>,
  ): number {
    if (!this.resizeInteractionActive && this.heldBounds === null) return 0;
    const cell = state.cellHeight;
    const deficit = state.rows * cell - state.viewport.height;
    if (deficit <= 0) return 0;
    const row = Math.min(state.rows - 1, Math.max(0, cursor.y));
    return Math.min(
      deficit,
      Math.max(0, (row + 1) * cell - state.viewport.height),
    );
  }

  /** Packs the uniform and uploads it when it differs from what the GPU holds. */
  private packAndUpload(state: ScreenUniformState, device: GPUDevice): boolean {
    const buffer = this.uniformBuffer;
    if (!buffer) return false;
    this.lastScreenState = state;
    this.screen.pack(state);
    if (!this.screen.changed()) return false;
    device.queue.writeBuffer(buffer, 0, this.screen.data);
    this.screen.markUploaded();
    this.uploadCount += 1;
    this.uploadedBytes += SCREEN_UNIFORM_BYTES;
    return true;
  }

  private armCursorBlink(): void {
    if (
      !this.cursorEnabled ||
      !this.nativeCursorVisible ||
      !this.windowFocused ||
      this.documentSuspended ||
      !this.cursorBlinking ||
      !this.focused ||
      !this.visible ||
      !this.host ||
      !terminalWindowPresentation().visible
    ) {
      this.clearCursorTimer();
      return;
    }
    if (this.cursorTimer !== null) return;
    this.cursorTimer = window.setTimeout(() => {
      this.cursorTimer = null;
      this.cursorVisible = !this.cursorVisible;
      this.runtime.schedule(this);
      this.armCursorBlink();
    }, CURSOR_BLINK_MS);
  }

  private clearCursorTimer(): void {
    if (this.cursorTimer !== null) window.clearTimeout(this.cursorTimer);
    this.cursorTimer = null;
  }

  private syncTextBlink(): void {
    if (
      this.blinkingCells === 0 ||
      !this.windowFocused ||
      this.documentSuspended ||
      !this.visible ||
      !this.host ||
      !terminalWindowPresentation().visible
    ) {
      this.clearTextBlinkTimer();
      this.textBlinkVisible = true;
      return;
    }
    if (this.textBlinkTimer !== null) return;
    this.textBlinkTimer = window.setTimeout(() => {
      this.textBlinkTimer = null;
      this.textBlinkVisible = !this.textBlinkVisible;
      this.runtime.schedule(this);
      this.syncTextBlink();
    }, TEXT_BLINK_MS);
  }

  private clearTextBlinkTimer(): void {
    if (this.textBlinkTimer !== null) window.clearTimeout(this.textBlinkTimer);
    this.textBlinkTimer = null;
  }

  /**
   * The window canvas draws the terminal background. Until it has shown this pane's first
   * frame the pane's own DOM covers whatever the canvas still holds from another tab.
   */
  private updateRootBackground(): void {
    this.root.style.backgroundColor = this.revealed
      ? "transparent"
      : rgbToCss(this.theme.background);
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("WebGPU terminal surface is disposed");
  }
}

function currentTextContrast(scale: number): TextContrast {
  let override: string | null = null;
  try {
    override = window.localStorage?.getItem(TEXT_CONTRAST_STORAGE_KEY) ?? null;
  } catch {
    override = null;
  }
  return textContrastFor({
    platform: detectPlatform(
      typeof navigator === "undefined" ? "" : navigator.userAgent,
    ),
    scale,
    override,
  });
}

/** Asks for the exact device-pixel box where the engine supports it. */
function observeHost(observer: ResizeObserver, host: HTMLElement): void {
  try {
    observer.observe(host, { box: "device-pixel-content-box" });
  } catch {
    observer.observe(host);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
