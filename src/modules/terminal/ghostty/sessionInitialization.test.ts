import { describe, expect, it, vi } from "vitest";
import {
  initializeSessionGeneration,
  type SessionInitializationState,
} from "@/modules/terminal/ghostty/sessionInitialization";

describe("Ghostty startup failure handling", () => {
  it("reports a failed attempt once while preserving session ownership", async () => {
    const state: SessionInitializationState = {
      generation: 0,
      disposed: false,
      initializing: null,
    };
    const failure = new Error("shell unavailable");
    const start = vi.fn().mockRejectedValue(failure);
    const report = vi.fn();
    const first = initializeSessionGeneration(state, start, report);
    expect(initializeSessionGeneration(state, start, report)).toBe(first);
    await first;
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
    expect(state.disposed).toBe(false);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it.each(["closed", "replaced"])(
    "ignores a late failure for a %s generation",
    async (change) => {
      const state: SessionInitializationState = {
        generation: 0,
        disposed: false,
        initializing: null,
      };
      let reject: (error: Error) => void = () => {};
      const report = vi.fn();
      const initializing = initializeSessionGeneration(
        state,
        () =>
          new Promise<void>((_, fail) => {
            reject = fail;
          }),
        report,
      );
      if (change === "closed") state.disposed = true;
      else state.generation += 1;
      reject(new Error("late failure"));
      await initializing;
      expect(report).not.toHaveBeenCalled();
    },
  );
});
