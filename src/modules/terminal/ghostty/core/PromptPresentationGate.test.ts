import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROMPT_PRESENTATION_WATCHDOG_MS,
  PromptPresentationGate,
} from "./PromptPresentationGate";

afterEach(() => vi.useRealTimers());

describe("PromptPresentationGate", () => {
  it("holds a multi-chunk prompt until OSC 133 reports prompt end", () => {
    vi.useFakeTimers();
    const release = vi.fn();
    const gate = new PromptPresentationGate(release);

    gate.observe({ type: "prompt-start" });
    expect(gate.suppressed).toBe(true);
    expect(release).not.toHaveBeenCalled();

    gate.observe({ type: "prompt-end" });
    expect(gate.suppressed).toBe(false);
    expect(release).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(release).toHaveBeenCalledOnce();
  });

  it("has a bounded fallback for malformed or interrupted integrations", () => {
    vi.useFakeTimers();
    const release = vi.fn();
    const gate = new PromptPresentationGate(release);

    gate.observe({ type: "prompt-start" });
    vi.advanceTimersByTime(PROMPT_PRESENTATION_WATCHDOG_MS - 1);
    expect(release).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(gate.suppressed).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("also releases when command execution proves the prompt is complete", () => {
    const release = vi.fn();
    const gate = new PromptPresentationGate(release);

    gate.observe({ type: "prompt-start" });
    gate.observe({ type: "end-of-input" });

    expect(gate.suppressed).toBe(false);
    expect(release).toHaveBeenCalledOnce();
    gate.dispose();
  });
});
