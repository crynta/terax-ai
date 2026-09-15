export class LatestClipboardWrite {
  private pending: string | null = null;
  private running = false;

  constructor(private readonly write: (text: string) => Promise<void>) {}

  enqueue(text: string): void {
    this.pending = text;
    if (this.running) return;
    this.running = true;
    queueMicrotask(() => void this.drain());
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending !== null) {
        const text = this.pending;
        this.pending = null;
        try {
          await this.write(text);
        } catch {
          /* Later writes can still succeed. */
        }
      }
    } finally {
      this.running = false;
    }
  }
}
