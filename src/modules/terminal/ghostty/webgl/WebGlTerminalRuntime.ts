import {
  rendererProfileKey,
  type WebGlRendererProfile,
  XtermWebGlRenderer,
} from "./XtermWebGlRenderer";

export const MAX_WEBGL_RENDERER_SLOTS = 5;
export const MIN_WARM_WEBGL_RENDERER_SLOTS = 1;
export const WEBGL_RENDERER_IDLE_TTL_MS = 30_000;

export interface WebGlRuntimeSurface {
  renderFrame(renderer: XtermWebGlRenderer): boolean;
  handleRendererError(error: Error): void;
}

export type WebGlRuntimeDependencies = {
  readonly createRenderer: () => XtermWebGlRenderer;
  readonly now: () => number;
  readonly isVisible: () => boolean;
  readonly requestFrame: (callback: () => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly setTimer: (callback: () => void, delayMs: number) => number;
  readonly clearTimer: (handle: number) => void;
  readonly bindVisibility: (callback: () => void) => () => void;
};

type RendererSlot = {
  readonly renderer: XtermWebGlRenderer;
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
};

/**
 * Window-scoped WebGL renderer pool. Ghostty models are never pooled here.
 * Hidden tabs release their GPU slot while their WASM terminal state remains
 * alive, matching Terax's existing xterm renderer-pool ownership model.
 */
export class WebGlTerminalRuntime {
  private readonly slots: RendererSlot[] = [];
  private readonly leases = new Map<WebGlRuntimeSurface, RendererSlot>();
  private readonly dirtySurfaces = new Set<WebGlRuntimeSurface>();
  private animationFrame: number | null = null;
  private idleSweepTimer: number | null = null;
  private submittedFrames = 0;
  private disposed = false;
  private readonly unbindVisibility: () => void;

  constructor(
    private readonly dependencies: WebGlRuntimeDependencies = browserDependencies(),
  ) {
    this.unbindVisibility = dependencies.bindVisibility(this.handleVisibility);
  }

  acquire(
    surface: WebGlRuntimeSurface,
    host: HTMLElement,
    profile: WebGlRendererProfile,
  ): XtermWebGlRenderer {
    this.assertLive();
    const existing = this.leases.get(surface);
    if (existing) {
      const key = rendererProfileKey(profile);
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
    }

    const key = rendererProfileKey(profile);
    let slot = this.slots.find(
      (candidate) => !candidate.owner && candidate.profileKey === key,
    );
    slot ??= this.slots.find((candidate) => !candidate.owner);
    let created = false;
    if (!slot && this.slots.length < MAX_WEBGL_RENDERER_SLOTS) {
      slot = {
        renderer: this.dependencies.createRenderer(),
        profileKey: key,
        owner: null,
        lastUsed: this.dependencies.now(),
      };
      this.slots.push(slot);
      created = true;
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
      this.leases.delete(surface);
      slot.owner = null;
      slot.renderer.detach();
      if (created) {
        slot.renderer.dispose();
        this.slots.splice(this.slots.indexOf(slot), 1);
      }
      throw error;
    }
    this.clearIdleSweepTimer();
    return slot.renderer;
  }

  release(surface: WebGlRuntimeSurface): void {
    const slot = this.leases.get(surface);
    if (!slot) return;
    this.leases.delete(surface);
    this.dirtySurfaces.delete(surface);
    slot.renderer.detach();
    slot.owner = null;
    slot.lastUsed = this.dependencies.now();
    if (this.dirtySurfaces.size === 0 && this.animationFrame !== null) {
      this.dependencies.cancelFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.scheduleIdleSweep();
  }

  discard(surface: WebGlRuntimeSurface): boolean {
    const slot = this.leases.get(surface);
    if (!slot) return false;
    this.leases.delete(surface);
    this.dirtySurfaces.delete(surface);
    slot.renderer.detach();
    slot.renderer.dispose();
    this.slots.splice(this.slots.indexOf(slot), 1);
    if (this.dirtySurfaces.size === 0 && this.animationFrame !== null) {
      this.dependencies.cancelFrame(this.animationFrame);
      this.animationFrame = null;
    }
    return true;
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
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unbindVisibility();
    if (this.animationFrame !== null) {
      this.dependencies.cancelFrame(this.animationFrame);
    }
    this.animationFrame = null;
    this.clearIdleSweepTimer();
    this.dirtySurfaces.clear();
    this.leases.clear();
    for (const slot of this.slots) slot.renderer.dispose();
    this.slots.length = 0;
  }

  private readonly handleVisibility = (): void => {
    if (this.dependencies.isVisible()) this.requestFrame();
  };

  private requestFrame(): void {
    if (
      this.animationFrame !== null ||
      this.dirtySurfaces.size === 0 ||
      !this.dependencies.isVisible()
    ) {
      return;
    }
    this.animationFrame = this.dependencies.requestFrame(() =>
      this.flushFrame(),
    );
  }

  private flushFrame(): void {
    this.animationFrame = null;
    if (this.disposed || this.dirtySurfaces.size === 0) return;
    if (!this.dependencies.isVisible()) return;
    const batch = [...this.dirtySurfaces];
    this.dirtySurfaces.clear();
    for (const surface of batch) {
      const slot = this.leases.get(surface);
      if (!slot) continue;
      try {
        if (surface.renderFrame(slot.renderer)) this.submittedFrames += 1;
      } catch (error) {
        surface.handleRendererError(toError(error));
      }
    }
    this.requestFrame();
  }

  private scheduleIdleSweep(): void {
    if (
      this.idleSweepTimer !== null ||
      this.slots.length <= MIN_WARM_WEBGL_RENDERER_SLOTS
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
    createRenderer: () => new XtermWebGlRenderer(),
    now: () => performance.now(),
    isVisible: () => document.visibilityState === "visible",
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimer: (handle) => window.clearTimeout(handle),
    bindVisibility: (callback) => {
      document.addEventListener("visibilitychange", callback);
      return () => document.removeEventListener("visibilitychange", callback);
    },
  };
}
