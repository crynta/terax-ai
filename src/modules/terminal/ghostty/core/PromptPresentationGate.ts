import type { GhosttyTerminalEvent } from "@terax/ghostty-core/protocol";

/** How long a prompt may be held while its end marker has been seen before. */
export const PROMPT_PRESENTATION_WATCHDOG_MS = 1_000;
/** After one prompt that never ended: the marker is probably missing. */
export const PROMPT_PRESENTATION_SUSPECT_MS = 120;
/** After two in a row: stop holding prompts beyond one frame. */
export const PROMPT_PRESENTATION_MISSING_MS = 16;

/**
 * Treats OSC 133 prompt boundaries as a presentation transaction. Parsing is
 * never delayed, but render notification waits for the matching prompt end so
 * multi-chunk prompts such as Starship do not expose intermediate clears.
 *
 * The wait is bounded by a watchdog that learns from the session. A shell
 * whose prompt framework drops the end marker would otherwise hold every
 * prompt for the full second; consecutive prompts that ended on the watchdog
 * shorten it, and any prompt that ends properly restores the full allowance.
 */
export class PromptPresentationGate {
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private suppressedValue = false;
  private awaitingEnd = false;
  private missedEnds = 0;

  constructor(private readonly release: () => void) {}

  get suppressed(): boolean {
    return this.suppressedValue;
  }

  observe(event: GhosttyTerminalEvent): void {
    if (event.type === "prompt-start") {
      this.suppressedValue = true;
      this.awaitingEnd = true;
      this.armWatchdog();
      return;
    }
    if (event.type !== "prompt-end" && event.type !== "end-of-input") return;
    // A prompt end that shows up after the watchdog gave up still proves the
    // shell sends them, so the next prompt gets the full allowance again. A
    // command starting proves nothing about the prompt.
    if (event.type === "prompt-end" && this.awaitingEnd) this.missedEnds = 0;
    this.awaitingEnd = false;
    if (this.suppressedValue) this.finish();
  }

  dispose(): void {
    this.clearWatchdog();
    this.suppressedValue = false;
    this.awaitingEnd = false;
  }

  private finish(): void {
    this.clearWatchdog();
    this.suppressedValue = false;
    this.release();
  }

  private allowanceMs(): number {
    if (this.missedEnds === 0) return PROMPT_PRESENTATION_WATCHDOG_MS;
    if (this.missedEnds === 1) return PROMPT_PRESENTATION_SUSPECT_MS;
    return PROMPT_PRESENTATION_MISSING_MS;
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdog = globalThis.setTimeout(() => {
      this.watchdog = null;
      if (!this.suppressedValue) return;
      this.suppressedValue = false;
      this.missedEnds = Math.min(this.missedEnds + 1, 2);
      this.release();
    }, this.allowanceMs());
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) globalThis.clearTimeout(this.watchdog);
    this.watchdog = null;
  }
}
