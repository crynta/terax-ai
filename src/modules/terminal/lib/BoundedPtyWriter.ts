const MAX_PENDING_INPUT_BYTES = 256 * 1024;
const MAX_WRITE_BATCH_BYTES = 64 * 1024;

type PtyWriter = { write(bytes: Uint8Array): Promise<void> };

export class BoundedPtyWriter {
  private readonly queue: Uint8Array[] = [];
  private pty: PtyWriter | null = null;
  private flushing = false;
  private disposed = false;
  private failed = false;
  private queuedBytes = 0;
  private inFlightBytes = 0;

  constructor(private readonly onError: (error: unknown) => void) {}

  get pendingBytes(): number {
    return this.queuedBytes + this.inFlightBytes;
  }

  attach(pty: PtyWriter): void {
    if (this.disposed) return;
    this.pty = pty;
    this.failed = false;
    void this.flush();
  }

  detach(): void {
    this.pty = null;
  }

  clear(): void {
    this.queue.length = 0;
    this.queuedBytes = 0;
  }

  enqueue(bytes: Uint8Array): boolean {
    if (this.disposed || this.failed || bytes.byteLength === 0) return false;
    if (this.pendingBytes + bytes.byteLength > MAX_PENDING_INPUT_BYTES) {
      this.onError(
        new Error(
          "Terminal input buffer is full. Wait for pending input or paste a smaller selection.",
        ),
      );
      return false;
    }
    this.queue.push(bytes);
    this.queuedBytes += bytes.byteLength;
    void this.flush();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.detach();
    this.clear();
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.disposed || this.failed || !this.pty) return;
    this.flushing = true;
    try {
      while (!this.disposed && this.pty && this.queue.length > 0) {
        const batch = this.takeBatch();
        this.inFlightBytes = batch.byteLength;
        try {
          await this.pty.write(batch);
        } catch (error) {
          this.failed = true;
          this.clear();
          if (!this.disposed) this.onError(error);
          return;
        } finally {
          this.inFlightBytes = 0;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private takeBatch(): Uint8Array {
    const length = Math.min(this.queuedBytes, MAX_WRITE_BATCH_BYTES);
    const first = this.queue[0];
    if (first.byteLength >= length) {
      const batch = first.subarray(0, length);
      if (first.byteLength === length) this.queue.shift();
      else this.queue[0] = first.subarray(length);
      this.queuedBytes -= length;
      return batch;
    }
    const batch = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const chunk = this.queue[0];
      const count = Math.min(chunk.byteLength, length - offset);
      batch.set(chunk.subarray(0, count), offset);
      if (count === chunk.byteLength) this.queue.shift();
      else this.queue[0] = chunk.subarray(count);
      offset += count;
    }
    this.queuedBytes -= length;
    return batch;
  }
}
