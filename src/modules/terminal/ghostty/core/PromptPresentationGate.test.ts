import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROMPT_PRESENTATION_MISSING_MS,
  PROMPT_PRESENTATION_SUSPECT_MS,
  PROMPT_PRESENTATION_WATCHDOG_MS,
  PromptPresentationGate,
} from "./PromptPresentationGate";

afterEach(() => vi.useRealTimers());

function expiredPrompt(gate: PromptPresentationGate, ms: number) {
  gate.observe({ type: "prompt-start" });
  vi.advanceTimersByTime(ms - 1);
  expect(gate.suppressed).toBe(true);
  vi.advanceTimersByTime(1);
  expect(gate.suppressed).toBe(false);
}

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

  it("stops charging a full second once the prompt end is evidently missing", () => {
    vi.useFakeTimers();
    const release = vi.fn();
    const gate = new PromptPresentationGate(release);

    expiredPrompt(gate, PROMPT_PRESENTATION_WATCHDOG_MS);
    expiredPrompt(gate, PROMPT_PRESENTATION_SUSPECT_MS);
    expiredPrompt(gate, PROMPT_PRESENTATION_MISSING_MS);
    expiredPrompt(gate, PROMPT_PRESENTATION_MISSING_MS);
    expect(release).toHaveBeenCalledTimes(4);
    expect(PROMPT_PRESENTATION_MISSING_MS).toBeLessThanOrEqual(16);
    gate.dispose();
  });

  it("restores the full allowance when a prompt end is seen again", () => {
    vi.useFakeTimers();
    const gate = new PromptPresentationGate(() => {});

    expiredPrompt(gate, PROMPT_PRESENTATION_WATCHDOG_MS);
    expiredPrompt(gate, PROMPT_PRESENTATION_SUSPECT_MS);
    gate.observe({ type: "prompt-start" });
    gate.observe({ type: "prompt-end" });
    expiredPrompt(gate, PROMPT_PRESENTATION_WATCHDOG_MS);
    gate.dispose();
  });

  it("counts a prompt end that arrives after the watchdog as proof", () => {
    vi.useFakeTimers();
    const gate = new PromptPresentationGate(() => {});

    expiredPrompt(gate, PROMPT_PRESENTATION_WATCHDOG_MS);
    expiredPrompt(gate, PROMPT_PRESENTATION_SUSPECT_MS);
    gate.observe({ type: "prompt-start" });
    vi.advanceTimersByTime(PROMPT_PRESENTATION_MISSING_MS);
    gate.observe({ type: "prompt-end" });
    expiredPrompt(gate, PROMPT_PRESENTATION_WATCHDOG_MS);
    gate.dispose();
  });

  it("does not take a command start for a prompt end", () => {
    vi.useFakeTimers();
    const gate = new PromptPresentationGate(() => {});

    expiredPrompt(gate, PROMPT_PRESENTATION_WATCHDOG_MS);
    gate.observe({ type: "prompt-start" });
    vi.advanceTimersByTime(PROMPT_PRESENTATION_SUSPECT_MS);
    gate.observe({ type: "end-of-input" });
    expiredPrompt(gate, PROMPT_PRESENTATION_MISSING_MS);
    gate.dispose();
  });

  it("never holds a prompt longer than a second whatever it learned", () => {
    vi.useFakeTimers();
    const gate = new PromptPresentationGate(() => {});
    for (let i = 0; i < 10; i += 1) {
      gate.observe({ type: "prompt-start" });
      vi.advanceTimersByTime(PROMPT_PRESENTATION_WATCHDOG_MS);
      expect(gate.suppressed).toBe(false);
    }
    gate.dispose();
  });
});
