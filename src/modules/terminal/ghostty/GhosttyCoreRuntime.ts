import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import type { GhosttyTerminalConfig } from "@terax/ghostty-core/protocol";
import { AdaptedGhosttyTerminalModel } from "./AdaptedGhosttyTerminalModel";
import {
  allocateScrollbackBytes,
  DEFAULT_SCROLLBACK_BUDGET_BYTES,
  normalizeScrollbackLines,
  requestedScrollbackBytes,
  type ScrollbackDemand,
} from "./core/scrollbackBudget";
import type {
  GhosttyTerminalModelApi,
  GhosttyTerminalModelOptions,
} from "./GhosttyTerminalModel";

const IDLE_WASM_RELEASE_MS = 60_000;

export type GhosttyModelOptions = Omit<
  GhosttyTerminalModelOptions,
  "onDispose" | "config" | "backend"
> & {
  readonly leafId: number;
  readonly backend?: GhosttyTerminalModelOptions["backend"];
  readonly config?: GhosttyTerminalConfig;
};

export type GhosttyRuntimeDiagnostics = {
  readonly status: "cold" | "loading" | "ready" | "failed";
  /** Linear memory summed over the instances of all live models. */
  readonly wasmMemoryBytes: number;
  /** Live WebAssembly instances: one per model. */
  readonly wasmInstanceCount: number;
  /** The compiled module is retained (it is shared by every instance). */
  readonly wasmModuleCached: boolean;
  readonly modelCount: number;
  readonly pendingModelCount: number;
  readonly idleReleaseScheduled: boolean;
  readonly nativeDeviceAttributes: boolean | null;
  readonly scrollbackBudgetBytes: number;
  /** Sum of the scrollback limits the live models asked for. */
  readonly scrollbackRequestedBytes: number;
  /** Sum of the scrollback limits in force after applying the budget. */
  readonly scrollbackGrantedBytes: number;
  readonly lastError: string | null;
};

export type GhosttyCoreRuntimeOptions = {
  /** Cap on scrollback bytes summed over all models. */
  readonly scrollbackBudgetBytes?: number;
};

type GhosttyLoader = () => Promise<TeraxGhostty>;

const deviceAttributeProbes = new WeakMap<TeraxGhostty, boolean>();

export class GhosttyCoreRuntime {
  private readonly loader: GhosttyLoader;
  private readonly models = new Map<number, AdaptedGhosttyTerminalModel>();
  private readonly pendingModels = new Set<number>();
  private loadPromise: Promise<TeraxGhostty> | null = null;
  private ghostty: TeraxGhostty | null = null;
  private status: GhosttyRuntimeDiagnostics["status"] = "cold";
  private lastError: string | null = null;
  private idleReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollbackBudgetBytes: number;
  private disposed = false;

  constructor(
    loader: GhosttyLoader = () => TeraxGhostty.load(),
    options: GhosttyCoreRuntimeOptions = {},
  ) {
    this.loader = loader;
    this.scrollbackBudgetBytes =
      options.scrollbackBudgetBytes ?? DEFAULT_SCROLLBACK_BUDGET_BYTES;
  }

  preload(): Promise<void> {
    this.cancelIdleRelease();
    return this.load().then(() => this.scheduleIdleRelease());
  }

  async createModel(
    options: GhosttyModelOptions,
  ): Promise<GhosttyTerminalModelApi> {
    this.cancelIdleRelease();
    if (
      this.models.has(options.leafId) ||
      this.pendingModels.has(options.leafId)
    ) {
      throw new Error(
        `Ghostty model already exists for leaf ${options.leafId}`,
      );
    }

    this.pendingModels.add(options.leafId);
    try {
      const ghostty = await this.load();
      this.assertLive();
      const model = new AdaptedGhosttyTerminalModel(ghostty, {
        backend: options.backend ?? "ghostty-webgpu",
        cols: options.cols,
        rows: options.rows,
        config: options.config,
        onReply: options.onReply,
        onEvent: options.onEvent,
        scrollbackByteLimit: this.grantForNewModel(options),
        onDispose: () => {
          if (this.models.get(options.leafId) !== model) return;
          this.models.delete(options.leafId);
          this.rebalanceScrollback();
          this.scheduleIdleRelease();
        },
      });
      this.models.set(options.leafId, model);
      this.rebalanceScrollback();
      return model;
    } finally {
      this.pendingModels.delete(options.leafId);
      this.scheduleIdleRelease();
    }
  }

  getModel(leafId: number): GhosttyTerminalModelApi | null {
    return this.models.get(leafId) ?? null;
  }

  disposeModel(leafId: number): void {
    this.models.get(leafId)?.dispose();
  }

  disposeAllModels(): void {
    for (const model of [...this.models.values()]) model.dispose();
  }

  /**
   * Changes the cap on scrollback bytes summed over all models and re-divides
   * it. History already held is never pruned: a terminal above its new share
   * simply stops growing.
   */
  setScrollbackBudget(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      throw new RangeError("Scrollback budget must be a positive byte count");
    }
    this.scrollbackBudgetBytes = Math.floor(bytes);
    this.rebalanceScrollback();
  }

  dispose(): void {
    this.disposed = true;
    this.disposeAllModels();
    this.cancelIdleRelease();
    this.ghostty = null;
    this.loadPromise = null;
    this.status = "cold";
    this.lastError = null;
  }

  diagnostics(): GhosttyRuntimeDiagnostics {
    const stats = this.ghostty?.memoryStats();
    let requested = 0;
    let granted = 0;
    for (const model of this.models.values()) {
      requested += model.requestedScrollbackBytes;
      granted += model.scrollbackByteLimit;
    }
    return {
      status: this.status,
      wasmMemoryBytes: stats?.totalBytes ?? 0,
      wasmInstanceCount: stats?.instanceCount ?? 0,
      wasmModuleCached: this.ghostty !== null,
      modelCount: this.models.size,
      pendingModelCount: this.pendingModels.size,
      idleReleaseScheduled: this.idleReleaseTimer !== null,
      nativeDeviceAttributes: this.ghostty
        ? nativeDeviceAttributes(this.ghostty)
        : null,
      scrollbackBudgetBytes: this.scrollbackBudgetBytes,
      scrollbackRequestedBytes: requested,
      scrollbackGrantedBytes: granted,
      lastError: this.lastError,
    };
  }

  private load(): Promise<TeraxGhostty> {
    if (this.disposed)
      return Promise.reject(new Error("Ghostty runtime is disposed"));
    if (this.ghostty) return Promise.resolve(this.ghostty);
    if (this.loadPromise) return this.loadPromise;

    this.status = "loading";
    this.lastError = null;
    this.loadPromise = Promise.resolve()
      .then(() => {
        this.assertLive();
        return this.loader();
      })
      .then((ghostty) => {
        this.assertLive();
        this.ghostty = ghostty;
        this.status = "ready";
        return ghostty;
      })
      .catch((error: unknown) => {
        if (!this.disposed) {
          this.status = "failed";
          this.lastError =
            error instanceof Error ? error.message : String(error);
          this.loadPromise = null;
        }
        throw error;
      });
    return this.loadPromise;
  }

  private grantForNewModel(options: GhosttyModelOptions): number {
    const request = requestedScrollbackBytes(
      normalizeScrollbackLines(options.config?.scrollbackLimit),
      options.cols,
    );
    const grants = allocateScrollbackBytes(
      [...this.scrollbackDemands(), { request, held: 0 }],
      this.scrollbackBudgetBytes,
    );
    return grants[grants.length - 1];
  }

  private rebalanceScrollback(): void {
    const models = [...this.models.values()];
    if (models.length === 0) return;
    const grants = allocateScrollbackBytes(
      this.scrollbackDemands(),
      this.scrollbackBudgetBytes,
    );
    models.forEach((model, index) => {
      model.setScrollbackByteLimit(grants[index]);
    });
  }

  private scrollbackDemands(): ScrollbackDemand[] {
    return [...this.models.values()].map((model) => ({
      request: model.requestedScrollbackBytes,
      held: model.scrollbackPageBytes(),
    }));
  }

  private scheduleIdleRelease(): void {
    if (
      this.disposed ||
      this.idleReleaseTimer !== null ||
      !this.ghostty ||
      this.models.size > 0 ||
      this.pendingModels.size > 0
    ) {
      return;
    }
    this.idleReleaseTimer = setTimeout(() => {
      this.idleReleaseTimer = null;
      if (this.models.size > 0 || this.pendingModels.size > 0) return;
      this.ghostty = null;
      this.loadPromise = null;
      this.status = "cold";
      this.lastError = null;
    }, IDLE_WASM_RELEASE_MS);
    unrefTimer(this.idleReleaseTimer);
  }

  private cancelIdleRelease(): void {
    if (this.idleReleaseTimer === null) return;
    clearTimeout(this.idleReleaseTimer);
    this.idleReleaseTimer = null;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("Ghostty runtime is disposed");
  }
}

/**
 * Whether the artifact answers device-attribute queries natively. It is a
 * property of the compiled module, so it is probed once on a throwaway
 * instance that is dropped immediately, and only when diagnostics ask.
 */
function nativeDeviceAttributes(ghostty: TeraxGhostty): boolean {
  const cached = deviceAttributeProbes.get(ghostty);
  if (cached !== undefined) return cached;
  const terminal = ghostty.createTerminal(2, 1);
  let result: boolean;
  try {
    terminal.write(new TextEncoder().encode("\x1b[c\x1b[>c"));
    const response = new TextDecoder().decode(terminal.drainOutputBytes());
    result = response.includes("\x1b[?") && response.includes("\x1b[>");
  } finally {
    terminal.dispose();
  }
  deviceAttributeProbes.set(ghostty, result);
  return result;
}

let sharedRuntime: GhosttyCoreRuntime | null = null;

export function getGhosttyCoreRuntime(): GhosttyCoreRuntime {
  sharedRuntime ??= new GhosttyCoreRuntime();
  return sharedRuntime;
}

export function ghosttyCoreRuntimeDiagnostics(): GhosttyRuntimeDiagnostics | null {
  return sharedRuntime?.diagnostics() ?? null;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    sharedRuntime?.dispose();
    sharedRuntime = null;
  });
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer !== "object" || timer === null || !("unref" in timer)) {
    return;
  }
  (timer as { unref(): void }).unref();
}
