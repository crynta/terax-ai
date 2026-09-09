export type TerminalFitBounds = {
  readonly width: number;
  readonly height: number;
};

export type TerminalFitQueueDiagnostics = {
  readonly requests: number;
  readonly applications: number;
  readonly coalesced: number;
  readonly pending: boolean;
};

/** Retains only the newest layout sample until the renderer can commit it. */
export class TerminalFitQueue {
  private bounds: TerminalFitBounds | null = null;
  private pendingValue = false;
  private requestCount = 0;
  private applicationCount = 0;
  private coalescedCount = 0;

  get pending(): boolean {
    return this.pendingValue;
  }

  request(bounds?: TerminalFitBounds): void {
    this.requestCount += 1;
    if (this.pendingValue) this.coalescedCount += 1;
    this.pendingValue = true;
    this.bounds = bounds
      ? { width: bounds.width, height: bounds.height }
      : null;
  }

  take(measure: () => TerminalFitBounds): TerminalFitBounds | null {
    if (!this.pendingValue) return null;
    const bounds = this.bounds ?? measure();
    this.pendingValue = false;
    this.bounds = null;
    this.applicationCount += 1;
    return bounds;
  }

  clear(): void {
    this.pendingValue = false;
    this.bounds = null;
  }

  diagnostics(): TerminalFitQueueDiagnostics {
    return {
      requests: this.requestCount,
      applications: this.applicationCount,
      coalesced: this.coalescedCount,
      pending: this.pendingValue,
    };
  }
}
