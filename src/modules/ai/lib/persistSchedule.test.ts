import { describe, expect, it } from "vitest";
import {
  PERSIST_MAX_WAIT_MS,
  PERSIST_MIN_INTERVAL_MS,
  PERSIST_QUIET_MS,
  persistDelay,
} from "@/modules/ai/lib/persistSchedule";

describe("persistDelay", () => {
  it("waits for a quiet gap after the first change of an idle conversation", () => {
    expect(persistDelay(10_000, 10_000, null)).toBe(PERSIST_QUIET_MS);
  });

  it("never waits past the max wait while tokens keep arriving", () => {
    const first = 10_000;
    expect(persistDelay(first + 3_500, first, null)).toBe(
      PERSIST_MAX_WAIT_MS - 3_500,
    );
    expect(persistDelay(first + PERSIST_MAX_WAIT_MS, first, null)).toBe(0);
    expect(persistDelay(first + PERSIST_MAX_WAIT_MS + 500, first, null)).toBe(
      0,
    );
  });

  it("spaces saves at least the minimum interval apart", () => {
    const lastSaved = 50_000;
    const now = lastSaved + 100;
    const first = lastSaved + 50;
    const delay = persistDelay(now, first, lastSaved);
    expect(now + delay).toBeGreaterThanOrEqual(
      lastSaved + PERSIST_MIN_INTERVAL_MS,
    );
    expect(now + delay).toBeLessThanOrEqual(first + PERSIST_MAX_WAIT_MS);
  });

  it("bounds a continuous stream to a handful of saves", () => {
    // Simulate a token every 20 ms for a minute.
    let saves = 0;
    let lastSaved: number | null = null;
    let firstPending: number | null = null;
    let due = Infinity;
    for (let t = 0; t <= 60_000; t += 20) {
      if (t >= due) {
        saves += 1;
        lastSaved = t;
        firstPending = null;
        due = Infinity;
      }
      firstPending ??= t;
      due = t + persistDelay(t, firstPending, lastSaved);
    }
    expect(saves).toBeGreaterThanOrEqual(60_000 / PERSIST_MAX_WAIT_MS - 1);
    expect(saves).toBeLessThanOrEqual(60_000 / PERSIST_MIN_INTERVAL_MS);
  });

  it("never returns a negative delay", () => {
    expect(persistDelay(1_000_000, 0, 0)).toBe(0);
  });
});
