import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withBootTimeout } from "./useSpacesBoot";

describe("withBootTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the resolved value when the promise settles before the timeout", async () => {
    const onTimeout = vi.fn(() => "fallback");
    const result = await withBootTimeout(
      Promise.resolve("ok"),
      5000,
      onTimeout,
    );
    expect(result).toBe("ok");
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("falls back to onTimeout when the promise stalls past the deadline", async () => {
    const never = new Promise<string>(() => {});
    const onTimeout = vi.fn(() => "fallback");
    const pending = withBootTimeout(never, 5000, onTimeout);

    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toBe("fallback");
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("propagates rejection when the promise rejects before the timeout", async () => {
    const onTimeout = vi.fn(() => "fallback");
    await expect(
      withBootTimeout(Promise.reject(new Error("boom")), 5000, onTimeout),
    ).rejects.toThrow("boom");
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
