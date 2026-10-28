import { smoothHooks } from "@/bench/smoothHooks";
import type { GhosttyTerminalEvent } from "@terax/ghostty-core/protocol";

/**
 * How long a pane keeps showing its previous frame after a resize cleared the prompt, waiting
 * for the shell's redraw. A shell answers SIGWINCH in a few milliseconds; a slow prompt (git
 * status in the prompt) can take longer, and then the blank prompt is shown rather than a
 * stale frame for longer than this.
 */
export const RESIZE_PROMPT_HOLD_MS = 70;

/**
 * Ghostty clears a redrawable prompt (OSC 133 `A` with `redraw` left on, which zsh, fish and
 * bash do) whenever the grid changes and relies on the shell to print it again on SIGWINCH.
 * Between the model resize and the redraw bytes the model really does show no prompt, so a
 * frame presented in that window flashes it blank. A resize gesture applies one resize, when
 * it ends, so this is one hold per gesture.
 *
 * This holds presentation (the surface keeps drawing its previous frame, see
 * `deferPresentation`) from a resize that happens at a prompt until the shell's redraw ends
 * (`prompt-end`), the user's input or a command starts, or `deadlineMs` passes. Parsing is
 * never delayed. It only engages at a shell prompt (tracked from the OSC 133 events) outside
 * the alternate screen, so applications that redraw on their own are untouched.
 */
let benchHoldSeq = 0;

export class ResizePromptHold {
  private readonly benchId = ++benchHoldSeq;
  private erasedPrompt = false;
  private atPrompt = false;
  private holding = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly release: () => void,
    private readonly deadlineMs = RESIZE_PROMPT_HOLD_MS,
  ) {}

  get suppressed(): boolean {
    return this.holding;
  }

  /** The cursor is at a shell prompt that Ghostty clears on resize. */
  get promptVisible(): boolean {
    return this.atPrompt;
  }

  /** A resize erased the prompt and the shell has not printed it again. */
  get promptErased(): boolean {
    return this.erasedPrompt;
  }

  /** The model's grid just changed size. */
  resized(alternateScreen: boolean): void {
    if (this.holding || !this.atPrompt || alternateScreen) return;
    this.erasedPrompt = true;
    if (__TERAX_BENCH__) {
      smoothHooks()?.cleared(this.benchId, true, performance.now());
      smoothHooks()?.hold(this.benchId, true, performance.now());
    }
    this.holding = true;
    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      this.finish(false);
    }, this.deadlineMs);
  }

  observe(event: GhosttyTerminalEvent): void {
    switch (event.type) {
      case "prompt-start":
        // The redraw begins (or a new prompt): the prompt is not complete until its end.
        this.atPrompt = false;
        return;
      case "prompt-end":
        this.atPrompt = true;
        this.finish();
        return;
      case "end-of-input":
      case "end-of-command":
      case "screen-cleared":
        this.atPrompt = false;
        this.finish();
        return;
      default:
        return;
    }
  }

  dispose(): void {
    this.clearTimer();
    this.erasedPrompt = false;
    this.holding = false;
    this.atPrompt = false;
  }

  private finish(redrawn = true): void {
    this.clearTimer();
    if (redrawn && this.erasedPrompt) {
      this.erasedPrompt = false;
      if (__TERAX_BENCH__)
        smoothHooks()?.cleared(this.benchId, false, performance.now());
    }
    if (!this.holding) return;
    this.holding = false;
    if (__TERAX_BENCH__) smoothHooks()?.hold(this.benchId, false, performance.now());
    this.release();
  }

  private clearTimer(): void {
    if (this.timer !== null) globalThis.clearTimeout(this.timer);
    this.timer = null;
  }
}
