/**
 * Makes JavaScriptCore see the native cost of the WebGPU wrappers a presented frame creates.
 *
 * Every window frame creates a canvas texture, its view, a command encoder, a render pass and a
 * command buffer wrapper. WebKit pins about 13 KiB of malloc per frame behind them until the
 * wrappers are garbage collected, and JavaScriptCore does not account for that memory: the
 * JavaScript heap stays tiny, so no collection runs for minutes (about 20 MiB a minute for a
 * visible streaming agent; a forced collection returns all of it). Allocating, and at once
 * dropping, an `ArrayBuffer` per frame makes the engine's allocation heuristics see it, so
 * young-generation collections run steadily and finalize the dead wrappers.
 *
 * The buffers are small, so this never provokes a full collection (the earlier probe of four
 * 64 MiB buffers every 30 s cost about 0.5 core-seconds per firing). The weight is ten times the
 * native cost because that is what it takes: with the app lab (`--instrument`, a visible
 * streaming agent, 120 s, about 25 frames a second) the unfinalized canvas textures at the end
 * were 2,626 with no mirroring, 939 at 5x, 195 at 10x and 42 at 20x, WebKit malloc grew by
 * 36, 10, 2.5 MiB and not at all, and WebContent's instructions per second did not move.
 *
 * The collector reacts to allocation volume, not to frame count, so the volume is capped
 * (`GC_MIRROR_MAX_BYTES_PER_SECOND`): at a display's rate the full weight per frame would be
 * 15 MB/s of zero-filled buffers for the cadence 3 MB/s gives a 25 fps agent. App lab,
 * 48 frames a second: 6.5 MB/s mirrored before, 4.4 after, WebKit malloc flat either way.
 */

/** WebKit malloc pinned per presented window frame (measured with the app lab, `--instrument`). */
export const NATIVE_BYTES_PER_FRAME = 12_900;
/** How much of it, in multiples, the collector is told about (see above). */
export const GC_MIRROR_FACTOR = 10;
/** Bytes accumulated before one buffer is allocated. */
export const GC_MIRROR_BATCH_BYTES = 64 * 1024;
/**
 * Most bytes mirrored per second. The collector reacts to allocation volume, not to frame
 * count, so a faster display does not need more of it: at the display rate of a 120 Hz screen
 * the full weight would be 15 MB/s of zero-filled buffers for the same collection cadence a
 * 25 fps agent gets from 3 MB/s. The cap sits just above the 25 fps case, which therefore
 * mirrors every frame as measured; faster frames are mirrored in proportion to the time.
 */
export const GC_MIRROR_MAX_BYTES_PER_SECOND = 4 * 1024 * 1024;

/**
 * The default mirror allocation. The buffer is detached at once (`transfer(0)`, where the engine
 * has it) so its zero-filled pages are never resident: a plain allocation sat in the JS VM
 * Gigacage (1.3 to 13 MiB in a quiet session) until JavaScriptCore collected it, while the
 * allocation volume the collector reacts to is counted all the same.
 */
export function allocateMirrorBuffer(bytes: number): void {
  (
    new ArrayBuffer(bytes) as { transfer?: (length: number) => unknown }
  ).transfer?.(0);
}

export type GcPressureOptions = {
  readonly bytesPerFrame?: number;
  readonly batchBytes?: number;
  /** Cap on mirrored bytes per second; 0 or less means uncapped. */
  readonly maxBytesPerSecond?: number;
  /** Replaced in tests; the default allocates an ArrayBuffer. */
  readonly allocate?: (bytes: number) => unknown;
  /** Replaced in tests; milliseconds. */
  readonly now?: () => number;
};

export type GcPressureStats = {
  readonly enabled: boolean;
  readonly frames: number;
  readonly allocations: number;
  readonly allocatedBytes: number;
  readonly bytesPerFrame: number;
  readonly batchBytes: number;
  readonly maxBytesPerSecond: number;
};

export class GcPressureMirror {
  private readonly bytesPerFrame: number;
  private readonly batchBytes: number;
  private readonly maxBytesPerSecond: number;
  /** Most owed or allowed at once: a quarter second of the cap. */
  private readonly burstBytes: number;
  private readonly allocate: (bytes: number) => unknown;
  private readonly now: () => number;
  private pending = 0;
  private allowance: number;
  private lastAt: number;
  private frames = 0;
  private allocations = 0;
  private allocatedBytes = 0;

  constructor(options: GcPressureOptions = {}) {
    this.bytesPerFrame = Math.max(
      0,
      options.bytesPerFrame ?? NATIVE_BYTES_PER_FRAME * GC_MIRROR_FACTOR,
    );
    this.batchBytes = Math.max(1, options.batchBytes ?? GC_MIRROR_BATCH_BYTES);
    const cap = options.maxBytesPerSecond ?? GC_MIRROR_MAX_BYTES_PER_SECOND;
    this.maxBytesPerSecond = cap > 0 ? cap : Number.MAX_VALUE;
    this.burstBytes = this.maxBytesPerSecond / 4;
    this.allocate = options.allocate ?? allocateMirrorBuffer;
    this.now = options.now ?? (() => performance.now());
    this.allowance = this.burstBytes;
    this.lastAt = this.now();
  }

  /**
   * A window frame was submitted; allocates a dropped buffer once enough cost has built up and
   * the per-second cap allows it. Cost the cap holds back is not owed later: it is dropped
   * beyond one burst, because the wrappers it stood for are finalized by the collections the
   * mirrored volume already triggers.
   */
  noteFrame(frames = 1): void {
    this.frames += frames;
    const now = this.now();
    this.allowance = Math.min(
      this.burstBytes,
      this.allowance + ((now - this.lastAt) * this.maxBytesPerSecond) / 1000,
    );
    this.lastAt = now;
    this.pending = Math.min(
      this.pending + this.bytesPerFrame * frames,
      Math.max(this.burstBytes, this.batchBytes),
    );
    const bytes = Math.floor(
      Math.min(this.pending, this.allowance, this.batchBytes * 4),
    );
    // Whole batches only: wait for the cost, and for the cap, rather than allocating slivers.
    if (this.pending < this.batchBytes || bytes < this.batchBytes) return;
    this.pending -= bytes;
    this.allowance -= bytes;
    this.allocations += 1;
    this.allocatedBytes += bytes;
    this.allocate(bytes);
  }

  diagnostics(): GcPressureStats {
    return {
      enabled: this.bytesPerFrame > 0,
      frames: this.frames,
      allocations: this.allocations,
      allocatedBytes: this.allocatedBytes,
      bytesPerFrame: this.bytesPerFrame,
      batchBytes: this.batchBytes,
      maxBytesPerSecond: this.maxBytesPerSecond,
    };
  }
}

/**
 * `localStorage["terax:terminal-gc-mirror"]`: `off`, or
 * `<bytesPerFrame>[:<batchBytes>]`, for experiments;
 * unset means the defaults above.
 */
const GC_MIRROR_STORAGE_KEY = "terax:terminal-gc-mirror";
export function gcPressureOptionsFromStorage(): GcPressureOptions {
  try {
    const value =
      typeof window === "undefined"
        ? null
        : (window.localStorage?.getItem(GC_MIRROR_STORAGE_KEY) ?? null);
    if (value === null) return {};
    if (value === "off") return { bytesPerFrame: 0 };
    const [perFrame, batch] = value.split(":").map(Number);
    return {
      bytesPerFrame:
        Number.isFinite(perFrame) && perFrame >= 0 ? perFrame : undefined,
      batchBytes: Number.isFinite(batch) && batch > 0 ? batch : undefined,
    };
  } catch {
    return {};
  }
}
