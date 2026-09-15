import { SurfaceFramePacer } from "@/modules/terminal/ghostty/SurfaceFramePacer";
import {
  subscribeWindowPresentation,
  terminalWindowPresentation,
} from "@/modules/terminal/ghostty/windowPresentation";
import {
  bindTerminalWindowFocus,
  terminalFrameIntervalMs,
  terminalWindowFocused,
} from "../renderScheduling";
import {
  rendererProfileKey,
  type WebGlRendererProfile,
  WebGlCellRenderer,
} from "./WebGlCellRenderer";

export const MAX_WEBGL_RENDERER_SLOTS = 5;
export const MIN_WARM_WEBGL_RENDERER_SLOTS = 1;
export const WEBGL_RENDERER_IDLE_TTL_MS = 30_000;

export interface WebGlRuntimeSurface {
  handleWindowFocus?(focused: boolean): void;
  renderFrame(renderer: WebGlCellRenderer): boolean;
  handleRendererError(error: Error): void;
  isFocused(): boolean;
}

export type WebGlRuntimeDependencies = {
  readonly createRenderer: () => WebGlCellRenderer;
  readonly now: () => number;
  readonly isVisible: () => boolean;
  readonly isWindowFocused: () => boolean;
  readonly requestFrame: (callback: (frameAt?: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly setTimer: (callback: () => void, delayMs: number) => number;
  readonly clearTimer: (handle: number) => void;
  readonly bindVisibility: (callback: () => void) => () => void;
  readonly bindWindowFocus: (
    callback: (focused: boolean) => void,
  ) => () => void;
};

type RendererSlot = {
  readonly renderer: WebGlCellRenderer;
  profileKey: string;
  owner: WebGlRuntimeSurface | null;
  lastUsed: number;
};

export type WebGlRuntimeStats = {
  readonly slotCount: number;
  readonly activeSlots: number;
  readonly idleSlots: number;
  readonly dirtySurfaces: number;
  readonly submittedFrames: number;
  readonly atlasBytes: number;
  readonly cpuBufferBytes: number;
  readonly windowFocused: boolean;
  readonly targetFrameIntervalMs: number;
  readonly frameScheduled: boolean;
};

/**
 * Window-scoped WebGL renderer pool. Ghostty models are never pooled here.
 * Hidden tabs release their GPU slot while their WASM terminal state remains
 * alive, matching Terax's existing xterm renderer-pool ownership model.
 */
export class WebGlTerminalRuntime {
  private readonly slots: RendererSlot[] = [];
  private readonly leases = new Map<WebGlRuntimeSurface, RendererSlot>();
  private dirtySurfaces = new Set<WebGlRuntimeSurface>();
  private renderSurfaces = new Set<WebGlRuntimeSurface>();
  private animationFrame: number | null = null;
  private frameTimer: number | null = null;
  private idleSweepTimer: number | null = null;
  private submittedFrames = 0;
  private windowFocused: boolean;
  private readonly pacer = new SurfaceFramePacer();
  private disposed = false;
  private readonly unbindVisibility: () => void;
  private readonly unbindWindowFocus: () => void;

  constructor(
    private readonly dependencies: WebGlRuntimeDependencies = browserDependencies(),
  ) {
    this.windowFocused = dependencies.isWindowFocused();
    this.unbindVisibility = dependencies.bindVisibility(this.handleVisibility);
    this.unbindWindowFocus = dependencies.bindWindowFocus(
      this.handleWindowFocus,
    );
  }

  acquire(
    surface: WebGlRuntimeSurface,
    host: HTMLElement,
    profile: WebGlRendererProfile,
  ): WebGlCellRenderer {
    this.assertLive();
    surface.handleWindowFocus?.(this.windowFocused);
    const existing = this.leases.get(surface);
    if (existing) {
      const key = rendererProfileKey(profile);
      try {
        existing.renderer.configure(
          profile,
          () => this.schedule(surface),
          (error) => surface.handleRendererError(error),
        );
        if (existing.profileKey !== key) {
          existing.renderer.resetModel();
        }
        existing.profileKey = key;
        existing.renderer.attach(host);
        existing.lastUsed = this.dependencies.now();
        return existing.renderer;
      } catch (error) {
        this.discard(surface);
        throw error;
      }
    }

    const key = rendererProfileKey(profile);
    let slot = this.slots.find(
      (candidate) => !candidate.owner && candidate.profileKey === key,
    );
    slot ??= this.slots.find((candidate) => !candidate.owner);
    if (!slot && this.slots.length < MAX_WEBGL_RENDERER_SLOTS) {
      slot = {
        renderer: this.dependencies.createRenderer(),
        profileKey: key,
        owner: null,
        lastUsed: this.dependencies.now(),
      };
      this.slots.push(slot);
    }
    if (!slot) {
      throw new Error(
        `WebGL terminal renderer pool exhausted (${MAX_WEBGL_RENDERER_SLOTS} visible panes)`,
      );
    }

    slot.owner = surface;
    slot.profileKey = key;
    slot.lastUsed = this.dependencies.now();
    this.leases.set(surface, slot);
    try {
      slot.renderer.configure(
        profile,
        () => this.schedule(surface),
        (error) => surface.handleRendererError(error),
      );
      slot.renderer.resetModel();
      slot.renderer.attach(host);
    } catch (error) {
      this.discard(surface);
      throw error;
    }
    this.scheduleIdleSweep();
    return slot.renderer;
  }

  release(surface: WebGlRuntimeSurface): void {
    const slot = this.leases.get(surface);
    if (!slot) return;
    this.leases.delete(surface);
    this.dirtySurfaces.delete(surface);
    this.renderSurfaces.delete(surface);
    slot.renderer.detach();
    slot.owner = null;
    slot.lastUsed = this.dependencies.now();
    if (this.dirtySurfaces.size === 0) this.cancelScheduledFrame();
    this.scheduleIdleSweep();
  }

  discard(surface: WebGlRuntimeSurface): boolean {
    const slot = this.leases.get(surface);
    if (!slot) return false;
    this.leases.delete(surface);
    this.dirtySurfaces.delete(surface);
    this.renderSurfaces.delete(surface);
    slot.renderer.detach();
    slot.renderer.dispose();
    this.slots.splice(this.slots.indexOf(slot), 1);
    if (this.dirtySurfaces.size === 0) this.cancelScheduledFrame();
    return true;
  }

  trimForHiddenDocument(): void {
    for (const slot of [...this.slots]) {
      if (slot.owner) continue;
      slot.renderer.dispose();
      this.slots.splice(this.slots.indexOf(slot), 1);
    }
    this.clearIdleSweepTimer();
  }

  interact(surface: WebGlRuntimeSurface): void {
    if (this.disposed || !this.leases.has(surface)) return;
    this.pacer.interact(surface, this.dependencies.now());
    if (this.frameTimer !== null) {
      this.dependencies.clearTimer(this.frameTimer);
      this.frameTimer = null;
    }
    this.requestFrame();
  }

  schedule(surface: WebGlRuntimeSurface): void {
    if (this.disposed || !this.leases.has(surface)) return;
    this.dirtySurfaces.add(surface);
    this.requestFrame();
  }

  diagnostics(): WebGlRuntimeStats {
    let atlasBytes = 0;
    let cpuBufferBytes = 0;
    for (const slot of this.slots) {
      const stats = slot.renderer.diagnostics();
      atlasBytes += stats.atlasBytes;
      cpuBufferBytes += stats.cpuBufferBytes;
    }
    return {
      slotCount: this.slots.length,
      activeSlots: this.leases.size,
      idleSlots: this.slots.length - this.leases.size,
      dirtySurfaces: this.dirtySurfaces.size,
      submittedFrames: this.submittedFrames,
      atlasBytes,
      cpuBufferBytes,
      windowFocused: this.windowFocused,
      targetFrameIntervalMs: terminalFrameIntervalMs(
        this.windowFocused,
        this.hasFocusedSurface(),
      ),
      frameScheduled: this.animationFrame !== null || this.frameTimer !== null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unbindVisibility();
    this.unbindWindowFocus();
    this.cancelScheduledFrame();
    this.clearIdleSweepTimer();
    this.dirtySurfaces.clear();
    this.renderSurfaces.clear();
    this.leases.clear();
    for (const slot of this.slots) slot.renderer.dispose();
    this.slots.length = 0;
  }

  private readonly handleVisibility = (): void => {
    if (this.dependencies.isVisible()) {
      this.pacer.reset();
      this.requestFrame();
    } else this.cancelScheduledFrame();
  };

  private readonly handleWindowFocus = (focused: boolean): void => {
    if (this.windowFocused === focused) return;
    this.windowFocused = focused;
    for (const surface of this.leases.keys())
      surface.handleWindowFocus?.(focused);
    this.cancelScheduledFrame();
    this.requestFrame();
  };

  private requestFrame(): void {
    if (
      this.animationFrame !== null ||
      this.frameTimer !== null ||
      this.dirtySurfaces.size === 0 ||
      !this.dependencies.isVisible()
    ) {
      return;
    }
    const delay = this.pacer.delay(
      this.dirtySurfaces,
      this.windowFocused,
      this.dependencies.now(),
    );
    if (delay > 1) {
      this.frameTimer = this.dependencies.setTimer(() => {
        this.frameTimer = null;
        this.requestFrame();
      }, delay);
      return;
    }
    this.animationFrame = this.dependencies.requestFrame((frameAt) =>
      this.flushFrame(frameAt),
    );
  }

  private flushFrame(frameAt = this.dependencies.now()): void {
    this.animationFrame = null;
    if (this.disposed || this.dirtySurfaces.size === 0) return;
    if (!this.dependencies.isVisible()) return;
    const batch = this.dirtySurfaces;
    this.dirtySurfaces = this.renderSurfaces;
    this.renderSurfaces = batch;
    for (const surface of batch) {
      const slot = this.leases.get(surface);
      if (!slot) continue;
      if (!this.pacer.due(surface, this.windowFocused, frameAt)) {
        this.dirtySurfaces.add(surface);
        continue;
      }
      try {
        if (surface.renderFrame(slot.renderer)) {
          this.pacer.presented(surface, frameAt);
          this.submittedFrames += 1;
        }
      } catch (error) {
        surface.handleRendererError(toError(error));
      }
    }
    batch.clear();
    this.requestFrame();
  }

  private hasFocusedSurface(): boolean {
    for (const surface of this.leases.keys()) {
      if (surface.isFocused()) return true;
    }
    return false;
  }

  private cancelScheduledFrame(): void {
    if (this.animationFrame !== null) {
      this.dependencies.cancelFrame(this.animationFrame);
    }
    this.animationFrame = null;
    if (this.frameTimer !== null) {
      this.dependencies.clearTimer(this.frameTimer);
    }
    this.frameTimer = null;
  }

  private scheduleIdleSweep(): void {
    if (
      this.idleSweepTimer !== null ||
      this.slots.length <= MIN_WARM_WEBGL_RENDERER_SLOTS ||
      !this.slots.some((slot) => !slot.owner)
    ) {
      return;
    }
    this.idleSweepTimer = this.dependencies.setTimer(() => {
      this.idleSweepTimer = null;
      this.sweepIdleSlots();
    }, WEBGL_RENDERER_IDLE_TTL_MS);
  }

  private sweepIdleSlots(): void {
    const cutoff = this.dependencies.now() - WEBGL_RENDERER_IDLE_TTL_MS;
    const idle = this.slots
      .filter((slot) => !slot.owner)
      .sort((left, right) => left.lastUsed - right.lastUsed);
    for (const slot of idle) {
      if (this.slots.length <= MIN_WARM_WEBGL_RENDERER_SLOTS) break;
      if (slot.lastUsed > cutoff) continue;
      slot.renderer.dispose();
      this.slots.splice(this.slots.indexOf(slot), 1);
    }
    if (
      this.slots.length > MIN_WARM_WEBGL_RENDERER_SLOTS &&
      this.slots.some((slot) => !slot.owner)
    ) {
      this.scheduleIdleSweep();
    }
  }

  private clearIdleSweepTimer(): void {
    if (this.idleSweepTimer !== null) {
      this.dependencies.clearTimer(this.idleSweepTimer);
    }
    this.idleSweepTimer = null;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("WebGL terminal runtime is disposed");
  }
}

let sharedRuntime: WebGlTerminalRuntime | null = null;

export function getWebGlTerminalRuntime(): WebGlTerminalRuntime {
  sharedRuntime ??= new WebGlTerminalRuntime();
  return sharedRuntime;
}

export function webGlTerminalRuntimeDiagnostics(): WebGlRuntimeStats | null {
  return sharedRuntime?.diagnostics() ?? null;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    sharedRuntime?.dispose();
    sharedRuntime = null;
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function browserDependencies(): WebGlRuntimeDependencies {
  return {
    createRenderer: () => new WebGlCellRenderer(),
    now: () => performance.now(),
    isVisible: () => terminalWindowPresentation().visible,
    isWindowFocused: terminalWindowFocused,
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimer: (handle) => window.clearTimeout(handle),
    bindVisibility: (callback) => subscribeWindowPresentation(callback),
    bindWindowFocus: bindTerminalWindowFocus,
  };
}
