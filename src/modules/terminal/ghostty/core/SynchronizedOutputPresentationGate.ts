export const SYNCHRONIZED_OUTPUT_PRESENTATION_WATCHDOG_MS = 1_000;

/**
 * Prevents a renderer frame from observing a partially-updated DEC synchronized
 * output transaction. A bounded watchdog keeps a broken application from
 * freezing the last complete frame indefinitely. `observe` receives the mode
 * level after every write, so an expired transaction stays over until the mode
 * is seen off: an application that died inside one would otherwise re-arm the
 * hold on its next write and update the screen once a second. Parser reset
 * events also observe the off state when a write immediately enables it again.
 */
export class SynchronizedOutputPresentationGate {
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private suppressedValue = false;
  private expired = false;

  constructor(private readonly release: () => void) {}

  get suppressed(): boolean {
    return this.suppressedValue;
  }

  observe(active: boolean): void {
    if (active) {
      if (!this.suppressedValue && !this.expired) {
        this.suppressedValue = true;
        this.armWatchdog();
      }
      return;
    }
    this.expired = false;
    if (this.suppressedValue) this.finish();
  }

  dispose(): void {
    this.clearWatchdog();
    this.suppressedValue = false;
    this.expired = false;
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
      this.expired = true;
      this.release();
    }, SYNCHRONIZED_OUTPUT_PRESENTATION_WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) globalThis.clearTimeout(this.watchdog);
    this.watchdog = null;
  }
}
