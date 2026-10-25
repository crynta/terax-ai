const MAX_PENDING_INPUT_BYTES = 256 * 1024;
const MAX_WRITE_BATCH_BYTES = 64 * 1024;

type PtyWriter = { write(bytes: Uint8Array): Promise<void> };

export class BoundedPtyWriter {
  private readonly queue: Uint8Array[] = [];
  private pty: PtyWriter | null = null;
  private flushingGeneration: number | null = null;
  private generation = 0;
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
    if (this.pty === pty) return;
    this.generation += 1;
    this.pty = pty;
    this.inFlightBytes = 0;
    this.failed = false;
    void this.flush();
  }

  detach(): void {
    this.generation += 1;
    this.pty = null;
    this.inFlightBytes = 0;
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
    if (
      this.flushingGeneration === this.generation ||
      this.disposed ||
      this.failed ||
      !this.pty
    )
      return;
    const generation = this.generation;
    const pty = this.pty;
    this.flushingGeneration = generation;
    try {
      while (
        !this.disposed &&
        generation === this.generation &&
        this.queue.length > 0
      ) {
        const batch = this.takeBatch();
        this.inFlightBytes = batch.byteLength;
        try {
          await pty.write(batch);
        } catch (error) {
          if (generation !== this.generation) return;
          this.failed = true;
          this.clear();
          if (!this.disposed) this.onError(error);
          return;
        } finally {
          if (generation === this.generation) this.inFlightBytes = 0;
        }
      }
    } finally {
      if (this.flushingGeneration === generation)
        this.flushingGeneration = null;
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
