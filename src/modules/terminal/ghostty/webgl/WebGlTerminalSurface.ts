import type { TerminalSurface } from "@/modules/terminal/backend/contracts";
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
  XtermWebGlRenderer,
  XtermWebGlRendererStats,
} from "./XtermWebGlRenderer";

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
  readonly onOpenLink?: (uri: string) => void;
};

export type WebGlTerminalSurfaceStats = {
  readonly frames: number;
  readonly cols: number;
  readonly rows: number;
  readonly visible: boolean;
  readonly focused: boolean;
  readonly renderer: XtermWebGlRendererStats | null;
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
  private readonly selection: TerminalSelectionController;
  private readonly search: GhosttySearchController;
  private readonly runtime: WebGlTerminalRuntime;
  private readonly pixelRatioMonitor: DevicePixelRatioMonitor;
  private readonly fitQueue = new TerminalFitQueue();
  private renderer: XtermWebGlRenderer | null = null;
  private metrics: TerminalFontMetrics;
  private theme: TerminalGpuTheme;
  private host: HTMLElement | null = null;
  private scale = 1;
  private visible = true;
  private focused = false;
  private cursorVisible = true;
  private cursorBlinking: boolean;
  private cursorTimer: number | null = null;
  private textBlinkVisible = true;
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
  private disposed = false;

  constructor(private readonly options: WebGlTerminalSurfaceOptions) {
    this.runtime = getWebGlTerminalRuntime();
    this.metrics = options.metrics;
    this.pixelRatioMonitor = new DevicePixelRatioMonitor(() =>
      this.resizeToHost(),
    );
    this.theme = options.theme;
    this.cursorBlinking = options.cursorBlink;
    options.model.setCursorOptions(options.cursorStyle, options.cursorBlink);
    this.contentRevision = options.model.revision();
    this.root.className = "absolute inset-0 overflow-hidden";
    this.root.style.userSelect = "none";
    this.root.style.backgroundColor = rgbToCss(options.theme.background);
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

    this.selection = new TerminalSelectionController({
      model: options.model,
      target: this.root,
      cellSize: () => this.cellSize(),
      shouldIgnoreTarget: (target) =>
        target instanceof Node && this.scrollbar.contains(target),
      onChange: () => {
        if (this.applyingFit) return;
        this.renderer?.resetModel();
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
      const revision = options.model.revision();
      if (revision !== this.contentRevision) {
        this.contentRevision = revision;
        this.selection.reconcile();
      }
      if (this.hoveredCell >= 0) this.clearHoveredLink();
      this.cursorVisible = true;
      this.textBlinkVisible = true;
      this.updateScrollbar();
      this.search.refresh();
      if (!this.applyingFit) this.runtime.schedule(this);
      this.armCursorBlink();
    });
    this.root.addEventListener("pointerdown", this.handlePointerDown);
    this.root.addEventListener("mousemove", this.handleLinkMouseMove);
    this.root.addEventListener("mousedown", this.handleLinkMouseDown);
    this.root.addEventListener("mouseup", this.handleLinkMouseUp);
    this.root.addEventListener("mouseleave", this.handleLinkMouseLeave);
    this.input.addEventListener("focus", this.handleFocus);
    this.input.addEventListener("blur", this.handleBlur);
    this.scrollbar.addEventListener("scroll", this.handleScroll);
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
    if (this.visible) {
      this.renderer = this.runtime.acquire(this, this.root, this.profile());
      this.resizeToHost();
    }
    this.updateScrollbar();
    if (this.visible) this.runtime.schedule(this);
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
    this.root.style.visibility = visible ? "visible" : "hidden";
    if (visible) {
      if (this.host && !this.renderer) {
        this.scale = Math.max(1, window.devicePixelRatio || 1);
        this.renderer = this.runtime.acquire(this, this.root, this.profile());
        this.resizeToHost();
      }
      this.renderer?.resetModel();
      this.runtime.schedule(this);
      this.armCursorBlink();
    } else {
      this.clearCursorTimer();
      this.clearTextBlinkTimer();
      this.textBlinkVisible = true;
      this.runtime.release(this);
      this.renderer = null;
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
    this.root.style.backgroundColor = rgbToCss(theme.background);
    if (!this.renderer || !this.host) return;
    this.renderer = this.runtime.acquire(this, this.root, this.profile());
    this.renderer.resetModel();
    this.runtime.schedule(this);
  }

  setFontMetrics(metrics: TerminalFontMetrics): void {
    if (fontMetricsKey(this.metrics) === fontMetricsKey(metrics)) return;
    this.metrics = metrics;
    if (this.renderer && this.host) {
      this.renderer = this.runtime.acquire(this, this.root, this.profile());
      this.resizeToHost();
      this.renderer.resetModel();
      this.runtime.schedule(this);
    }
    this.updateScrollbar();
  }

  cellSize(): { readonly width: number; readonly height: number } {
    return { width: this.metrics.cellWidth, height: this.metrics.cellHeight };
  }

  getSelection(): string | null {
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

  renderFrame(renderer: XtermWebGlRenderer): boolean {
    if (this.disposed || !this.visible || !this.host) {
      return false;
    }
    this.applyQueuedFit();
    if (renderer !== this.renderer) {
      this.runtime.schedule(this);
      return false;
    }
    if (this.options.model.deferPresentation()) return false;
    const rendered = renderer.render({
      model: this.options.model,
      damage: this.options.model.consumeDamage(),
      cursorVisible: this.cursorVisible,
      textBlinkVisible: this.textBlinkVisible,
      hasSelection: this.selection.value !== null,
      selectionContains: (line, column) =>
        this.selection.contains(line, column),
      searchMatchAt: (row, column) => this.search.matchAt(row, column),
    });
    if (!rendered) return false;
    this.syncTextBlink(renderer.hasBlinkingCells);
    this.consecutiveRendererErrors = 0;
    this.frameCount += 1;
    if (this.frameCount === 1) this.options.onFirstFrame?.();
    return true;
  }

  handleRendererError(error: Error): void {
    if (
      this.disposed ||
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
    this.runtime.discard(this);
    this.renderer = null;
    try {
      this.renderer = this.runtime.acquire(this, this.root, this.profile());
      this.resizeToHost();
      this.renderer.resetModel();
      this.rendererRecoveryCount += 1;
      this.runtime.schedule(this);
    } catch (recoveryError) {
      this.runtime.discard(this);
      this.renderer = null;
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
    this.search.dispose();
    this.selection.dispose();
    this.root.removeEventListener("pointerdown", this.handlePointerDown);
    this.root.removeEventListener("mousemove", this.handleLinkMouseMove);
    this.root.removeEventListener("mousedown", this.handleLinkMouseDown);
    this.root.removeEventListener("mouseup", this.handleLinkMouseUp);
    this.root.removeEventListener("mouseleave", this.handleLinkMouseLeave);
    this.input.removeEventListener("focus", this.handleFocus);
    this.input.removeEventListener("blur", this.handleBlur);
    this.scrollbar.removeEventListener("scroll", this.handleScroll);
  }

  private readonly handlePointerDown = (): void => this.focus();

  private readonly handleFocus = (): void => this.setFocused(true);

  private readonly handleBlur = (): void => this.setFocused(false);

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

  private readonly handleScroll = (): void => {
    if (!this.host) return;
    const { history } = this.options.model.scrollPosition();
    const line = Math.round(this.scrollbar.scrollTop / this.metrics.cellHeight);
    this.options.model.scrollTo(history - line);
    this.search.refresh();
  };

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
  }

  private resizeToHost(
    measuredBounds?: Pick<DOMRectReadOnly, "width" | "height">,
    scheduleRender = true,
  ): void {
    if (!this.host || !this.renderer) return;
    this.fitQueue.clear();
    const nextScale = Math.max(1, window.devicePixelRatio || 1);
    if (nextScale !== this.scale) {
      this.scale = nextScale;
      this.runtime.release(this);
      this.renderer = this.runtime.acquire(this, this.root, this.profile());
    }

    const bounds = measuredBounds ?? this.host.getBoundingClientRect();
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
    const rendererChanged = this.renderer.resize(cols, rows);
    if (rendererChanged) {
      this.options.model.setPixelSize(pixelWidth, pixelHeight);
    }
    if (changed) this.options.onResize(cols, rows);
    this.updateScrollbar();
    if (scheduleRender && (changed || rendererChanged)) {
      this.runtime.schedule(this);
    }
  }

  private updateScrollbar(): void {
    if (!this.host) return;
    const { history, offset } = this.options.model.scrollPosition();
    const available =
      history > 0 && !this.options.model.modes().alternateScreen;
    this.scrollbar.style.visibility = available ? "visible" : "hidden";
    this.scrollbar.setAttribute("aria-valuemin", "0");
    this.scrollbar.setAttribute("aria-valuemax", String(history));
    this.scrollbar.setAttribute("aria-valuenow", String(history - offset));
    if (!available) return;

    const cellHeight = this.metrics.cellHeight;
    this.scrollbarContent.style.height = `${this.host.clientHeight + history * cellHeight}px`;
    const target = (history - offset) * cellHeight;
    if (Math.abs(this.scrollbar.scrollTop - target) >= 0.5) {
      this.scrollbar.scrollTop = target;
    }
  }

  private armCursorBlink(): void {
    if (
      !this.cursorBlinking ||
      !this.focused ||
      !this.visible ||
      !this.host ||
      document.visibilityState !== "visible"
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

  private syncTextBlink(hasBlinkingCells: boolean): void {
    if (!hasBlinkingCells) {
      this.clearTextBlinkTimer();
      this.textBlinkVisible = true;
      return;
    }
    this.armTextBlink();
  }

  private armTextBlink(): void {
    if (
      this.textBlinkTimer !== null ||
      !this.visible ||
      !this.host ||
      document.visibilityState !== "visible"
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
