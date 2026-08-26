export const PTY_RESIZE_DEBOUNCE_MS = 256;

export type PtyDimensions = {
  readonly cols: number;
  readonly rows: number;
};

export type PtyResizeSchedulerDiagnostics = {
  readonly schedules: number;
  readonly deliveries: number;
  readonly suspended: boolean;
  readonly timerScheduled: boolean;
  readonly pending: PtyDimensions | null;
  readonly delivered: PtyDimensions | null;
};

/**
 * Owns trailing PTY geometry delivery independently from a renderer surface.
 * Interactive layout transactions may suspend delivery while retaining only
 * the latest dimensions, and a replaced PTY generation can reset stale state.
 */
export class PtyResizeScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: PtyDimensions | null = null;
  private delivered: PtyDimensions | null = null;
  private suspended = false;
  private scheduleCount = 0;
  private deliveryCount = 0;

  constructor(
    private readonly deliver: (cols: number, rows: number) => void,
    private readonly delayMs = PTY_RESIZE_DEBOUNCE_MS,
  ) {}

  schedule(cols: number, rows: number): void {
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 1 ||
      rows < 1
    ) {
      throw new RangeError("PTY resize dimensions must be positive integers");
    }
    this.scheduleCount += 1;
    if (!sameDimensions(this.pending, cols, rows)) {
      this.pending = { cols, rows };
    }
    if (this.suspended) return;
    this.armTimer();
  }

  /** Holds the latest dimensions without notifying the shell. */
  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    if (this.timer !== null) globalThis.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Restarts the trailing quiet period for dimensions collected while held. */
  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    if (this.pending !== null) this.armTimer();
  }

  /** Clears dimensions belonging to a PTY generation that is being replaced. */
  reset(): void {
    if (this.timer !== null) globalThis.clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.delivered = null;
  }

  flush(): boolean {
    if (this.suspended) return false;
    if (this.timer !== null) globalThis.clearTimeout(this.timer);
    this.timer = null;
    const dimensions = this.pending;
    this.pending = null;
    if (
      !dimensions ||
      sameDimensions(this.delivered, dimensions.cols, dimensions.rows)
    ) {
      return false;
    }
    this.delivered = dimensions;
    this.deliveryCount += 1;
    this.deliver(dimensions.cols, dimensions.rows);
    return true;
  }

  diagnostics(): PtyResizeSchedulerDiagnostics {
    return {
      schedules: this.scheduleCount,
      deliveries: this.deliveryCount,
      suspended: this.suspended,
      timerScheduled: this.timer !== null,
      pending: this.pending ? { ...this.pending } : null,
      delivered: this.delivered ? { ...this.delivered } : null,
    };
  }

  private armTimer(): void {
    if (this.timer !== null) globalThis.clearTimeout(this.timer);
    this.timer = globalThis.setTimeout(() => this.flush(), this.delayMs);
  }
}

function sameDimensions(
  dimensions: PtyDimensions | null,
  cols: number,
  rows: number,
): boolean {
  return dimensions?.cols === cols && dimensions.rows === rows;
}
