import { afterEach, describe, expect, it, vi } from "vitest";
import { RESIZE_PROMPT_HOLD_MS, ResizePromptHold } from "./ResizePromptHold";

afterEach(() => vi.useRealTimers());

function atPrompt(release = vi.fn()) {
  const hold = new ResizePromptHold(release);
  hold.observe({ type: "prompt-start" });
  hold.observe({ type: "prompt-end" });
  return { hold, release };
}

describe("ResizePromptHold", () => {
  it("holds a resize at a prompt until the shell's redraw ends the prompt", () => {
    vi.useFakeTimers();
    const { hold, release } = atPrompt();
    hold.resized(false);
    expect(hold.suppressed).toBe(true);

    // The redraw begins: still held, the prompt is incomplete.
    hold.observe({ type: "prompt-start" });
    expect(hold.suppressed).toBe(true);
    expect(release).not.toHaveBeenCalled();

    hold.observe({ type: "prompt-end" });
    expect(hold.suppressed).toBe(false);
    expect(release).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(release).toHaveBeenCalledOnce();
  });

  it("gives up after the deadline when the shell never redraws", () => {
    vi.useFakeTimers();
    const { hold, release } = atPrompt();
    hold.resized(false);
    vi.advanceTimersByTime(RESIZE_PROMPT_HOLD_MS - 1);
    expect(hold.suppressed).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hold.suppressed).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("keeps one deadline across repeated resizes while held", () => {
    vi.useFakeTimers();
    const { hold, release } = atPrompt();
    hold.resized(false);
    vi.advanceTimersByTime(RESIZE_PROMPT_HOLD_MS / 2);
    hold.resized(false);
    vi.advanceTimersByTime(RESIZE_PROMPT_HOLD_MS / 2);
    expect(hold.suppressed).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not engage away from a prompt", () => {
    vi.useFakeTimers();
    const hold = new ResizePromptHold(vi.fn());
    // No shell integration seen yet.
    hold.resized(false);
    expect(hold.suppressed).toBe(false);
    // A command is running.
    hold.observe({ type: "prompt-start" });
    hold.observe({ type: "prompt-end" });
    hold.observe({ type: "end-of-input" });
    hold.resized(false);
    expect(hold.suppressed).toBe(false);
    // Between a prompt's start and end (a redraw in progress).
    hold.observe({ type: "end-of-command", exitCode: 0 });
    hold.observe({ type: "prompt-start" });
    hold.resized(false);
    expect(hold.suppressed).toBe(false);
  });

  it("does not engage in the alternate screen", () => {
    const { hold } = atPrompt();
    hold.resized(true);
    expect(hold.suppressed).toBe(false);
  });

  it("releases when the user submits input or the screen is cleared", () => {
    for (const event of [
      { type: "end-of-input" },
      { type: "screen-cleared" },
    ] as const) {
      vi.useFakeTimers();
      const { hold, release } = atPrompt();
      hold.resized(false);
      hold.observe(event);
      expect(hold.suppressed).toBe(false);
      expect(release).toHaveBeenCalledOnce();
      expect(hold.promptVisible).toBe(false);
      vi.useRealTimers();
    }
  });

  it("drops its timer on dispose", () => {
    vi.useFakeTimers();
    const { hold, release } = atPrompt();
    hold.resized(false);
    hold.dispose();
    vi.runAllTimers();
    expect(release).not.toHaveBeenCalled();
    expect(hold.suppressed).toBe(false);
  });
});
