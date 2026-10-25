const MAX_PENDING_BYTES = 256 * 1024;
const MAX_PENDING_OPERATIONS = 256;
export const CLIPBOARD_READ_TIMEOUT_MS = 5_000;

type Options = {
  read(): Promise<string>;
  paste(text: string): boolean;
  send(bytes: Uint8Array): boolean;
  error(error: unknown): void;
};

type Read = { expired: boolean; timer: ReturnType<typeof setTimeout> };

export class ClipboardInputQueue {
  private readonly queue: (Uint8Array | "paste")[] = [];
  private queuedBytes = 0;
  private active: Read | null = null;
  private disposed = false;

  constructor(private readonly options: Options) {}

  send(bytes: Uint8Array): boolean {
    if (this.disposed) return false;
    if (!this.active || this.active.expired)
      return this.options.send(bytes) !== false;
    return this.enqueue(bytes);
  }

  paste(): void {
    if (this.disposed) return;
    if (this.active) {
      if (!this.active.expired) this.enqueue("paste");
      else this.options.error(new Error("Clipboard is still busy. Try again."));
      return;
    }
    const request: Read = {
      expired: false,
      timer: setTimeout(() => {
        request.expired = true;
        this.fail(new Error("Clipboard read timed out. Try again."));
      }, CLIPBOARD_READ_TIMEOUT_MS),
    };
    this.active = request;
    let reading: Promise<string>;
    try {
      reading = this.options.read();
    } catch (error) {
      this.finish(request, () => {
        throw error;
      });
      return;
    }
    void reading.then(
      (text) => this.finish(request, () => this.options.paste(text)),
      (error: unknown) =>
        this.finish(request, () => {
          throw error;
        }),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  cancel(): void {
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.expired = true;
    }
    this.discard();
  }

  private enqueue(operation: Uint8Array | "paste"): boolean {
    const bytes = operation === "paste" ? 0 : operation.byteLength;
    if (
      this.queue.length >= MAX_PENDING_OPERATIONS ||
      this.queuedBytes + bytes > MAX_PENDING_BYTES
    ) {
      if (this.active) {
        clearTimeout(this.active.timer);
        this.active.expired = true;
      }
      this.fail(
        new Error("Too much input is waiting for the clipboard. Try again."),
      );
      return false;
    }
    this.queue.push(operation);
    this.queuedBytes += bytes;
    return true;
  }

  private finish(request: Read, deliver: () => boolean): void {
    clearTimeout(request.timer);
    this.active = null;
    if (this.disposed || request.expired) return;
    try {
      if (deliver() === false) {
        this.discard();
        return;
      }
      while (!this.active && this.queue.length > 0) {
        const operation = this.queue.shift();
        if (operation === "paste") this.paste();
        else if (operation) {
          this.queuedBytes -= operation.byteLength;
          if (this.options.send(operation) === false) {
            this.discard();
            return;
          }
        }
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    this.discard();
    if (!this.disposed) this.options.error(error);
  }

  private discard(): void {
    this.queue.length = 0;
    this.queuedBytes = 0;
  }
}
