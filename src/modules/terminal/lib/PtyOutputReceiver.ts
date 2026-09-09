const ACK_TIMEOUT_MS = 5_000;
const MAX_ACK_REQUESTS = 2;
const MAX_PENDING_BYTES = 2 * 1024 * 1024;
const MAX_PENDING_CHUNKS = 2;

export type PtyOutputStatus = "running" | "retrying" | "stalled" | "failed";

type Chunk = { bytes: Uint8Array; end: number };
type Attempt = {
  end: number;
  expired: boolean;
  timer: ReturnType<typeof setTimeout>;
};

export class PtyOutputReceiver {
  private readonly queue: Chunk[] = [];
  private readonly attempts = new Set<Attempt>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private parserTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduled = false;
  private parsing = false;
  private disposed = false;
  private ready = false;
  private failed = false;
  private received = 0;
  private processed = 0;
  private confirmed = 0;
  private failures = 0;
  private retries = 0;
  private status: PtyOutputStatus = "running";

  constructor(
    private readonly parse: (bytes: Uint8Array) => void | Promise<void>,
    private readonly acknowledge: (bytes: number) => Promise<void>,
    private readonly onStatus: (status: PtyOutputStatus) => void,
  ) {}

  start(): void {
    if (this.disposed) return;
    this.ready = true;
    this.flush();
  }

  receive(bytes: Uint8Array): void {
    if (this.disposed || this.failed) return;
    if (
      bytes.length === 0 ||
      !Number.isSafeInteger(this.received + bytes.length) ||
      this.queue.length >= MAX_PENDING_CHUNKS ||
      this.received - this.processed + bytes.length > MAX_PENDING_BYTES
    ) {
      this.fail(
        new Error("PTY output exceeded the negotiated transport bounds"),
      );
      return;
    }
    this.received += bytes.length;
    this.queue.push({ bytes, end: this.received });
    this.drain();
  }

  retry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.flush();
  }

  diagnostics() {
    return {
      status: this.status,
      receivedBytes: this.received,
      processedBytes: this.processed,
      confirmedBytes: this.confirmed,
      pendingBytes: this.received - this.processed,
      pendingChunks: this.queue.length,
      ackRequests: this.attempts.size,
      ackRetries: this.retries,
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    if (this.parserTimer !== null) clearTimeout(this.parserTimer);
    for (const attempt of this.attempts) clearTimeout(attempt.timer);
    this.retryTimer = null;
    this.parserTimer = null;
    this.queue.length = 0;
    this.attempts.clear();
  }

  private drain(): void {
    if (this.parsing || this.disposed || this.failed) return;
    while (this.queue.length > 0) {
      const chunk = this.queue[0];
      try {
        const parsed = this.parse(chunk.bytes);
        if (parsed && typeof parsed.then === "function") {
          this.parsing = true;
          this.parserTimer = setTimeout(() => {
            this.parserTimer = null;
            this.setStatus("stalled");
          }, ACK_TIMEOUT_MS);
          void parsed.then(
            () => {
              if (this.disposed || this.failed) return;
              if (this.parserTimer !== null) clearTimeout(this.parserTimer);
              this.parserTimer = null;
              this.parsing = false;
              this.complete(chunk);
              this.drain();
            },
            (error) => this.fail(error),
          );
          return;
        }
        this.complete(chunk);
      } catch (error) {
        this.fail(error);
        return;
      }
    }
  }

  private complete(chunk: Chunk): void {
    this.queue.shift();
    this.processed = chunk.end;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.flush();
    });
  }

  private flush(): void {
    if (
      !this.ready ||
      this.disposed ||
      this.failed ||
      this.processed <= this.confirmed ||
      this.retryTimer !== null ||
      this.attempts.size >= MAX_ACK_REQUESTS
    )
      return;
    for (const attempt of this.attempts) {
      if (!attempt.expired) return;
    }
    const attempt: Attempt = {
      end: this.processed,
      expired: false,
      timer: setTimeout(() => {
        attempt.expired = true;
        this.setStatus("stalled");
        this.retries += 1;
        this.flush();
      }, ACK_TIMEOUT_MS),
    };
    this.attempts.add(attempt);
    let request: Promise<void>;
    try {
      request = this.acknowledge(attempt.end);
    } catch (error) {
      request = Promise.reject(error);
    }
    void request.then(
      () => {
        this.finishAttempt(attempt);
        if (this.disposed || this.failed) return;
        this.confirmed = Math.max(this.confirmed, attempt.end);
        this.failures = 0;
        this.setStatus("running");
        this.retry();
      },
      () => {
        this.finishAttempt(attempt);
        if (this.disposed || this.failed) return;
        if (attempt.end <= this.confirmed) {
          this.flush();
          return;
        }
        this.failures += 1;
        this.retries += 1;
        this.setStatus(this.failures >= 5 ? "stalled" : "retrying");
        if (this.retryTimer !== null) return;
        this.retryTimer = setTimeout(
          () => {
            this.retryTimer = null;
            this.flush();
          },
          Math.min(1_000, 50 * 2 ** Math.min(this.failures - 1, 5)),
        );
      },
    );
  }

  private finishAttempt(attempt: Attempt): void {
    clearTimeout(attempt.timer);
    this.attempts.delete(attempt);
  }

  private fail(error: unknown): void {
    if (this.disposed || this.failed) return;
    this.failed = true;
    if (this.parserTimer !== null) clearTimeout(this.parserTimer);
    this.parserTimer = null;
    this.setStatus("failed");
    console.error("[terax] PTY output delivery paused:", error);
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
