import type { GhosttyTerminalEvent } from "@terax/ghostty-core/protocol";

export const PROMPT_PRESENTATION_WATCHDOG_MS = 1_000;

/**
 * Treats OSC 133 prompt boundaries as a presentation transaction. Parsing is
 * never delayed, but render notification waits for the matching prompt end so
 * multi-chunk prompts such as Starship do not expose intermediate clears.
 */
export class PromptPresentationGate {
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private suppressedValue = false;

  constructor(private readonly release: () => void) {}

  get suppressed(): boolean {
    return this.suppressedValue;
  }

  observe(event: GhosttyTerminalEvent): void {
    if (event.type === "prompt-start") {
      this.suppressedValue = true;
      this.armWatchdog();
      return;
    }
    if (
      this.suppressedValue &&
      (event.type === "prompt-end" || event.type === "end-of-input")
    ) {
      this.finish();
    }
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
    }, PROMPT_PRESENTATION_WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) globalThis.clearTimeout(this.watchdog);
    this.watchdog = null;
  }
}
