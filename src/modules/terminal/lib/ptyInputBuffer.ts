const MAX_PENDING_INPUT = 64 * 1024;

type Writer = (data: string) => void;

export class PtyInputBuffer {
  private writer: Writer | null = null;
  private pending = "";
  private accepting = false;

  startOpening(): void {
    this.writer = null;
    this.accepting = true;
  }

  attach(writer: Writer): void {
    this.writer = writer;
    this.accepting = true;
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = "";
    writer(pending);
  }

  write(data: string): boolean {
    if (!this.accepting) return false;
    if (this.writer) {
      this.writer(data);
      return true;
    }
    if (this.pending.length + data.length > MAX_PENDING_INPUT) return false;
    this.pending += data;
    return true;
  }

  stop(): void {
    this.writer = null;
    this.pending = "";
    this.accepting = false;
  }
}
