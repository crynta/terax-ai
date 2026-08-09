import { describe, expect, it } from "vitest";
import { createReadinessQueue } from "./readiness";

describe("createReadinessQueue", () => {
  it("preserves readiness update order", async () => {
    const release: Array<() => void> = [];
    const started: boolean[] = [];
    const enqueue = createReadinessQueue(
      (ready) =>
        new Promise<void>((resolve) => {
          started.push(ready);
          release.push(resolve);
        }),
    );

    const first = enqueue(false);
    const second = enqueue(true);
    await Promise.resolve();
    expect(started).toEqual([false]);

    release.shift()?.();
    await first;
    await Promise.resolve();
    expect(started).toEqual([false, true]);

    release.shift()?.();
    await second;
  });

  it("continues after a failed update", async () => {
    const states: boolean[] = [];
    const enqueue = createReadinessQueue(async (ready) => {
      states.push(ready);
      if (!ready) throw new Error("failed");
    });

    await expect(enqueue(false)).rejects.toThrow("failed");
    await expect(enqueue(true)).resolves.toBeUndefined();
    expect(states).toEqual([false, true]);
  });
});
