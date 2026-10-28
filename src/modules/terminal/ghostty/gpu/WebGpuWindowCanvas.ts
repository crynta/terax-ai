import { smoothHooks } from "@/bench/smoothHooks";
import { noteTerminalHostResize } from "@/modules/terminal/lib/terminalResizeGesture";
import {
  subscribeTerminalResizeInteraction,
  terminalResizeInteractionActive,
} from "@/modules/terminal/lib/terminalResizeInteraction";
import type { Rgb } from "../core/packedCells";
import { CanvasBackingStore, type GestureGrowth } from "./CanvasBackingStore";
import { DevicePixelRatioMonitor } from "./DevicePixelRatioMonitor";
import {
  type CssSize,
  gestureBackingBound,
  measureGestureBackingEnvironment,
  windowInnerSize,
} from "./GestureBacking";
import {
  clampToCanvas,
  type CssRect,
  cssRectsEqual,
  type DeviceRect,
  deviceRectsEqual,
  snapPaneRect,
} from "./PaneRects";
import { snapOffsetCss } from "./TerminalFit";
import { devicePixelScale } from "./terminalVisuals";
import type { WebGpuSharedResources } from "./WebGpuTerminalRuntime";

/**
 * One WebGPU canvas for a whole window's terminal area, shared by every visible pane.
 *
 * WebKit (macOS 26) keeps the swapchain of a presented WebGPU canvas that was destroyed, and
 * the buffers of every swapchain a resizing canvas retires, until JavaScriptCore happens to
 * collect the wrappers (minutes). A canvas per pane therefore cost a swapchain on every tab
 * switch between different pane geometries (the panes' canvases were resized) and one per
 * step of a window drag. Here the canvas follows the terminal area only: a tab switch, a pane
 * split or a divider drag moves viewports inside it and never reallocates it, and a window
 * drag reallocates it at most twice (`CanvasBackingStore`, `GestureBacking`).
 *
 * Canvas textures are not preserved between frames, so a frame clears the canvas and draws
 * every visible pane into its device-pixel rectangle (`setViewport` plus `setScissorRect`, the
 * scissor stops glyph overhang from reaching a neighbour). Cell buffers stay resident on the
 * GPU and no per-cell work happens, so drawing panes that did not change costs encoding only.
 * A frame is still produced only when something changed (`windowFrameNeeded`).
 *
 * The canvas is never destroyed, unconfigured or shrunk while the runtime lives. It stays in
 * the document with its size when no pane is visible (an editor tab is active, the window is
 * occluded) and is only hidden.
 */

export type WindowCanvasConfiguration = {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly generation: number;
};

/** What the window canvas needs from a pane to draw it. */
export interface WindowCanvasPane {
  /** The pane has uploaded a frame and its bind group is ready. */
  drawable(): boolean;
  /** Theme background; the first drawable pane's colour clears the canvas. */
  background(): Rgb;
  /** Encodes the pane's draw calls; viewport and scissor already cover its rectangle. */
  encode(pass: GPURenderPassEncoder, resources: WebGpuSharedResources): void;
  /** App lab: id in the smoothness probe. */
  readonly benchId?: number;
}

/** The pane's side of its membership in the window canvas. */
export type PaneBinding = {
  /** The pane host's rectangle changed (layout callback or explicit measurement). */
  setBounds(bounds: CssRect): void;
  /** The pane's rectangle in canvas device pixels; valid after `beginFrame`. */
  rect(): DeviceRect | null;
  /** The pane's pixels changed in a way only a window frame can show (resumed, restyled). */
  invalidate(): void;
};

type PaneState = {
  readonly host: HTMLElement;
  css: CssRect | null;
  rect: DeviceRect | null;
  /** Drawn at least once since it joined. */
  drawn: boolean;
};

export type WindowFrameStart = {
  /** The backing store was reallocated: the canvas is blank and everything must draw. */
  readonly reallocated: boolean;
  /** Panes whose rectangle changed; they must refresh their uniform before drawing. */
  readonly moved: readonly WindowCanvasPane[];
};

export type WindowFrameResult = {
  readonly drawn: number;
  /** Panes drawn for the first time since they joined. */
  readonly revealed: readonly WindowCanvasPane[];
};

export type WindowCanvasStats = {
  readonly width: number;
  readonly height: number;
  readonly colorBytes: number;
  readonly panes: number;
  readonly drawable: number;
  /** Backing-store allocations since the canvas was created, including the first. */
  readonly reallocations: number;
  readonly frames: number;
  readonly geometryChecks: number;
  readonly geometryCorrections: number;
  readonly gestureActive: boolean;
  readonly reconfigured: number;
};

/**
 * The element a pane's canvas lives in: the terminal area marked `[data-terminal-area]` that
 * contains the host (a harness), else the area layer of the pane's `[data-terminal-stack]`
 * (`TerminalStack` keeps it beside the tab layers, not above them), else the host's parent.
 */
export function findTerminalArea(host: HTMLElement): HTMLElement {
  const ancestor = host.closest?.("[data-terminal-area]") as HTMLElement | null;
  if (ancestor) return ancestor;
  const layer = host
    .closest?.("[data-terminal-stack]")
    ?.querySelector(":scope > [data-terminal-area]") as HTMLElement | null;
  return layer ?? host.parentElement ?? host;
}

/** How long an empty canvas stays visible before it is hidden. */
export const HIDE_DELAY_MS = 250;

/** How often the layout is re-read while frames are produced, as a safety net (see below). */
export const GEOMETRY_CHECK_INTERVAL_MS = 1_000;

/**
 * A window frame is produced only when a pane's pixels changed, the canvas was reallocated or
 * a pane moved, appeared or disappeared, and only when something can be drawn. An unchanged
 * frame acquires no texture.
 */
export function windowFrameNeeded(state: {
  readonly paneChanged: boolean;
  readonly dirty: boolean;
  readonly reallocated: boolean;
  readonly moved: number;
  readonly drawable: number;
}): boolean {
  if (state.drawable === 0) return false;
  return (
    state.paneChanged || state.dirty || state.reallocated || state.moved > 0
  );
}

export class WebGpuWindowCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly context: GPUCanvasContext;
  private readonly backing: CanvasBackingStore;
  private readonly panes = new Map<WindowCanvasPane, PaneState>();
  private readonly observer: ResizeObserver;
  private readonly pixelRatioMonitor: DevicePixelRatioMonitor;
  private readonly unsubscribeGesture: () => void;
  private area: HTMLElement | null = null;
  private areaCss: CssRect | null = null;
  private areaDevice: { width: number; height: number } | null = null;
  private scale = devicePixelScale();
  private appliedTransform = "";
  private generation: number;
  private device: GPUDevice;
  private gestureActive = terminalResizeInteractionActive();
  private gestureStartInner: CssSize = windowInnerSize();
  private layoutStale = true;
  private dirty = true;
  private shown = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private lastGeometryCheck = Number.NEGATIVE_INFINITY;
  private reallocations = 0;
  private frames = 0;
  private geometryChecks = 0;
  private geometryCorrections = 0;
  private reconfigurations = 0;
  private disposed = false;

  constructor(
    configuration: WindowCanvasConfiguration,
    private readonly hooks: { readonly requestFrame: () => void },
  ) {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("data-terax-terminal-canvas", "");
    canvas.style.cssText =
      "position:absolute;left:0;top:0;display:block;pointer-events:none;visibility:hidden;";
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("WebGPU canvas context is unavailable");
    try {
      context.configure({
        device: configuration.device,
        format: configuration.format,
        alphaMode: "opaque",
      });
    } catch (error) {
      // Never presented, so nothing is retained by dropping it.
      context.unconfigure();
      canvas.width = 1;
      canvas.height = 1;
      throw error;
    }
    this.canvas = canvas;
    this.context = context;
    this.generation = configuration.generation;
    this.device = configuration.device;
    this.backing = new CanvasBackingStore(canvas);
    this.observer = new ResizeObserver(() => {
      if (!this.area) return;
      noteTerminalHostResize(this);
      this.measureArea();
    });
    this.pixelRatioMonitor = new DevicePixelRatioMonitor(() =>
      this.measureArea(),
    );
    this.unsubscribeGesture = subscribeTerminalResizeInteraction((active) => {
      this.gestureActive = active;
      if (active) {
        this.gestureStartInner = windowInnerSize();
        return;
      }
      // The gesture is over: shrink the backing to the area, once.
      this.restage();
      this.requestFrame();
    });
  }

  get hostArea(): HTMLElement | null {
    return this.area;
  }

  get paneCount(): number {
    return this.panes.size;
  }

  /**
   * Places the canvas first in the area (so the panes' DOM paints above it) and starts
   * following the area's size. The same element moves to a new area when the old one is gone.
   */
  mount(area: HTMLElement): void {
    if (this.area === area) return;
    if (this.area) {
      this.observer.disconnect();
      this.pixelRatioMonitor.stop();
      window.removeEventListener?.("resize", this.handleWindowResize);
    }
    this.area = area;
    area.insertBefore(this.canvas, area.firstChild);
    try {
      this.observer.observe(area, { box: "device-pixel-content-box" });
    } catch {
      this.observer.observe(area);
    }
    window.addEventListener?.("resize", this.handleWindowResize);
    this.pixelRatioMonitor.start();
    this.measureArea();
    this.layoutStale = true;
    this.dirty = true;
  }

  addPane(pane: WindowCanvasPane, host: HTMLElement): PaneBinding {
    const state: PaneState = { host, css: null, rect: null, drawn: false };
    this.panes.set(pane, state);
    this.layoutStale = true;
    this.dirty = true;
    return {
      setBounds: (bounds) => {
        if (!this.panes.has(pane) || cssRectsEqual(state.css, bounds)) return;
        if (__TERAX_BENCH__ && pane.benchId !== undefined)
          smoothHooks()?.rect(pane.benchId, performance.now());
        state.css = bounds;
        this.layoutStale = true;
      },
      rect: () => state.rect,
      invalidate: () => {
        if (!this.panes.has(pane)) return;
        this.dirty = true;
      },
    };
  }

  removePane(pane: WindowCanvasPane): void {
    if (!this.panes.delete(pane)) return;
    this.layoutStale = true;
    this.dirty = true;
    if (this.panes.size === 0) this.hide();
  }

  hasPane(pane: WindowCanvasPane): boolean {
    return this.panes.has(pane);
  }

  firstPane(): WindowCanvasPane | undefined {
    return this.panes.keys().next().value;
  }

  /** True while something outside the panes asks for a redraw. */
  get isDirty(): boolean {
    return this.dirty;
  }

  /** The window must draw again (resumed from a pause, a device change). */
  markDirty(): void {
    this.dirty = true;
  }

  /** The canvas now belongs to a replacement device: same element, same swapchain. */
  reconfigure(configuration: WindowCanvasConfiguration): void {
    if (this.disposed || configuration.generation === this.generation) return;
    this.context.configure({
      device: configuration.device,
      format: configuration.format,
      alphaMode: "opaque",
    });
    this.generation = configuration.generation;
    this.device = configuration.device;
    this.reconfigurations += 1;
    this.dirty = true;
    // Reconfiguring cleared the canvas, and the panes cover it again (`handleDeviceLoss`):
    // each one is revealed anew by the first frame the replacement device draws for it.
    for (const state of this.panes.values()) state.drawn = false;
  }

  /**
   * Applies the layout the callbacks measured since the last frame: commits the backing store
   * and recomputes every pane's device rectangle. Reads no DOM.
   */
  beginFrame(): WindowFrameStart {
    const benchStart = __TERAX_BENCH__ ? performance.now() : 0;
    const reallocated = this.backing.commit();
    if (reallocated) {
      if (__TERAX_BENCH__) {
        const now = performance.now();
        smoothHooks()?.realloc(
          now,
          now - benchStart,
          this.canvas.width,
          this.canvas.height,
          this.gestureActive,
          this.areaDevice
            ? `${this.areaDevice.width}x${this.areaDevice.height}`
            : "-",
        );
      }
      this.reallocations += 1;
      this.layoutStale = true;
    }
    const moved: WindowCanvasPane[] = [];
    if (this.layoutStale) {
      this.layoutStale = false;
      const area = this.areaCss;
      const size = this.backing.size;
      for (const [pane, state] of this.panes) {
        const next =
          area && state.css
            ? clampToCanvas(
                snapPaneRect(state.css, area, this.scale),
                size.width,
                size.height,
              )
            : null;
        if (deviceRectsEqual(next, state.rect)) {
          if (__TERAX_BENCH__ && pane.benchId !== undefined)
            smoothHooks()?.unchanged(pane.benchId);
          continue;
        }
        state.rect = next;
        moved.push(pane);
      }
    }
    return { reallocated, moved };
  }

  /** Takes and clears the "something outside the panes changed" flag. */
  consumeDirty(): boolean {
    const dirty = this.dirty;
    this.dirty = false;
    return dirty;
  }

  drawableCount(): number {
    let count = 0;
    for (const [pane, state] of this.panes) {
      if (state.rect && pane.drawable()) count += 1;
    }
    return count;
  }

  /**
   * Clears the canvas and draws every drawable pane into its rectangle. Call only after
   * `windowFrameNeeded`: it acquires the canvas texture.
   */
  encode(
    encoder: GPUCommandEncoder,
    resources: WebGpuSharedResources,
  ): WindowFrameResult {
    let clear: GPUColor | null = null;
    const drawable: Array<[WindowCanvasPane, PaneState]> = [];
    for (const entry of this.panes) {
      if (!entry[1].rect || !entry[0].drawable()) continue;
      drawable.push(entry);
      clear ??= rgbClear(entry[0].background());
    }
    if (!clear) return { drawn: 0, revealed: [] };
    const pass = encoder.beginRenderPass({
      label: "Terax terminal window pass",
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: clear,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    const revealed: WindowCanvasPane[] = [];
    for (const [pane, state] of drawable) {
      const rect = state.rect as DeviceRect;
      pass.setViewport(rect.x, rect.y, rect.width, rect.height, 0, 1);
      pass.setScissorRect(rect.x, rect.y, rect.width, rect.height);
      pane.encode(pass, resources);
      if (!state.drawn) {
        state.drawn = true;
        revealed.push(pane);
      }
    }
    pass.end();
    if (__TERAX_BENCH__) {
      const now = performance.now();
      for (const [pane] of drawable)
        if (pane.benchId !== undefined) smoothHooks()?.drawn(pane.benchId, now);
    }
    this.frames += 1;
    this.show();
    return { drawn: drawable.length, revealed };
  }

  /**
   * Safety net for layout changes that fire no observer: a pane or the area that moved
   * without changing size. Re-reads the rectangles at most once a second, and only while
   * frames are being produced, so an idle window never does it.
   */
  verifyGeometry(now: number): void {
    if (!this.area || now - this.lastGeometryCheck < GEOMETRY_CHECK_INTERVAL_MS)
      return;
    this.lastGeometryCheck = now;
    this.geometryChecks += 1;
    if (this.readAreaRect()) this.geometryCorrections += 1;
    for (const state of this.panes.values()) {
      const rect = state.host.getBoundingClientRect();
      const next: CssRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
      if (cssRectsEqual(state.css, next)) continue;
      // Size changes reach `setBounds` through the pane's observer first; a difference found
      // here is a move the observers cannot see.
      if (state.css) this.geometryCorrections += 1;
      state.css = next;
      this.layoutStale = true;
    }
    if (this.layoutStale) this.dirty = true;
  }

  diagnostics(): WindowCanvasStats {
    let drawable = 0;
    for (const [pane, state] of this.panes) {
      if (state.rect && pane.drawable()) drawable += 1;
    }
    return {
      width: this.canvas.width,
      height: this.canvas.height,
      colorBytes: this.canvas.width * this.canvas.height * 4,
      panes: this.panes.size,
      drawable,
      reallocations: this.reallocations,
      frames: this.frames,
      geometryChecks: this.geometryChecks,
      geometryCorrections: this.geometryCorrections,
      gestureActive: this.gestureActive,
      reconfigured: this.reconfigurations,
    };
  }

  /** Final teardown, only when the runtime itself goes away for good. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    this.pixelRatioMonitor.stop();
    this.unsubscribeGesture();
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    window.removeEventListener?.("resize", this.handleWindowResize);
    this.panes.clear();
    this.context.unconfigure();
    this.canvas.remove();
    this.area = null;
  }

  private readonly handleWindowResize = (): void => {
    this.measureArea();
  };

  /**
   * Reads the area (layout is clean in an observer callback), stages the backing store for it
   * and moves the canvas onto the device pixel grid. Staging only records the target; the
   * swapchain is reallocated by the next `beginFrame`.
   */
  private measureArea(): void {
    const area = this.area;
    if (!area) return;
    this.scale = devicePixelScale();
    this.readAreaRect();
    const box = this.areaCss;
    if (!box) return;
    // The snap offset depends on the ratio as well as the rectangle: a move to a display with
    // another ratio leaves the rectangle alone (`readAreaRect` reports no change) but needs a
    // different translation. Idempotent when nothing differs.
    this.applyTransform(box);
    // Rounded up, so the canvas always covers the area: pane rectangles are clamped to it and
    // anything beyond the area is clipped by the area itself.
    this.areaDevice = {
      width: Math.ceil(box.width * this.scale - 1e-6),
      height: Math.ceil(box.height * this.scale - 1e-6),
    };
    this.restage();
    this.requestFrame();
  }

  /** Re-reads the area's rectangle; true when it differs from the one in use. */
  private readAreaRect(): boolean {
    const area = this.area;
    if (!area) return false;
    const rect = area.getBoundingClientRect();
    const next: CssRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    if (cssRectsEqual(this.areaCss, next)) return false;
    this.areaCss = next;
    this.applyTransform(next);
    this.layoutStale = true;
    return true;
  }

  private applyTransform(area: CssRect): void {
    const offset = snapOffsetCss(area.left, area.top, this.scale);
    const transform =
      offset.x === 0 && offset.y === 0
        ? ""
        : `translate(${offset.x}px, ${offset.y}px)`;
    if (transform === this.appliedTransform) return;
    this.canvas.style.transform = transform;
    this.appliedTransform = transform;
  }

  private restage(): void {
    const device = this.areaDevice;
    const area = this.area;
    if (!device || !area || device.width < 1 || device.height < 1) return;
    // A texture cannot exceed the device limit; an area that does is drawn up to it.
    const limit = this.device.limits?.maxTextureDimension2D ?? 8192;
    this.backing.stage(
      Math.min(device.width, limit),
      Math.min(device.height, limit),
      this.scale,
      this.gestureGrowth(area),
    );
    this.layoutStale = true;
  }

  /** During a drag the canvas never shrinks and grows once, to the bound the drag cannot exceed. */
  private gestureGrowth(area: HTMLElement): GestureGrowth | undefined {
    if (!this.gestureActive) return undefined;
    return () =>
      gestureBackingBound(
        measureGestureBackingEnvironment(
          area,
          this.gestureStartInner,
          this.scale,
          this.device.limits?.maxTextureDimension2D ?? 8192,
        ),
      );
  }

  private requestFrame(): void {
    this.dirty = true;
    this.hooks.requestFrame();
  }

  private show(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (this.shown) return;
    this.shown = true;
    this.canvas.style.visibility = "visible";
  }

  /**
   * Hides the canvas once no pane has used it for a moment. A tab switch removes the old panes
   * just before the new ones join, and toggling the visibility of a presented WebGPU canvas
   * makes the engine rebuild its layer, so a switch must not toggle it.
   */
  private hide(): void {
    if (!this.shown || this.hideTimer !== null) return;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (this.panes.size > 0) return;
      this.shown = false;
      this.canvas.style.visibility = "hidden";
    }, HIDE_DELAY_MS);
  }
}

function rgbClear(color: Rgb): GPUColor {
  return {
    r: color[0] / 255,
    g: color[1] / 255,
    b: color[2] / 255,
    a: 1,
  };
}
