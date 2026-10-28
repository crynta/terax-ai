import { schedulePtyParse } from "@/modules/terminal/lib/ptyParseScheduler";
import {
  PTY_WINDOW_BYTES,
  PTY_WINDOW_CHUNKS,
} from "@/modules/terminal/lib/ptyWire";

const PARSE_STALL_MS = 5_000;
const MAX_PARSE_SLICE_BYTES = 32 * 1024;
const PARSE_BUDGET_MS = 4;

export type PtyOutputStatus = "running" | "retrying" | "stalled" | "failed";
export type PtyTransportStatus = "ok" | "retrying" | "stalled";

type Chunk = { bytes: Uint8Array; end: number; offset: number };

/**
 * Owns one terminal's delivered output: slices it into at most 32 KiB parses
 * with a four-millisecond work budget, and reports the cumulative offset of
 * fully parsed chunks. Credit is only ever earned at original chunk
 * boundaries, so a partially parsed chunk never releases bytes.
 *
 * Transport concerns (batching progress into polls, retries, backoff) belong
 * to `PtyOutputHub`, which tells the receiver how the transport is doing so
 * the one visible stall/failure state stays in a single place.
 */
export class PtyOutputReceiver {
  private readonly queue: Chunk[] = [];
  private parserTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelYield: (() => void) | null = null;
  private parseSlices = 0;
  private parseYields = 0;
  private scheduled = false;
  private parsing = false;
  private disposed = false;
  private ready = false;
  private failed = false;
  private parseStalled = false;
  private transport: PtyTransportStatus = "ok";
  private received = 0;
  private processed = 0;
  private reported = 0;
  private status: PtyOutputStatus = "running";

  constructor(
    private readonly parse: (bytes: Uint8Array) => void | Promise<void>,
    /** Cumulative parsed offset at a chunk boundary; coalesced per microtask. */
    private readonly onProgress: (processedBytes: number) => void,
    private readonly onStatus: (status: PtyOutputStatus) => void,
    private readonly scheduleParse = schedulePtyParse,
  ) {}

  /** Delivery stopped for good; nothing more may be acknowledged. */
  get hasFailed(): boolean {
    return this.failed;
  }

  start(): void {
    if (this.disposed) return;
    this.ready = true;
    this.reportProgress();
  }

  receive(bytes: Uint8Array): void {
    if (this.disposed || this.failed) return;
    if (
      bytes.length === 0 ||
      !Number.isSafeInteger(this.received + bytes.length) ||
      this.queue.length >= PTY_WINDOW_CHUNKS ||
      this.received - this.processed + bytes.length > PTY_WINDOW_BYTES
    ) {
      this.fail(
        new Error("PTY output exceeded the negotiated transport bounds"),
      );
      return;
    }
    this.received += bytes.length;
    this.queue.push({ bytes, end: this.received, offset: 0 });
    this.drain();
  }

  /** The hub's view of the transport: `ok`, retrying with backoff, or stalled. */
  setTransportStatus(status: PtyTransportStatus): void {
    this.transport = status;
    this.refreshStatus();
  }

  /** A protocol violation or native failure: stop delivery visibly. */
  fail(error: unknown): void {
    if (this.disposed || this.failed) return;
    this.failed = true;
    if (this.parserTimer !== null) clearTimeout(this.parserTimer);
    this.cancelYield?.();
    this.parserTimer = null;
    this.cancelYield = null;
    this.queue.length = 0;
    this.setStatus("failed");
    console.error("[terax] PTY output delivery paused:", error);
  }

  diagnostics() {
    return {
      status: this.status,
      receivedBytes: this.received,
      processedBytes: this.processed,
      reportedBytes: this.reported,
      pendingBytes: this.received - this.processed,
      pendingChunks: this.queue.length,
      parseSlices: this.parseSlices,
      parseYields: this.parseYields,
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.parserTimer !== null) clearTimeout(this.parserTimer);
    this.cancelYield?.();
    this.parserTimer = null;
    this.cancelYield = null;
    this.queue.length = 0;
  }

  private drain(deadline = performance.now() + PARSE_BUDGET_MS): void {
    if (
      this.parsing ||
      this.disposed ||
      this.failed ||
      this.cancelYield !== null
    )
      return;
    while (this.queue.length > 0) {
      if (performance.now() >= deadline) {
        this.parseYields++;
        try {
          this.cancelYield = this.scheduleParse(() => {
            this.cancelYield = null;
            this.drain();
          });
        } catch (error) {
          this.fail(error);
        }
        return;
      }
      const chunk = this.queue[0];
      const end = Math.min(
        chunk.offset + MAX_PARSE_SLICE_BYTES,
        chunk.bytes.length,
      );
      try {
        this.parseSlices++;
        const parsed = this.parse(chunk.bytes.subarray(chunk.offset, end));
        if (parsed && typeof parsed.then === "function") {
          this.parsing = true;
          this.parserTimer = setTimeout(() => {
            this.parserTimer = null;
            this.parseStalled = true;
            this.refreshStatus();
          }, PARSE_STALL_MS);
          void parsed.then(
            () => {
              if (this.disposed || this.failed) return;
              if (this.parserTimer !== null) clearTimeout(this.parserTimer);
              this.parserTimer = null;
              this.parseStalled = false;
              this.parsing = false;
              this.completeSlice(chunk, end);
              this.refreshStatus();
              this.drain(deadline);
            },
            (error) => this.fail(error),
          );
          return;
        }
        this.completeSlice(chunk, end);
      } catch (error) {
        this.fail(error);
        return;
      }
    }
  }

  private completeSlice(chunk: Chunk, offset: number): void {
    chunk.offset = offset;
    if (offset < chunk.bytes.length) return;
    this.queue.shift();
    this.processed = chunk.end;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.reportProgress();
    });
  }

  private reportProgress(): void {
    if (
      !this.ready ||
      this.disposed ||
      this.failed ||
      this.processed <= this.reported
    )
      return;
    this.reported = this.processed;
    try {
      this.onProgress(this.processed);
    } catch (error) {
      console.error("[terax] PTY progress report failed:", error);
    }
  }

  private refreshStatus(): void {
    if (this.parseStalled || this.transport === "stalled")
      this.setStatus("stalled");
    else if (this.transport === "retrying") this.setStatus("retrying");
    else this.setStatus("running");
  }

  private setStatus(status: PtyOutputStatus): void {
    if (
      this.disposed ||
      (this.failed && status !== "failed") ||
      this.status === status
    )
      return;
    this.status = status;
    try {
      this.onStatus(status);
    } catch (error) {
      console.error("[terax] PTY status notification failed:", error);
    }
  }
}
