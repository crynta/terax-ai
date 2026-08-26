import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import type { GhosttyTerminalConfig } from "@terax/ghostty-core/protocol";
import { AdaptedGhosttyTerminalModel } from "./AdaptedGhosttyTerminalModel";
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
  readonly wasmMemoryBytes: number;
  readonly modelCount: number;
  readonly pendingModelCount: number;
  readonly idleReleaseScheduled: boolean;
  readonly nativeDeviceAttributes: boolean | null;
  readonly lastError: string | null;
};

type GhosttyLoader = () => Promise<TeraxGhostty>;

export class GhosttyCoreRuntime {
  private readonly loader: GhosttyLoader;
  private readonly models = new Map<number, GhosttyTerminalModelApi>();
  private readonly pendingModels = new Set<number>();
  private loadPromise: Promise<TeraxGhostty> | null = null;
  private ghostty: TeraxGhostty | null = null;
  private status: GhosttyRuntimeDiagnostics["status"] = "cold";
  private nativeDeviceAttributes: boolean | null = null;
  private lastError: string | null = null;
  private idleReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(loader: GhosttyLoader = () => TeraxGhostty.load()) {
    this.loader = loader;
  }

  preload(): Promise<void> {
    this.cancelIdleRelease();
    return this.load().then(() => undefined);
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
      const model = new AdaptedGhosttyTerminalModel(ghostty, {
        backend: options.backend ?? "ghostty-webgpu",
        cols: options.cols,
        rows: options.rows,
        config: options.config,
        onReply: options.onReply,
        onEvent: options.onEvent,
        onDispose: () => {
          this.models.delete(options.leafId);
          this.scheduleIdleRelease();
        },
      });
      this.models.set(options.leafId, model);
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

  dispose(): void {
    this.disposeAllModels();
    this.cancelIdleRelease();
    this.ghostty = null;
    this.loadPromise = null;
    this.status = "cold";
    this.nativeDeviceAttributes = null;
    this.lastError = null;
  }

  diagnostics(): GhosttyRuntimeDiagnostics {
    return {
      status: this.status,
      wasmMemoryBytes: this.ghostty?.getMemoryBytes() ?? 0,
      modelCount: this.models.size,
      pendingModelCount: this.pendingModels.size,
      idleReleaseScheduled: this.idleReleaseTimer !== null,
      nativeDeviceAttributes: this.nativeDeviceAttributes,
      lastError: this.lastError,
    };
  }

  private load(): Promise<TeraxGhostty> {
    if (this.ghostty) return Promise.resolve(this.ghostty);
    if (this.loadPromise) return this.loadPromise;

    this.status = "loading";
    this.lastError = null;
    this.loadPromise = this.loader()
      .then((ghostty) => {
        this.nativeDeviceAttributes = probeNativeDeviceAttributes(ghostty);
        this.ghostty = ghostty;
        this.status = "ready";
        return ghostty;
      })
      .catch((error: unknown) => {
        this.status = "failed";
        this.lastError = error instanceof Error ? error.message : String(error);
        this.loadPromise = null;
        throw error;
      });
    return this.loadPromise;
  }

  private scheduleIdleRelease(): void {
    if (
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
      this.nativeDeviceAttributes = null;
      this.lastError = null;
    }, IDLE_WASM_RELEASE_MS);
    unrefTimer(this.idleReleaseTimer);
  }

  private cancelIdleRelease(): void {
    if (this.idleReleaseTimer === null) return;
    clearTimeout(this.idleReleaseTimer);
    this.idleReleaseTimer = null;
  }
}

function probeNativeDeviceAttributes(ghostty: TeraxGhostty): boolean {
  const terminal = ghostty.createTerminal(2, 1);
  try {
    terminal.write(new TextEncoder().encode("\x1b[c\x1b[>c"));
    const response = new TextDecoder().decode(terminal.drainOutputBytes());
    return response.includes("\x1b[?") && response.includes("\x1b[>");
  } finally {
    terminal.dispose();
  }
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
