import { GlyphAtlas } from "./GlyphAtlas";
import { COLOR_SHADER, GLYPH_SHADER } from "./shaders";
import type { TerminalFontMetrics } from "./terminalVisuals";
import { CELL_INSTANCE_BYTES, PACKED_INSTANCE_BYTES } from "./WebGpuCellBuffer";

const MAX_ATLAS_COUNT = 8;
const MAX_WARM_UNUSED_ATLASES = 1;
const ATLAS_IDLE_TTL_MS = 30_000;

export type WebGpuSharedResources = {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly colorPipeline: GPURenderPipeline;
  readonly glyphPipeline: GPURenderPipeline;
  readonly colorBindGroupLayout: GPUBindGroupLayout;
  readonly glyphBindGroupLayout: GPUBindGroupLayout;
  readonly glyphSampler: GPUSampler;
  readonly generation: number;
};

export interface WebGpuRuntimeSurface {
  renderFrame(
    encoder: GPUCommandEncoder,
    resources: WebGpuSharedResources,
  ): boolean;
  handleRuntimeReset(resources: WebGpuSharedResources): void;
  handleRuntimeError(error: Error): void;
  handleVisibilityChange(visible: boolean): void;
}

type AtlasEntry = {
  readonly key: string;
  readonly metrics: TerminalFontMetrics;
  readonly scale: number;
  readonly isolated: boolean;
  readonly users: Set<WebGpuRuntimeSurface>;
  atlas: GlyphAtlas;
  references: number;
  lastUsed: number;
};

export type GlyphAtlasLease = {
  readonly key: string;
  readonly atlas: GlyphAtlas;
  readonly isolated: boolean;
  release(): void;
};

export type WebGpuRuntimeStats = {
  readonly generation: number;
  readonly surfaceCount: number;
  readonly atlasCount: number;
  readonly atlasBytes: number;
  readonly atlasCpuBytes: number;
  readonly glyphCount: number;
  readonly atlasUploads: number;
  readonly atlasUploadedBytes: number;
  readonly unusedAtlasCount: number;
  readonly isolatedAtlasCount: number;
  readonly atlasResets: number;
  readonly atlasCapacityFailures: number;
  readonly submittedFrames: number;
  readonly deviceRecoveries: number;
  readonly pendingSurfaces: number;
  readonly healthy: boolean;
  readonly lastError: string | null;
};

export class WebGpuTerminalRuntime {
  private readonly surfaces = new Set<WebGpuRuntimeSurface>();
  private readonly dirtySurfaces = new Set<WebGpuRuntimeSurface>();
  private readonly atlases = new Map<string, AtlasEntry>();
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat = "bgra8unorm";
  private colorPipeline: GPURenderPipeline | null = null;
  private glyphPipeline: GPURenderPipeline | null = null;
  private colorBindGroupLayout: GPUBindGroupLayout | null = null;
  private glyphBindGroupLayout: GPUBindGroupLayout | null = null;
  private glyphSampler: GPUSampler | null = null;
  private animationFrame: number | null = null;
  private atlasReapTimer: ReturnType<typeof setTimeout> | null = null;
  private recovering: Promise<void> | null = null;
  private generation = 0;
  private submittedFrames = 0;
  private deviceRecoveries = 0;
  private fatalError: Error | null = null;
  private disposed = false;

  private constructor() {}

  static async create(): Promise<WebGpuTerminalRuntime> {
    const runtime = new WebGpuTerminalRuntime();
    try {
      await runtime.initializeDevice();
      document.addEventListener("visibilitychange", runtime.handleVisibility);
      return runtime;
    } catch (error) {
      runtime.dispose();
      throw error;
    }
  }

  register(surface: WebGpuRuntimeSurface): void {
    this.assertLive();
    this.assertHealthy();
    this.surfaces.add(surface);
  }

  unregister(surface: WebGpuRuntimeSurface): void {
    this.surfaces.delete(surface);
    this.dirtySurfaces.delete(surface);
    if (this.dirtySurfaces.size === 0 && this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  schedule(surface: WebGpuRuntimeSurface): void {
    if (this.disposed || this.fatalError || !this.surfaces.has(surface)) return;
    this.dirtySurfaces.add(surface);
    this.requestFrame();
  }

  acquireGlyphAtlas(
    metrics: TerminalFontMetrics,
    scale: number,
    user?: WebGpuRuntimeSurface,
  ): GlyphAtlasLease {
    return this.acquireAtlas(metrics, scale, null, user);
  }

  acquireIsolatedGlyphAtlas(
    metrics: TerminalFontMetrics,
    scale: number,
    ownerKey: string,
    user?: WebGpuRuntimeSurface,
  ): GlyphAtlasLease {
    return this.acquireAtlas(metrics, scale, ownerKey, user);
  }

  private acquireAtlas(
    metrics: TerminalFontMetrics,
    scale: number,
    ownerKey: string | null,
    user?: WebGpuRuntimeSurface,
  ): GlyphAtlasLease {
    this.assertLive();
    const baseKey = fontAtlasKey(metrics, scale);
    const key = ownerKey === null ? baseKey : `${baseKey}|owner:${ownerKey}`;
    let entry = this.atlases.get(key);
    if (!entry) {
      this.evictUnusedAtlas();
      if (this.atlases.size >= MAX_ATLAS_COUNT) {
        throw new Error(
          `Terminal glyph atlas budget exhausted (${MAX_ATLAS_COUNT} active atlases)`,
        );
      }
      const users = new Set<WebGpuRuntimeSurface>();
      entry = {
        key,
        metrics,
        scale,
        isolated: ownerKey !== null,
        users,
        atlas: this.createAtlas(metrics, scale, users),
        references: 0,
        lastUsed: performance.now(),
      };
      this.atlases.set(key, entry);
    }
    entry.references += 1;
    if (user) entry.users.add(user);
    entry.lastUsed = performance.now();
    this.scheduleAtlasReap();

    let released = false;
    return {
      key,
      isolated: entry.isolated,
      get atlas() {
        return entry.atlas;
      },
      release: () => {
        if (released) return;
        released = true;
        entry.references = Math.max(0, entry.references - 1);
        if (user) entry.users.delete(user);
        entry.lastUsed = performance.now();
        this.scheduleAtlasReap();
      },
    };
  }

  resources(): WebGpuSharedResources {
    this.assertLive();
    if (
      !this.device ||
      !this.colorPipeline ||
      !this.glyphPipeline ||
      !this.colorBindGroupLayout ||
      !this.glyphBindGroupLayout ||
      !this.glyphSampler
    ) {
      throw new Error("WebGPU terminal runtime is not ready");
    }
    return {
      device: this.device,
      format: this.format,
      colorPipeline: this.colorPipeline,
      glyphPipeline: this.glyphPipeline,
      colorBindGroupLayout: this.colorBindGroupLayout,
      glyphBindGroupLayout: this.glyphBindGroupLayout,
      glyphSampler: this.glyphSampler,
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
    let isolatedAtlasCount = 0;
    let atlasResets = 0;
    let atlasCapacityFailures = 0;
    for (const entry of this.atlases.values()) {
      atlasBytes += entry.atlas.byteSize;
      atlasCpuBytes += entry.atlas.cpuByteSize;
      glyphCount += entry.atlas.glyphCount;
      atlasUploads += entry.atlas.uploadCount;
      atlasUploadedBytes += entry.atlas.uploadedBytes;
      atlasResets += entry.atlas.resetCount;
      atlasCapacityFailures += entry.atlas.capacityFailureCount;
      if (entry.references === 0) unusedAtlasCount += 1;
      if (entry.isolated) isolatedAtlasCount += 1;
    }
    return {
      generation: this.generation,
      surfaceCount: this.surfaces.size,
      atlasCount: this.atlases.size,
      atlasBytes,
      atlasCpuBytes,
      glyphCount,
      atlasUploads,
      atlasUploadedBytes,
      unusedAtlasCount,
      isolatedAtlasCount,
      atlasResets,
      atlasCapacityFailures,
      submittedFrames: this.submittedFrames,
      deviceRecoveries: this.deviceRecoveries,
      pendingSurfaces: this.dirtySurfaces.size,
      healthy: this.fatalError === null,
      lastError: this.fatalError?.message ?? null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener("visibilitychange", this.handleVisibility);
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    if (this.atlasReapTimer !== null) clearTimeout(this.atlasReapTimer);
    this.atlasReapTimer = null;
    this.dirtySurfaces.clear();
    this.surfaces.clear();
    for (const entry of this.atlases.values()) entry.atlas.dispose();
    this.atlases.clear();
    this.device?.destroy();
    this.device = null;
  }

  private readonly handleVisibility = (): void => {
    const visible = document.visibilityState === "visible";
    for (const surface of this.surfaces) {
      surface.handleVisibilityChange(visible);
    }
    if (visible) this.requestFrame();
  };

  private requestFrame(): void {
    if (
      this.animationFrame !== null ||
      this.recovering ||
      this.fatalError ||
      this.dirtySurfaces.size === 0 ||
      document.visibilityState !== "visible"
    ) {
      return;
    }
    this.animationFrame = requestAnimationFrame(() => this.flushFrame());
  }

  private flushFrame(): void {
    this.animationFrame = null;
    if (this.disposed || this.recovering || this.dirtySurfaces.size === 0)
      return;

    const batch = [...this.dirtySurfaces];
    this.dirtySurfaces.clear();
    try {
      const resources = this.resources();
      const encoder = resources.device.createCommandEncoder({
        label: "Terax terminal window frame",
      });
      let rendered = false;

      for (const surface of batch) {
        if (!this.surfaces.has(surface)) continue;
        try {
          rendered = surface.renderFrame(encoder, resources) || rendered;
        } catch (error) {
          surface.handleRuntimeError(toError(error));
        }
      }

      if (rendered) {
        resources.device.queue.submit([encoder.finish()]);
        let completion: Promise<undefined> | null = null;
        for (const entry of this.atlases.values()) {
          if (!entry.atlas.hasEncodedUploads) continue;
          completion ??= resources.device.queue
            .onSubmittedWorkDone()
            .catch(() => undefined);
          entry.atlas.completeSubmission(completion);
        }
        this.submittedFrames += 1;
      }
    } catch (error) {
      this.disable(toError(error));
    }
    this.requestFrame();
  }

  private async initializeDevice(): Promise<void> {
    if (typeof navigator === "undefined" || !("gpu" in navigator)) {
      throw new Error("WebGPU is unavailable in this webview");
    }
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "low-power",
    });
    if (!adapter) throw new Error("No compatible WebGPU adapter was found");
    const device = await adapter.requestDevice({
      label: "Terax shared terminal renderer",
    });
    device.addEventListener("uncapturederror", (event) => {
      if (this.disposed || this.device !== device) return;
      this.disable(
        new Error(`WebGPU validation error: ${event.error.message}`),
      );
    });

    this.device = device;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    await this.createSharedResources(device, this.format);
    this.generation += 1;
    const generation = this.generation;
    void device.lost.then((info) => {
      if (
        !this.disposed &&
        !this.fatalError &&
        generation === this.generation
      ) {
        void this.recoverDevice(info.message || String(info.reason));
      }
    });
  }

  private async createSharedResources(
    device: GPUDevice,
    format: GPUTextureFormat,
  ): Promise<void> {
    this.colorBindGroupLayout = device.createBindGroupLayout({
      label: "Terax terminal color bindings",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.glyphBindGroupLayout = device.createBindGroupLayout({
      label: "Terax terminal glyph bindings",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
      ],
    });

    const colorModule = device.createShaderModule({
      label: "Terax terminal color shader",
      code: COLOR_SHADER,
    });
    const glyphModule = device.createShaderModule({
      label: "Terax terminal glyph shader",
      code: GLYPH_SHADER,
    });
    const colorPipelineDescriptor: GPURenderPipelineDescriptor = {
      label: "Terax terminal color pipeline",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.colorBindGroupLayout],
      }),
      vertex: {
        module: colorModule,
        entryPoint: "vertex_main",
        buffers: [colorVertexLayout()],
      },
      fragment: {
        module: colorModule,
        entryPoint: "fragment_main",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    };
    const glyphPipelineDescriptor: GPURenderPipelineDescriptor = {
      label: "Terax terminal glyph pipeline",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.glyphBindGroupLayout],
      }),
      vertex: {
        module: glyphModule,
        entryPoint: "vertex_main",
        buffers: [glyphVertexLayout()],
      },
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
    };
    [this.colorPipeline, this.glyphPipeline] = await Promise.all([
      device.createRenderPipelineAsync(colorPipelineDescriptor),
      device.createRenderPipelineAsync(glyphPipelineDescriptor),
    ]);
    this.glyphSampler = device.createSampler({
      label: "Terax terminal glyph sampler",
      minFilter: "linear",
      magFilter: "linear",
    });
  }

  private recoverDevice(reason: string): Promise<void> {
    if (this.recovering) return this.recovering;
    this.recovering = (async () => {
      try {
        for (const entry of this.atlases.values()) entry.atlas.dispose();
        await this.initializeDevice();
        this.deviceRecoveries += 1;
        for (const entry of this.atlases.values()) {
          entry.atlas = this.createAtlas(
            entry.metrics,
            entry.scale,
            entry.users,
          );
        }
        const resources = this.resources();
        for (const surface of this.surfaces) {
          surface.handleRuntimeReset(resources);
          this.dirtySurfaces.add(surface);
        }
      } catch (error) {
        const recoveryError = new Error(
          `WebGPU recovery failed after ${reason}: ${toError(error).message}`,
        );
        this.disable(recoveryError);
      } finally {
        this.recovering = null;
        this.requestFrame();
      }
    })();
    return this.recovering;
  }

  private createAtlas(
    metrics: TerminalFontMetrics,
    scale: number,
    users: ReadonlySet<WebGpuRuntimeSurface>,
  ): GlyphAtlas {
    const device = this.resources().device;
    return new GlyphAtlas(device, metrics, scale, () => {
      for (const surface of users) this.schedule(surface);
    });
  }

  private evictUnusedAtlas(): void {
    if (this.atlases.size < MAX_ATLAS_COUNT) return;
    let oldest: AtlasEntry | null = null;
    for (const entry of this.atlases.values()) {
      if (entry.references > 0) continue;
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
      entry.atlas.dispose();
      this.atlases.delete(entry.key);
    }

    const warm = unused[0];
    if (!warm || !this.atlases.has(warm.key)) return;
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
        entry.atlas.dispose();
        this.atlases.delete(entry.key);
      }
    }
    this.scheduleAtlasReap();
  }

  private disable(error: Error): void {
    if (this.disposed || this.fatalError) return;
    this.fatalError = error;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.dirtySurfaces.clear();
    for (const surface of [...this.surfaces]) {
      surface.handleRuntimeError(error);
    }
    if (this.atlasReapTimer !== null) clearTimeout(this.atlasReapTimer);
    this.atlasReapTimer = null;
    for (const entry of this.atlases.values()) entry.atlas.dispose();
    this.atlases.clear();
    this.device?.destroy();
    this.device = null;
    this.colorPipeline = null;
    this.glyphPipeline = null;
    this.colorBindGroupLayout = null;
    this.glyphBindGroupLayout = null;
    this.glyphSampler = null;
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

function colorVertexLayout(): GPUVertexBufferLayout {
  return {
    arrayStride: PACKED_INSTANCE_BYTES,
    stepMode: "instance",
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x2" },
      { shaderLocation: 1, offset: 8, format: "float32x2" },
      { shaderLocation: 2, offset: 16, format: "unorm8x4" },
      { shaderLocation: 3, offset: 20, format: "unorm8x4" },
      { shaderLocation: 4, offset: 24, format: "unorm8x4" },
      { shaderLocation: 5, offset: 28, format: "uint32" },
    ],
  };
}

function glyphVertexLayout(): GPUVertexBufferLayout {
  return {
    arrayStride: PACKED_INSTANCE_BYTES,
    stepMode: "instance",
    attributes: [
      { shaderLocation: 0, offset: CELL_INSTANCE_BYTES, format: "float32x2" },
      { shaderLocation: 1, offset: 40, format: "float32x2" },
      { shaderLocation: 2, offset: 48, format: "unorm16x2" },
      { shaderLocation: 3, offset: 52, format: "unorm16x2" },
      { shaderLocation: 4, offset: 56, format: "unorm8x4" },
      { shaderLocation: 5, offset: 60, format: "uint32" },
    ],
  };
}

function fontAtlasKey(metrics: TerminalFontMetrics, scale: number): string {
  const font = metrics.font;
  return [
    font.family,
    font.size,
    font.weight,
    font.lineHeight,
    font.letterSpacing,
    scale,
  ].join("|");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
