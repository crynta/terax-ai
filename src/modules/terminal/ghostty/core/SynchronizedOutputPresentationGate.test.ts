import { describe, expect, it, vi } from "vitest";
import {
  SYNCHRONIZED_OUTPUT_PRESENTATION_WATCHDOG_MS,
  SynchronizedOutputPresentationGate,
} from "./SynchronizedOutputPresentationGate";

describe("SynchronizedOutputPresentationGate", () => {
  it("holds an active transaction and releases its complete state once", () => {
    const release = vi.fn();
    const gate = new SynchronizedOutputPresentationGate(release);

    gate.observe(true);
    gate.observe(true);
    expect(gate.suppressed).toBe(true);
    expect(release).not.toHaveBeenCalled();

    gate.observe(false);
    expect(gate.suppressed).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
    gate.dispose();
  });

  it("uses a bounded watchdog for an unterminated transaction", () => {
    vi.useFakeTimers();
    try {
      const release = vi.fn();
      const gate = new SynchronizedOutputPresentationGate(release);
      gate.observe(true);

      vi.advanceTimersByTime(SYNCHRONIZED_OUTPUT_PRESENTATION_WATCHDOG_MS - 1);
      expect(gate.suppressed).toBe(true);
      expect(release).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(gate.suppressed).toBe(false);
      expect(release).toHaveBeenCalledTimes(1);
      gate.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
