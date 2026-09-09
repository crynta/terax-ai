import { terminalWindowFocused } from "@/modules/terminal/ghostty/renderScheduling";
import { bindTerminalInteraction } from "@/modules/terminal/ghostty/input/terminalInteraction";
import { TerminalScrollbarSync } from "@/modules/terminal/ghostty/gpu/terminalScrollbar";
import { terminalWindowPresentation } from "@/modules/terminal/ghostty/windowPresentation";
import type { TerminalSurface } from "@/modules/terminal/backend/contracts";
import {
  subscribeTerminalResizeInteraction,
  terminalResizeInteractionActive,
} from "@/modules/terminal/lib/terminalResizeInteraction";
import { CellFlags } from "@terax/ghostty-core/protocol";
import type { Rgb, TerminalCellReader } from "../core/packedCells";
import type { GhosttyTerminalModelApi } from "../GhosttyTerminalModel";
import { GhosttySearchController } from "../search/GhosttySearchController";
import {
  selectionBoundsContain,
  TerminalSelectionController,
} from "../selection/TerminalSelectionController";
import { CanvasBackingStore } from "./CanvasBackingStore";
import { DevicePixelRatioMonitor } from "./DevicePixelRatioMonitor";
import { GlyphAtlasCapacityError } from "./GlyphAtlas";
import { fitTerminalViewport } from "./TerminalFit";
import {
  TerminalFitQueue,
  type TerminalFitQueueDiagnostics,
} from "./TerminalFitQueue";
import {
  rgbToCss,
  type TerminalFontMetrics,
  type TerminalGpuTheme,
} from "./terminalVisuals";
import {
  CELL_FLAG_OVERLINE,
  CELL_FLAG_STRIKETHROUGH,
  CELL_FLAG_UNDERLINE_MASK,
  clearCellInstance,
  clearGlyphInstance,
  compactWebGpuCellCapacity,
  GLYPH_FLAG_BLINK,
  GLYPH_FLAG_COVERAGE_RED,
  GLYPH_FLAG_INTRINSIC_COLOR,
  MAX_WEBGPU_SURFACE_CELLS,
  nextWebGpuCellCapacity,
  PACKED_INSTANCE_BYTES,
  SCREEN_UNIFORM_BYTES,
  writeCellInstance,
  writeGlyphInstance,
} from "./WebGpuCellBuffer";
import {
  type GlyphAtlasLease,
  getWebGpuTerminalRuntime,
  type WebGpuRuntimeSurface,
  type WebGpuSharedResources,
  type WebGpuTerminalRuntime,
} from "./WebGpuTerminalRuntime";

const CURSOR_BLINK_MS = 600;
const TEXT_BLINK_MS = 600;
const SEARCH_MATCH_BACKGROUND = 0x515c6a;
const SEARCH_ACTIVE_MATCH_BACKGROUND = 0xd18616;
let nextAtlasOwnerId = 1;

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
  readonly backingStoreResizes: number;
  readonly cellCompactions: number;
  readonly cellCapacity: number;
  readonly bufferBytes: number;
  readonly cpuBufferBytes: number;
  readonly gpuBufferBytes: number;
  readonly canvasColorBytes: number;
  readonly estimatedSwapchainBytes: number;
  readonly cols: number;
  readonly rows: number;
  readonly visible: boolean;
  readonly documentSuspended: boolean;
  readonly focused: boolean;
  readonly uploads: number;
  readonly uploadedBytes: number;
  readonly fit: TerminalFitQueueDiagnostics;
};

export class WebGpuTerminalSurface
  implements TerminalSurface, WebGpuRuntimeSurface
{
  readonly backend = "ghostty-webgpu" as const;

  private readonly canvas = document.createElement("canvas");
  private readonly backingStore = new CanvasBackingStore(this.canvas);
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
  private readonly atlasOwnerKey = String(nextAtlasOwnerId++);
  private context: GPUCanvasContext | null = null;
  private atlasLease: GlyphAtlasLease | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private instanceBuffer: GPUBuffer | null = null;
  private colorBindGroup: GPUBindGroup | null = null;
  private glyphBindGroup: GPUBindGroup | null = null;
  private instanceData = new ArrayBuffer(0);
  private instanceBytes = new Uint8Array(0);
  private instanceView = new DataView(new ArrayBuffer(0));
  private readonly screenData = new Float32Array(SCREEN_UNIFORM_BYTES / 4);
  private readonly uploadedScreenData = new Float32Array(
    SCREEN_UNIFORM_BYTES / 4,
  );
  private uniformUploaded = false;
  private forcePresent = true;
  private blinkingRows = new Uint8Array(0);
  private theme: TerminalGpuTheme;
  private metrics: TerminalFontMetrics;
  private themeBackground: number;
  private themeCursor: number;
  private selectionColor: number;
  private cellCapacity = 0;
  private host: HTMLElement | null = null;
  private scale = 1;
  private visible = true;
  private synchronizedScrollTop: number | null = null;
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
  private blinkingRowCount = 0;
  private forceFullRedraw = true;
  private atlasGeneration = 0;
  private runtimeGeneration = 0;
  private frameCount = 0;
  private backingStoreResizeCount = 0;
  private cellCompactionCount = 0;
  private uploadCount = 0;
  private uploadedBytes = 0;
  private contentRevision: number;
  private hoveredCell = -1;
  private hoveredLink: string | null = null;
  private mouseDownLink: string | null = null;
  private applyingFit = false;
  private disposed = false;

  private constructor(
    private readonly runtime: WebGpuTerminalRuntime,
    private readonly options: WebGpuTerminalSurfaceOptions,
  ) {
    this.metrics = options.metrics;
    this.pixelRatioMonitor = new DevicePixelRatioMonitor(() =>
      this.resizeToHost(),
    );
    this.cursorBlinking = options.cursorBlink;
    this.theme = options.theme;
    this.themeBackground = packRgb(options.theme.background);
    this.themeCursor = packRgb(options.theme.cursor);
    this.selectionColor = packRgb(options.theme.selection.color);
    options.model.setCursorOptions(options.cursorStyle, options.cursorBlink);
    this.contentRevision = options.model.revision();
    this.root.className = "absolute inset-0 overflow-hidden";
    this.root.style.userSelect = "none";
    this.updateRootBackground();
    this.root.setAttribute("data-terax-ghostty-surface", "webgpu");
    this.root.setAttribute("data-terax-terminal-surface", "");
    this.canvas.className = "block";
    this.canvas.setAttribute("aria-hidden", "true");
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
    this.root.append(this.canvas, this.input, this.scrollbar);

    this.unsubscribeInteraction = bindTerminalInteraction(
      this.root,
      this.handleInteraction,
    );
    this.selection = new TerminalSelectionController({
      model: options.model,
      target: this.root,
      cellSize: () => this.cellSize(),
      shouldIgnoreTarget: (target) =>
        target instanceof Node && this.scrollbar.contains(target),
      onChange: () => {
        if (this.applyingFit) return;
        this.runtime.schedule(this);
      },
    });
    this.search = new GhosttySearchController(options.model, () => {
      if (this.applyingFit) return;
      this.forceFullRedraw = true;
      this.runtime.schedule(this);
    });

    this.resizeObserver = new ResizeObserver((entries) => {
      const bounds = entries[entries.length - 1]?.contentRect;
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
        this.compactAfterResize = true;
        this.queueFit();
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
    this.context = this.canvas.getContext("webgpu");
    if (!this.context) throw new Error("WebGPU canvas context is unavailable");
    this.resizeObserver.observe(container);
    this.pixelRatioMonitor.start();
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
    this.fitQueue.clear();
    this.pixelRatioMonitor.stop();
    this.clearCursorTimer();
    this.clearTextBlinkTimer();
    this.deactivateGpuResources();
    this.context = null;
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
        if (this.host && this.context && !this.uniformBuffer) {
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
    this.themeBackground = packRgb(theme.background);
    this.themeCursor = packRgb(theme.cursor);
    this.selectionColor = packRgb(theme.selection.color);
    this.forceFullRedraw = true;
    this.runtime.schedule(this);
  }

  setFontMetrics(metrics: TerminalFontMetrics): void {
    if (fontMetricsKey(this.metrics) === fontMetricsKey(metrics)) return;
    this.metrics = metrics;
    if (this.documentSuspended) {
      this.releaseGpuResources();
      this.context?.unconfigure();
      return;
    }
    if (this.host && this.context && this.uniformBuffer) {
      this.handleRuntimeReset(this.runtime.resources());
      this.resizeToHost();
      this.forceFullRedraw = true;
      this.runtime.schedule(this);
    }
    this.updateScrollbar();
  }

  cellSize(): { readonly width: number; readonly height: number } {
    return { width: this.metrics.cellWidth, height: this.metrics.cellHeight };
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

  renderFrame(
    encoder: GPUCommandEncoder,
    resources: WebGpuSharedResources,
  ): boolean {
    if (
      this.disposed ||
      !this.visible ||
      this.documentSuspended ||
      !this.context ||
      !this.instanceBuffer ||
      !this.colorBindGroup ||
      !this.glyphBindGroup ||
      !this.atlasLease
    ) {
      return false;
    }
    if (resources.generation !== this.runtimeGeneration) {
      this.handleRuntimeReset(resources);
    }
    this.applyQueuedFit();
    if (this.options.model.deferPresentation()) return false;
    const revision = this.options.model.revision();
    if (revision !== this.contentRevision) {
      this.contentRevision = revision;
      if (this.hoveredCell >= 0) this.clearHoveredLink();
      this.mouseDownLink = null;
    }
    this.selection.reconcile();
    this.search.refreshOverlay();
    this.updateScrollbar();
    if (this.backingStore.commit()) {
      this.backingStoreResizeCount += 1;
      this.forceFullRedraw = true;
    }

    const damage = this.options.model.consumeDamage();
    const atlas = this.atlasLease.atlas;
    const atlasChanged = atlas.generation !== this.atlasGeneration;
    const needsCells =
      this.forceFullRedraw || atlasChanged || damage.kind !== "none";
    if (needsCells) {
      this.updateCellInstances(
        this.forceFullRedraw || atlasChanged ? { kind: "full" } : damage,
        resources,
      );
    }
    this.syncTextBlink();
    const uniformChanged = this.updateScreenUniform(resources);
    if (!needsCells && !uniformChanged && !this.forcePresent) {
      this.options.onFrame?.();
      return false;
    }
    this.atlasLease.atlas.encodePendingUploads(encoder);

    const target = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      label: "Terax terminal surface pass",
      colorAttachments: [
        {
          view: target,
          clearValue: rgbClear(this.theme.background),
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    const cellCount = this.options.model.cols * this.options.model.rows;
    pass.setPipeline(resources.colorPipeline);
    pass.setBindGroup(0, this.colorBindGroup);
    pass.setVertexBuffer(0, this.instanceBuffer);
    pass.draw(6, cellCount);
    pass.setPipeline(resources.glyphPipeline);
    pass.setBindGroup(0, this.glyphBindGroup);
    pass.setVertexBuffer(0, this.instanceBuffer);
    pass.draw(6, cellCount);
    pass.end();

    this.forceFullRedraw = false;
    this.forcePresent = false;
    this.frameCount += 1;
    if (this.frameCount === 1) this.options.onFirstFrame?.();
    this.options.onFrame?.();
    return true;
  }

  handleRuntimeReset(resources: WebGpuSharedResources): void {
    if (!this.host || !this.context || this.disposed || this.documentSuspended)
      return;
    this.releaseGpuResources();
    this.initializeGpuResources(resources);
    this.forceFullRedraw = true;
  }

  handleRuntimeError(error: Error): void {
    this.options.onError(error);
  }

  handleVisibilityChange(visible: boolean, reclaim = !visible): void {
    if (!visible) {
      this.documentSuspended = true;
      this.clearCursorTimer();
      this.clearTextBlinkTimer();
      this.search.suspend();
      this.selection.suspend();
      if (reclaim) {
        this.options.model.releasePresentationResources();
        this.releaseGpuResources();
        this.context?.unconfigure();
        this.backingStore.release();
      }
      return;
    }
    if (!this.documentSuspended) return;
    this.documentSuspended = false;
    this.cursorVisible = true;
    this.textBlinkVisible = true;
    if (this.visible && this.host && this.context) {
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
    if (this.visible) this.search.resume();
    this.armCursorBlink();
    this.syncTextBlink();
    this.runtime.schedule(this);
  }

  diagnostics(): WebGpuTerminalSurfaceStats {
    const retainedBufferBytes =
      (this.instanceBuffer?.size ?? 0) + (this.uniformBuffer?.size ?? 0);
    const canvasColorBytes = this.uniformBuffer
      ? this.canvas.width * this.canvas.height * 4
      : 0;
    return {
      frames: this.frameCount,
      backingStoreResizes: this.backingStoreResizeCount,
      cellCompactions: this.cellCompactionCount,
      cellCapacity: this.cellCapacity,
      bufferBytes: retainedBufferBytes,
      cpuBufferBytes:
        this.instanceData.byteLength +
        this.screenData.byteLength +
        this.uploadedScreenData.byteLength +
        this.blinkingRows.byteLength,
      gpuBufferBytes: retainedBufferBytes,
      canvasColorBytes,
      estimatedSwapchainBytes: canvasColorBytes * 3,
      cols: this.options.model.cols,
      rows: this.options.model.rows,
      visible: this.visible,
      documentSuspended: this.documentSuspended,
      focused: this.focused,
      uploads: this.uploadCount,
      uploadedBytes: this.uploadedBytes,
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
    const activate = uri !== null && uri === this.mouseDownLink;
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

  private readonly handleScroll = (): void => {
    if (!this.host || !this.visible || this.documentSuspended) return;
    if (this.scrollbar.scrollTop === this.synchronizedScrollTop) return;
    this.scrollbarSync.invalidate();
    const { history, offset } = this.options.model.scrollPosition();
    const line = Math.round(this.scrollbar.scrollTop / this.metrics.cellHeight);
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
      (event.clientY - rect.top) / this.metrics.cellHeight,
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
    if (!this.context) return;
    try {
      this.context.configure({
        device: resources.device,
        format: resources.format,
        alphaMode: "opaque",
      });
      this.scale = Math.max(1, window.devicePixelRatio || 1);
      this.atlasLease = this.runtime.acquireGlyphAtlas(
        this.metrics,
        this.scale,
        this,
      );
      this.forceFullRedraw = true;
      this.uniformUploaded = false;
      this.uniformBuffer = resources.device.createBuffer({
        label: "Terax terminal surface uniform",
        size: SCREEN_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.colorBindGroup = resources.device.createBindGroup({
        layout: resources.colorBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      });
      this.glyphBindGroup = resources.device.createBindGroup({
        layout: resources.glyphBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          {
            binding: 1,
            resource: this.atlasLease.atlas.coverageTextureView,
          },
          { binding: 2, resource: this.atlasLease.atlas.colorTextureView },
          { binding: 3, resource: resources.glyphSampler },
        ],
      });
      this.runtimeGeneration = resources.generation;
      this.atlasGeneration = this.atlasLease.atlas.generation;
      this.ensureCellCapacity(
        this.options.model.cols * this.options.model.rows,
        resources.device,
      );
    } catch (error) {
      this.releaseGpuResources();
      this.context.unconfigure();
      throw error;
    }
  }

  private activateGpuResources(): void {
    if (!this.context) return;
    if (!this.runtimeRegistered) {
      this.runtime.register(this);
      this.runtimeRegistered = true;
    }
    if (this.documentSuspended || this.uniformBuffer) return;
    try {
      this.initializeGpuResources(this.runtime.resources());
    } catch (error) {
      this.runtime.unregister(this);
      this.runtimeRegistered = false;
      this.releaseGpuResources();
      this.context.unconfigure();
      throw error;
    }
  }

  private deactivateGpuResources(): void {
    if (this.runtimeRegistered) {
      this.runtime.unregister(this);
      this.runtimeRegistered = false;
    }
    this.releaseGpuResources();
    this.context?.unconfigure();
    this.backingStore.release();
  }

  private releaseGpuResources(): void {
    this.instanceBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.instanceBuffer = null;
    this.uniformBuffer = null;
    this.colorBindGroup = null;
    this.glyphBindGroup = null;
    this.atlasLease?.release();
    this.atlasLease = null;
    this.cellCapacity = 0;
    this.instanceData = new ArrayBuffer(0);
    this.instanceBytes = new Uint8Array(0);
    this.instanceView = new DataView(this.instanceData);
    this.blinkingRows = new Uint8Array(0);
    this.blinkingRowCount = 0;
    this.forceFullRedraw = true;
  }

  private queueFit(bounds?: Pick<DOMRectReadOnly, "width" | "height">): void {
    if (!this.host) return;
    this.fitQueue.request(bounds);
    this.runtime.schedule(this);
  }

  private applyQueuedFit(): void {
    if (!this.host) return;
    const bounds = this.fitQueue.take(
      () => this.host?.getBoundingClientRect() ?? { width: 0, height: 0 },
    );
    if (bounds) this.resizeToHost(bounds, false);
    if (this.compactAfterResize && !this.resizeInteractionActive) {
      this.compactAfterResize = false;
      this.options.model.compactPresentationResources();
      this.compactCellCapacity();
      this.forceFullRedraw = true;
    }
  }

  private resizeToHost(
    measuredBounds?: Pick<DOMRectReadOnly, "width" | "height">,
    scheduleRender = true,
  ): void {
    if (
      !this.host ||
      !this.context ||
      !this.visible ||
      this.documentSuspended ||
      !this.uniformBuffer
    )
      return;
    this.fitQueue.clear();
    const bounds = measuredBounds ?? this.host.getBoundingClientRect();
    const scale = Math.max(1, window.devicePixelRatio || 1);
    this.scrollbarSync.invalidate();
    this.scrollbarViewportHeight = Math.round(bounds.height);
    const fit = fitTerminalViewport(
      bounds.width,
      bounds.height,
      this.metrics,
      scale,
    );
    if (!fit) return;
    const { cols, rows, cssWidth, cssHeight, pixelWidth, pixelHeight } = fit;
    if (cols * rows > MAX_WEBGPU_SURFACE_CELLS) {
      this.options.onError(
        new Error(
          `Terminal surface exceeds ${MAX_WEBGPU_SURFACE_CELLS} visible cells`,
        ),
      );
      return;
    }

    if (scale !== this.scale) {
      this.handleRuntimeReset(this.runtime.resources());
    }
    const changed =
      cols !== this.options.model.cols || rows !== this.options.model.rows;
    if (changed) {
      this.applyingFit = true;
      try {
        this.options.model.resize(cols, rows);
      } finally {
        this.applyingFit = false;
      }
    }
    if (changed) this.selection.reconcile();
    this.ensureCellCapacity(cols * rows, this.runtime.resources().device);

    const backingStoreChanged = this.backingStore.stage(
      pixelWidth,
      pixelHeight,
      cssWidth,
      cssHeight,
    );
    if (changed || backingStoreChanged) {
      this.options.model.setPixelSize(pixelWidth, pixelHeight);
    }
    if (changed) this.options.onResize(cols, rows);
    if (changed || backingStoreChanged) this.forceFullRedraw = true;
    this.updateScrollbar();
    if (scheduleRender && (changed || backingStoreChanged)) {
      this.runtime.schedule(this);
    }
  }

  private updateScrollbar(): void {
    if (!this.host || !this.visible || this.documentSuspended) return;
    this.synchronizedScrollTop = this.scrollbarSync.sync(
      this.scrollbarViewportHeight,
      this.scrollbar,
      this.scrollbarContent,
      this.options.model,
      this.metrics.cellHeight,
    );
  }

  private ensureCellCapacity(cellCount: number, device: GPUDevice): boolean {
    if (cellCount <= this.cellCapacity) return false;
    const capacity = nextWebGpuCellCapacity(this.cellCapacity, cellCount);
    this.replaceCellBuffer(capacity, device);
    return true;
  }

  private compactCellCapacity(): void {
    if (!this.instanceBuffer || !this.host || this.documentSuspended) return;
    const required = this.options.model.cols * this.options.model.rows;
    const capacity = compactWebGpuCellCapacity(this.cellCapacity, required);
    if (capacity === null) return;
    this.replaceCellBuffer(capacity, this.runtime.resources().device);
    this.cellCompactionCount += 1;
    this.forceFullRedraw = true;
  }

  private replaceCellBuffer(capacity: number, device: GPUDevice): void {
    this.instanceBuffer?.destroy();
    this.cellCapacity = capacity;
    this.instanceData = new ArrayBuffer(capacity * PACKED_INSTANCE_BYTES);
    this.instanceBytes = new Uint8Array(this.instanceData);
    this.instanceView = new DataView(this.instanceData);
    this.instanceBuffer = createVertexBuffer(
      device,
      this.instanceData.byteLength,
      "Terax terminal packed cell and glyph instances",
    );
  }

  private updateCellInstances(
    damage: ReturnType<GhosttyTerminalModelApi["consumeDamage"]>,
    resources: WebGpuSharedResources,
  ): void {
    if (!this.instanceBuffer || !this.atlasLease) return;
    const cells = this.options.model.renderCells();
    const expectedCells = this.options.model.cols * this.options.model.rows;
    if (cells.length !== expectedCells) {
      throw new Error(
        `Ghostty viewport mismatch: expected ${expectedCells}, received ${cells.length}`,
      );
    }
    const capacityChanged = this.ensureCellCapacity(
      expectedCells,
      resources.device,
    );
    const rowShapeChanged =
      this.blinkingRows.length !== this.options.model.rows;
    if (rowShapeChanged) {
      this.blinkingRows = new Uint8Array(this.options.model.rows);
      this.blinkingRowCount = 0;
    }

    let ranges =
      !capacityChanged && !rowShapeChanged && damage.kind === "rows"
        ? damage.ranges
        : [{ start: 0, end: this.options.model.rows - 1 }];
    let stable = false;
    let resetIsolatedAtlas = false;
    for (let attempt = 0; attempt < 5 && !stable; attempt += 1) {
      const generation = this.atlasLease.atlas.generation;
      try {
        for (const range of ranges) {
          this.buildRows(cells, range.start, range.end);
        }
        stable = generation === this.atlasLease.atlas.generation;
      } catch (error) {
        if (!(error instanceof GlyphAtlasCapacityError)) throw error;
        if (!this.atlasLease.isolated) {
          this.replaceWithIsolatedAtlas();
        } else if (!resetIsolatedAtlas) {
          this.atlasLease.atlas.resetForRebuild();
          resetIsolatedAtlas = true;
        } else {
          throw new Error(
            `Visible glyphs exceed the bounded WebGPU atlas budget: ${error.message}`,
          );
        }
      }
      if (!stable) ranges = [{ start: 0, end: this.options.model.rows - 1 }];
    }
    if (!stable) {
      throw new Error("The WebGPU glyph atlas did not stabilize after rebuild");
    }

    for (const range of ranges) {
      const firstCell = range.start * this.options.model.cols;
      const cellCount = (range.end - range.start + 1) * this.options.model.cols;
      const byteOffset = firstCell * PACKED_INSTANCE_BYTES;
      const byteLength = cellCount * PACKED_INSTANCE_BYTES;
      resources.device.queue.writeBuffer(
        this.instanceBuffer,
        byteOffset,
        this.instanceData,
        byteOffset,
        byteLength,
      );
      this.uploadCount += 1;
      this.uploadedBytes += byteLength;
    }

    if (this.atlasGeneration !== this.atlasLease.atlas.generation) {
      this.glyphBindGroup = resources.device.createBindGroup({
        layout: resources.glyphBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer as GPUBuffer } },
          {
            binding: 1,
            resource: this.atlasLease.atlas.coverageTextureView,
          },
          {
            binding: 2,
            resource: this.atlasLease.atlas.colorTextureView,
          },
          { binding: 3, resource: resources.glyphSampler },
        ],
      });
      this.atlasGeneration = this.atlasLease.atlas.generation;
    }
  }

  private replaceWithIsolatedAtlas(): void {
    const previous = this.atlasLease;
    const replacement = this.runtime.acquireIsolatedGlyphAtlas(
      this.metrics,
      this.scale,
      this.atlasOwnerKey,
      this,
    );
    this.atlasLease = replacement;
    this.atlasGeneration = 0;
    previous?.release();
  }

  private buildRows(
    cells: TerminalCellReader,
    firstRow: number,
    lastRow: number,
  ): void {
    const cols = this.options.model.cols;
    const cellWidth = this.metrics.cellWidth * this.scale;
    const cellHeight = this.metrics.cellHeight * this.scale;
    const viewportOriginLine = this.options.model.viewportOriginLine();
    const selectionBounds = this.selection.normalizedBounds();
    const leftPadding = Math.max(
      0,
      Math.floor((this.metrics.font.letterSpacing * this.scale) / 2),
    );
    const first = Math.max(0, firstRow);
    const last = Math.min(this.options.model.rows - 1, lastRow);

    for (let row = first; row <= last; row += 1) {
      let rowHasBlinkingCell = false;
      let previousBackground = this.themeBackground;
      for (let column = 0; column < cols; column += 1) {
        const index = row * cols + column;
        const width = cells.width(index);
        clearCellInstance(this.instanceBytes, index);
        clearGlyphInstance(this.instanceBytes, index);
        if (width === 0) continue;

        const flags = cells.flags(index);
        rowHasBlinkingCell ||= (flags & CellFlags.BLINK) !== 0;
        let foreground = cells.foregroundPacked(index);
        let background = cells.backgroundPacked(index);
        if ((flags & CellFlags.INVERSE) !== 0) {
          const originalForeground = foreground;
          foreground = background;
          background = originalForeground;
        }
        const searchMatch = this.search.matchAt(row, column);
        if (searchMatch !== 0) {
          background =
            searchMatch === 2
              ? SEARCH_ACTIVE_MATCH_BACKGROUND
              : SEARCH_MATCH_BACKGROUND;
        }
        if (
          selectionBounds &&
          selectionBoundsContain(
            selectionBounds,
            viewportOriginLine + row,
            column,
          )
        ) {
          background = blendPackedRgb(
            background,
            this.selectionColor,
            this.theme.selection.alpha,
          );
        }
        const originX = column * cellWidth;
        const originY = row * cellHeight;
        const spanWidth = width * cellWidth;
        const underlineStyle =
          (flags & CellFlags.UNDERLINE) !== 0
            ? cells.underlineStyle(index) & CELL_FLAG_UNDERLINE_MASK
            : 0;
        const cellFlags =
          underlineStyle |
          ((flags & CellFlags.STRIKETHROUGH) !== 0
            ? CELL_FLAG_STRIKETHROUGH
            : 0) |
          (cells.overline(index) ? CELL_FLAG_OVERLINE : 0);
        writeCellInstance(
          this.instanceView,
          index,
          originX,
          originY,
          spanWidth,
          cellHeight,
          background,
          cells.underlineColorPacked(index),
          foreground,
          cellFlags,
        );

        const codepoint = cells.codepoint(index);
        if (
          codepoint !== 0 &&
          codepoint !== 32 &&
          (flags & CellFlags.INVISIBLE) === 0
        ) {
          const grapheme =
            cells.graphemeLength(index) > 0
              ? this.options.model.grapheme(row, column)
              : null;
          const glyph = this.atlasLease?.atlas.glyph(
            codepoint,
            grapheme,
            flags,
          );
          if (glyph) {
            let offsetX = glyph.originOffsetX;
            let glyphWidth = glyph.width;
            let uvMinX = glyph.uvMinX;
            if (previousBackground !== background && offsetX < -leftPadding) {
              const clipped = Math.min(glyphWidth, -leftPadding - offsetX);
              offsetX += clipped;
              glyphWidth -= clipped;
              uvMinX += (glyph.uvMaxX - glyph.uvMinX) * (clipped / glyph.width);
            }
            let glyphFlags = glyph.intrinsicColor
              ? GLYPH_FLAG_INTRINSIC_COLOR
              : 0;
            if (this.atlasLease?.atlas.coverageInRed) {
              glyphFlags |= GLYPH_FLAG_COVERAGE_RED;
            }
            if ((flags & CellFlags.BLINK) !== 0) {
              glyphFlags |= GLYPH_FLAG_BLINK;
            }
            writeGlyphInstance(
              this.instanceView,
              index,
              originX + offsetX,
              originY + glyph.originOffsetY,
              glyphWidth,
              glyph,
              uvMinX,
              foreground,
              (flags & CellFlags.FAINT) !== 0 ? 0.5 : 1,
              glyphFlags,
            );
          }
        }
        previousBackground = background;
      }
      const hadBlinkingCell = this.blinkingRows[row] !== 0;
      if (hadBlinkingCell !== rowHasBlinkingCell) {
        this.blinkingRowCount += rowHasBlinkingCell ? 1 : -1;
        this.blinkingRows[row] = rowHasBlinkingCell ? 1 : 0;
      }
    }
  }

  private updateScreenUniform(resources: WebGpuSharedResources): boolean {
    if (!this.uniformBuffer) return false;
    this.screenData.fill(0);
    this.screenData[0] = this.canvas.width;
    this.screenData[1] = this.canvas.height;
    const cursor = this.options.model.cursor();
    this.nativeCursorVisible =
      cursor.visible &&
      cursor.x >= 0 &&
      cursor.x < this.options.model.cols &&
      cursor.y >= 0 &&
      cursor.y < this.options.model.rows;
    if (cursor.blinking !== this.cursorBlinking) {
      this.cursorBlinking = cursor.blinking;
      this.cursorVisible = true;
    }
    this.armCursorBlink();
    if (
      this.cursorEnabled &&
      this.cursorVisible &&
      cursor.visible &&
      cursor.x >= 0 &&
      cursor.x < this.options.model.cols &&
      cursor.y >= 0 &&
      cursor.y < this.options.model.rows
    ) {
      const cellWidth = this.metrics.cellWidth * this.scale;
      const cellHeight = this.metrics.cellHeight * this.scale;
      const x = cursor.x * cellWidth;
      const y = cursor.y * cellHeight;
      const style = cursor.style;
      this.screenData[2] = x;
      this.screenData[3] =
        style === "underline" ? y + cellHeight - Math.max(2, this.scale) : y;
      this.screenData[4] =
        style === "bar" ? Math.max(2, this.scale) : cellWidth;
      this.screenData[5] =
        style === "underline" ? Math.max(2, this.scale) : cellHeight;
    }
    this.screenData[6] = this.textBlinkVisible ? 1 : 0;
    this.screenData[7] = 0;
    this.screenData[8] = ((this.themeCursor >> 16) & 0xff) / 255;
    this.screenData[9] = ((this.themeCursor >> 8) & 0xff) / 255;
    this.screenData[10] = (this.themeCursor & 0xff) / 255;
    this.screenData[11] = 1;
    this.screenData[12] = this.metrics.baseline * this.scale;
    this.screenData[13] = Math.max(1, this.scale);
    this.screenData[14] = Math.floor(
      this.metrics.cellHeight * this.scale * 0.52,
    );
    let changed = !this.uniformUploaded;
    for (let index = 0; !changed && index < this.screenData.length; index++) {
      changed = this.screenData[index] !== this.uploadedScreenData[index];
    }
    if (!changed) return false;
    resources.device.queue.writeBuffer(this.uniformBuffer, 0, this.screenData);
    this.uploadedScreenData.set(this.screenData);
    this.uniformUploaded = true;
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
      this.blinkingRowCount === 0 ||
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

  private updateRootBackground(): void {
    this.root.style.backgroundColor = rgbToCss(this.theme.background);
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("WebGPU terminal surface is disposed");
  }
}

function createVertexBuffer(
  device: GPUDevice,
  size: number,
  label: string,
): GPUBuffer {
  return device.createBuffer({
    label,
    size,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
}

function blendPackedRgb(
  background: number,
  foreground: number,
  alpha: number,
): number {
  const amount = Math.max(0, Math.min(1, alpha));
  const inverse = 1 - amount;
  const red = Math.round(
    ((background >> 16) & 0xff) * inverse +
      ((foreground >> 16) & 0xff) * amount,
  );
  const green = Math.round(
    ((background >> 8) & 0xff) * inverse + ((foreground >> 8) & 0xff) * amount,
  );
  const blue = Math.round(
    (background & 0xff) * inverse + (foreground & 0xff) * amount,
  );
  return (red << 16) | (green << 8) | blue;
}

function packRgb(color: Rgb): number {
  return (color[0] << 16) | (color[1] << 8) | color[2];
}

function rgbClear(color: Rgb): GPUColor {
  return {
    r: color[0] / 255,
    g: color[1] / 255,
    b: color[2] / 255,
    a: 1,
  };
}

function fontMetricsKey(metrics: TerminalFontMetrics): string {
  return [
    metrics.font.family,
    metrics.font.size,
    metrics.font.lineHeight,
    metrics.font.letterSpacing,
    metrics.font.weight,
    metrics.cellWidth,
    metrics.cellHeight,
    metrics.baseline,
  ].join("|");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
