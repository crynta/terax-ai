export type PtyDimensions = {
  readonly cols: number;
  readonly rows: number;
};

export type PtyResizeDeliveryDiagnostics = {
  readonly requests: number;
  readonly deliveries: number;
  readonly delivered: PtyDimensions | null;
};

/**
 * Hands the grid size to the PTY the moment the model has it. The timing lives in
 * `TerminalResizeSync` (the model and the PTY must change together, so there is no second
 * debounce here); this only skips repeats and remembers what the current PTY generation last
 * received. A PTY that does not exist yet (the shell is still spawning) receives the size when
 * it is created, so a refused delivery is not recorded.
 */
export class PtyResizeDelivery {
  private delivered: PtyDimensions | null = null;
  private requestCount = 0;
  private deliveryCount = 0;

  /** `deliver` returns false when there is no PTY to tell. */
  constructor(
    private readonly deliver: (cols: number, rows: number) => boolean,
  ) {}

  send(cols: number, rows: number): boolean {
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 1 ||
      rows < 1
    ) {
      throw new RangeError("PTY resize dimensions must be positive integers");
    }
    this.requestCount += 1;
    if (this.delivered?.cols === cols && this.delivered.rows === rows) {
      return false;
    }
    if (!this.deliver(cols, rows)) return false;
    this.delivered = { cols, rows };
    this.deliveryCount += 1;
    return true;
  }

  /** Forgets what a PTY generation that is being replaced was told. */
  reset(): void {
    this.delivered = null;
  }

  diagnostics(): PtyResizeDeliveryDiagnostics {
    return {
      requests: this.requestCount,
      deliveries: this.deliveryCount,
      delivered: this.delivered ? { ...this.delivered } : null,
    };
  }
}
