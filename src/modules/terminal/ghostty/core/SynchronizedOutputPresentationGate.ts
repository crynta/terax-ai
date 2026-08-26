export const SYNCHRONIZED_OUTPUT_PRESENTATION_WATCHDOG_MS = 1_000;

/**
 * Prevents a renderer frame from observing a partially-updated DEC synchronized
 * output transaction. A bounded watchdog keeps a broken application from
 * freezing the last complete frame indefinitely.
 */
export class SynchronizedOutputPresentationGate {
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private suppressedValue = false;

  constructor(private readonly release: () => void) {}

  get suppressed(): boolean {
    return this.suppressedValue;
  }

  observe(active: boolean): void {
    if (active) {
      if (!this.suppressedValue) {
        this.suppressedValue = true;
        this.armWatchdog();
      }
      return;
    }
    if (this.suppressedValue) this.finish();
  }

  dispose(): void {
    this.clearWatchdog();
    this.suppressedValue = false;
  }

  private finish(): void {
    this.clearWatchdog();
    this.suppressedValue = false;
    this.release();
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdog = globalThis.setTimeout(() => {
      this.watchdog = null;
      if (!this.suppressedValue) return;
      this.suppressedValue = false;
      this.release();
    }, SYNCHRONIZED_OUTPUT_PRESENTATION_WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) globalThis.clearTimeout(this.watchdog);
    this.watchdog = null;
  }
}
