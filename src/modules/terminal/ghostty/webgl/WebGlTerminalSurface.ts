import { terminalWindowFocused } from "@/modules/terminal/ghostty/renderScheduling";
import { bindTerminalInteraction } from "@/modules/terminal/ghostty/input/terminalInteraction";
import { TerminalScrollbarSync } from "@/modules/terminal/ghostty/gpu/terminalScrollbar";
import {
  subscribeWindowPresentation,
  terminalWindowPresentation,
} from "@/modules/terminal/ghostty/windowPresentation";
import type { WindowPresentation } from "@/modules/terminal/ghostty/WindowPresentationPolicy";
import type { TerminalSurface } from "@/modules/terminal/backend/contracts";
import {
  subscribeTerminalResizeInteraction,
  terminalResizeInteractionActive,
} from "@/modules/terminal/lib/terminalResizeInteraction";
import type { GhosttyTerminalModelApi } from "../GhosttyTerminalModel";
import { DevicePixelRatioMonitor } from "../gpu/DevicePixelRatioMonitor";
import { fitTerminalViewport } from "../gpu/TerminalFit";
import {
  TerminalFitQueue,
  type TerminalFitQueueDiagnostics,
} from "../gpu/TerminalFitQueue";
import type {
  TerminalFontMetrics,
  TerminalGpuTheme,
} from "../gpu/terminalVisuals";
import { rgbToCss } from "../gpu/terminalVisuals";
import { GhosttySearchController } from "../search/GhosttySearchController";
import { TerminalSelectionController } from "../selection/TerminalSelectionController";
import {
  getWebGlTerminalRuntime,
  type WebGlRuntimeSurface,
  type WebGlTerminalRuntime,
} from "./WebGlTerminalRuntime";
import type {
  WebGlCellRenderer,
  WebGlCellRendererStats,
} from "./WebGlCellRenderer";

const CURSOR_BLINK_MS = 600;
const TEXT_BLINK_MS = 600;
const MAX_SURFACE_CELLS = 262_144;

export type WebGlTerminalSurfaceOptions = {
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

export type WebGlTerminalSurfaceStats = {
  readonly frames: number;
  readonly cols: number;
  readonly rows: number;
  readonly visible: boolean;
  readonly documentSuspended: boolean;
  readonly focused: boolean;
  readonly renderer: WebGlCellRendererStats | null;
  readonly rendererRecoveries: number;
  readonly fit: TerminalFitQueueDiagnostics;
};

export class WebGlTerminalSurface
  implements TerminalSurface, WebGlRuntimeSurface
{
  readonly backend = "ghostty-webgl" as const;

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
  private readonly runtime: WebGlTerminalRuntime;
  private readonly pixelRatioMonitor: DevicePixelRatioMonitor;
  private readonly fitQueue = new TerminalFitQueue();
  private renderer: WebGlCellRenderer | null = null;
  private metrics: TerminalFontMetrics;
  private theme: TerminalGpuTheme;
  private host: HTMLElement | null = null;
  private scale = 1;
  private visible = true;
  private synchronizedScrollTop: number | null = null;
  private readonly scrollbarSync = new TerminalScrollbarSync();
  private scrollbarViewportHeight = 0;
  private focused = false;
  private documentSuspended = !terminalWindowPresentation().visible;
  private resizeInteractionActive = terminalResizeInteractionActive();
  private compactAfterResize = false;
  private nativeCursorVisible = false;
  private windowFocused = terminalWindowFocused();
  private cursorVisible = true;
  private cursorEnabled = true;
  private cursorBlinking: boolean;
  private cursorTimer: number | null = null;
  private textBlinkVisible = true;
  private hasBlinkingCells = false;
  private textBlinkTimer: number | null = null;
  private frameCount = 0;
  private rendererRecoveryCount = 0;
  private consecutiveRendererErrors = 0;
  private recoveringRenderer = false;
  private contentRevision: number;
  private hoveredCell = -1;
  private hoveredLink: string | null = null;
  private mouseDownLink: string | null = null;
  private applyingFit = false;
  private readonly unsubscribePresentation: () => void;
  private disposed = false;

  constructor(private readonly options: WebGlTerminalSurfaceOptions) {
    this.runtime = getWebGlTerminalRuntime();
    this.metrics = options.metrics;
    this.pixelRatioMonitor = new DevicePixelRatioMonitor(() => {
      try {
        this.resizeToHost();
      } catch (error) {
        this.handleRendererError(toError(error));
      }
    });
    this.theme = options.theme;
    this.cursorBlinking = options.cursorBlink;
    options.model.setCursorOptions(options.cursorStyle, options.cursorBlink);
    this.contentRevision = options.model.revision();
    this.root.className = "absolute inset-0 overflow-hidden";
    this.root.style.userSelect = "none";
    this.updateRootBackground();
    this.root.setAttribute("data-terax-ghostty-surface", "webgl");
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
      shouldIgnoreTarget: (target) =>
        target instanceof Node && this.scrollbar.contains(target),
      onChange: () => {
        if (this.applyingFit) return;
        this.runtime.schedule(this);
      },
    });
    this.search = new GhosttySearchController(options.model, () => {
      if (this.applyingFit) return;
      this.renderer?.resetModel();
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
    this.unsubscribePresentation = subscribeWindowPresentation(
      this.handleVisibilityChange,
    );
  }

  attach(container: HTMLElement): void {
    this.assertLive();
    if (this.host === container) return;
    if (this.host) this.detach();
    this.host = container;
    container.appendChild(this.root);
    this.scale = Math.max(1, window.devicePixelRatio || 1);
    this.pixelRatioMonitor.start();
    this.resizeObserver.observe(container);
    if (this.visible && !this.documentSuspended) {
      this.acquireRenderer();
      this.resizeToHost();
    }
    this.updateScrollbar();
    if (this.visible && !this.documentSuspended) this.runtime.schedule(this);
  }

  detach(): void {
    if (!this.host) return;
    this.resizeObserver.disconnect();
    this.fitQueue.clear();
    this.pixelRatioMonitor.stop();
    this.clearCursorTimer();
    this.clearTextBlinkTimer();
    this.runtime.release(this);
    this.renderer = null;
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
      if (this.host && !this.renderer && !this.documentSuspended) {
        this.scale = Math.max(1, window.devicePixelRatio || 1);
        try {
          this.acquireRenderer();
          this.resizeToHost();
        } catch (error) {
          this.handleRendererError(toError(error));
          return;
        }
      }
      this.renderer?.resetModel();
      this.runtime.schedule(this);
      this.armCursorBlink();
    } else {
      this.clearCursorTimer();
      this.clearTextBlinkTimer();
      this.textBlinkVisible = true;
      this.search.suspend();
      this.selection.suspend();
      this.runtime.release(this);
      this.renderer = null;
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
    if (!this.renderer || !this.host || this.documentSuspended) return;
    try {
      this.acquireRenderer().resetModel();
      this.runtime.schedule(this);
    } catch (error) {
      this.handleRendererError(toError(error));
    }
  }

  setFontMetrics(metrics: TerminalFontMetrics): void {
    if (fontMetricsKey(this.metrics) === fontMetricsKey(metrics)) return;
    this.metrics = metrics;
    if (this.renderer && this.host && !this.documentSuspended) {
      try {
        this.acquireRenderer();
        this.resizeToHost();
        this.renderer?.resetModel();
        this.runtime.schedule(this);
      } catch (error) {
        this.handleRendererError(toError(error));
      }
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

  renderFrame(renderer: WebGlCellRenderer): boolean {
    if (
      this.disposed ||
      !this.visible ||
      this.documentSuspended ||
      !this.host
    ) {
      return false;
    }
    this.applyQueuedFit();
    if (renderer !== this.renderer) {
      this.runtime.schedule(this);
      return false;
    }
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
    const cursor = this.options.model.cursor();
    this.nativeCursorVisible =
      cursor.visible &&
      cursor.x >= 0 &&
      cursor.x < this.options.model.cols &&
      cursor.y >= 0 &&
      cursor.y < this.options.model.rows;
    this.cursorBlinking = cursor.blinking;
    this.armCursorBlink();
    const rendered = renderer.render({
      model: this.options.model,
      damage: this.options.model.consumeDamage(),
      cursorVisible: this.cursorEnabled && this.cursorVisible,
      textBlinkVisible: this.textBlinkVisible,
      selection: this.selection.normalizedBounds(),
      searchMatchAt: (row, column) => this.search.matchAt(row, column),
    });
    this.hasBlinkingCells = renderer.hasBlinkingCells;
    this.syncTextBlink();
    if (!rendered) {
      this.options.onFrame?.();
      return false;
    }
    this.consecutiveRendererErrors = 0;
    this.frameCount += 1;
    if (this.frameCount === 1) this.options.onFirstFrame?.();
    this.options.onFrame?.();
    return true;
  }

  handleRendererError(error: Error): void {
    if (this.disposed) return;
    this.discardRenderer();
    this.clearCursorTimer();
    this.clearTextBlinkTimer();
    if (this.documentSuspended) return;
    if (
      this.recoveringRenderer ||
      this.consecutiveRendererErrors > 0 ||
      !this.visible ||
      !this.host
    ) {
      this.options.onError(error);
      return;
    }

    this.consecutiveRendererErrors += 1;
    this.recoveringRenderer = true;
    try {
      this.acquireRenderer();
      this.resizeToHost();
      this.renderer?.resetModel();
      this.rendererRecoveryCount += 1;
      this.runtime.schedule(this);
    } catch (recoveryError) {
      this.discardRenderer();
      this.options.onError(
        new Error(
          `WebGL renderer recovery failed after ${error.message}: ${toError(recoveryError).message}`,
        ),
      );
    } finally {
      this.recoveringRenderer = false;
    }
  }

  diagnostics(): WebGlTerminalSurfaceStats {
    return {
      frames: this.frameCount,
      cols: this.options.model.cols,
      rows: this.options.model.rows,
      visible: this.visible,
      documentSuspended: this.documentSuspended,
      focused: this.focused,
      renderer: this.renderer?.diagnostics() ?? null,
      rendererRecoveries: this.rendererRecoveryCount,
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
    this.unsubscribePresentation();
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

  private readonly handleVisibilityChange = ({
    visible,
    reclaim,
  }: WindowPresentation): void => {
    const wasSuspended = this.documentSuspended;
    this.documentSuspended = !visible;
    if (!visible) {
      this.clearCursorTimer();
      this.clearTextBlinkTimer();
      this.textBlinkVisible = true;
      this.search.suspend();
      this.selection.suspend();
      if (reclaim) {
        this.options.model.releasePresentationResources();
        this.discardRenderer();
        this.runtime.trimForHiddenDocument();
      }
      return;
    }
    if (!wasSuspended || !this.visible || !this.host) return;
    this.search.resume();
    try {
      this.scale = Math.max(1, window.devicePixelRatio || 1);
      this.acquireRenderer();
      this.resizeToHost();
      this.renderer?.requestPresentation();
      this.runtime.schedule(this);
      this.armCursorBlink();
    } catch (error) {
      this.handleRendererError(toError(error));
    }
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

  private discardRenderer(): void {
    this.runtime.discard(this);
    this.renderer = null;
  }

  private acquireRenderer(): WebGlCellRenderer {
    // Reconfiguration may dispose the previous lease before throwing.
    this.renderer = null;
    const renderer = this.runtime.acquire(this, this.root, this.profile());
    this.renderer = renderer;
    return renderer;
  }

  private profile() {
    return {
      metrics: this.metrics,
      theme: this.theme,
      scale: this.scale,
    } as const;
  }

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
      this.renderer?.resetModel();
    }
  }

  private resizeToHost(
    measuredBounds?: Pick<DOMRectReadOnly, "width" | "height">,
    scheduleRender = true,
  ): void {
    if (!this.host || !this.renderer || this.documentSuspended) return;
    this.fitQueue.clear();
    const nextScale = Math.max(1, window.devicePixelRatio || 1);
    if (nextScale !== this.scale) {
      this.scale = nextScale;
      this.runtime.release(this);
      this.acquireRenderer();
    }

    const bounds = measuredBounds ?? this.host.getBoundingClientRect();
    this.scrollbarSync.invalidate();
    this.scrollbarViewportHeight = Math.round(bounds.height);
    const fit = fitTerminalViewport(
      bounds.width,
      bounds.height,
      this.metrics,
      this.scale,
    );
    if (!fit) return;
    const { cols, rows, pixelWidth, pixelHeight } = fit;
    if (cols * rows > MAX_SURFACE_CELLS) {
      this.options.onError(
        new Error(
          `Terminal surface exceeds ${MAX_SURFACE_CELLS} visible cells`,
        ),
      );
      return;
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
    const rendererChanged = this.renderer.resize(
      cols,
      rows,
      this.resizeInteractionActive,
    );
    if (changed || rendererChanged) {
      this.options.model.setPixelSize(pixelWidth, pixelHeight);
    }
    if (changed) this.options.onResize(cols, rows);
    this.updateScrollbar();
    if (scheduleRender && (changed || rendererChanged)) {
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
      !this.hasBlinkingCells ||
      !this.windowFocused ||
      this.documentSuspended
    ) {
      this.clearTextBlinkTimer();
      this.textBlinkVisible = true;
      return;
    }
    this.armTextBlink();
  }

  private armTextBlink(): void {
    if (
      this.textBlinkTimer !== null ||
      !this.windowFocused ||
      this.documentSuspended ||
      !this.visible ||
      !this.host ||
      !terminalWindowPresentation().visible
    ) {
      return;
    }
    this.textBlinkTimer = window.setTimeout(() => {
      this.textBlinkTimer = null;
      this.textBlinkVisible = !this.textBlinkVisible;
      this.runtime.schedule(this);
      this.armTextBlink();
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
    if (this.disposed) throw new Error("WebGL terminal surface is disposed");
  }
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
