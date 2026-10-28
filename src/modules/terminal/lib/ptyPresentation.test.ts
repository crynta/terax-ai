import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PtyPresentationClass,
  PtyPresentationReporter,
} from "@/modules/terminal/lib/ptyPresentation";

describe("PtyPresentationReporter", () => {
  let hidden: boolean;
  let notify: () => void;
  let watching: number;
  let send: ReturnType<
    typeof vi.fn<
      (
        ids: number[],
        presentation: PtyPresentationClass,
        seq: number,
      ) => Promise<unknown>
    >
  >;
  let reporter: PtyPresentationReporter;
  const flush = () => Promise.resolve();

  beforeEach(() => {
    hidden = false;
    watching = 0;
    notify = () => {};
    send = vi.fn(() => Promise.resolve());
    reporter = new PtyPresentationReporter(
      send,
      () => hidden,
      (listener) => {
        watching++;
        notify = listener;
        return () => {
          watching--;
        };
      },
    );
  });

  it("derives the class from tab visibility and pane focus", () => {
    expect(reporter.classFor(1)).toBe("focused"); // unknown leaves start eager
    reporter.setLeaf(1, true, true);
    reporter.setLeaf(2, true, false);
    reporter.setLeaf(3, false, true);
    expect(reporter.classFor(1)).toBe("focused");
    expect(reporter.classFor(2)).toBe("visible");
    expect(reporter.classFor(3)).toBe("hidden");
    hidden = true;
    expect(reporter.classFor(1)).toBe("occluded");
  });

  it("does not report a terminal that already started in its current class", async () => {
    reporter.setLeaf(1, false, false);
    reporter.bind(1, 10, reporter.classFor(1));
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("reports only changes, batched per class", async () => {
    for (const leaf of [1, 2, 3]) reporter.setLeaf(leaf, true, leaf === 1);
    for (const leaf of [1, 2, 3])
      reporter.bind(leaf, leaf * 10, reporter.classFor(leaf));
    await flush();
    expect(send).not.toHaveBeenCalled();
    // A tab switch hides two leaves and shows another in the same tick.
    reporter.setLeaf(2, false, false);
    reporter.setLeaf(3, false, false);
    reporter.setLeaf(1, true, true); // unchanged
    await flush();
    expect(send.mock.calls).toEqual([[[20, 30], "hidden", 1]]);
    reporter.setLeaf(2, false, false); // unchanged: no new request
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    reporter.setLeaf(3, true, false);
    await flush();
    expect(send).toHaveBeenLastCalledWith([30], "visible", 2);
  });

  it("moves every terminal to occluded and back with one request per class", async () => {
    reporter.setLeaf(1, true, true);
    reporter.setLeaf(2, false, true);
    reporter.setLeaf(3, true, false);
    for (const leaf of [1, 2, 3])
      reporter.bind(leaf, leaf * 10, reporter.classFor(leaf));
    hidden = true;
    notify();
    await flush();
    expect(send.mock.calls).toEqual([[[10, 20, 30], "occluded", 1]]);
    send.mockClear();
    hidden = false;
    notify();
    await flush();
    expect(send.mock.calls).toEqual([
      [[10], "focused", 2],
      [[20], "hidden", 3],
      [[30], "visible", 4],
    ]);
  });

  it("numbers every request so native can drop a report that arrives late", async () => {
    reporter.setLeaf(1, true, true);
    reporter.setLeaf(2, true, false);
    reporter.bind(1, 10, "focused");
    reporter.bind(2, 20, "visible");
    reporter.setLeaf(1, false, false);
    reporter.setLeaf(2, false, false);
    await flush();
    reporter.setLeaf(1, true, true);
    await flush();
    hidden = true;
    notify();
    await flush();
    hidden = false;
    notify();
    await flush();
    const numbers = send.mock.calls.map(([, , seq]) => seq);
    expect(numbers.length).toBeGreaterThanOrEqual(4);
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });

  it("keeps numbering across a failed request instead of reusing its number", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    reporter.setLeaf(1, true, true);
    reporter.bind(1, 10, "focused");
    send.mockRejectedValueOnce(new Error("ipc down"));
    reporter.setLeaf(1, false, false);
    await flush();
    await flush();
    notify();
    await flush();
    expect(send.mock.calls.map(([, , seq]) => seq)).toEqual([1, 2]);
  });

  it("watches the window only while a terminal is bound", async () => {
    expect(watching).toBe(0);
    reporter.setLeaf(1, true, true);
    reporter.bind(1, 10, "focused");
    reporter.bind(2, 20, "focused");
    expect(watching).toBe(1);
    reporter.unbind(1, 10);
    expect(watching).toBe(1);
    reporter.forget(2);
    expect(watching).toBe(0);
  });

  it("keeps a leaf's state across a respawn and drops it when the leaf is gone", async () => {
    reporter.setLeaf(1, false, false);
    reporter.bind(1, 10, "hidden");
    reporter.unbind(1, 10);
    expect(reporter.classFor(1)).toBe("hidden");
    reporter.bind(1, 11, reporter.classFor(1));
    await flush();
    expect(send).not.toHaveBeenCalled();
    reporter.forget(1);
    reporter.setLeaf(1, true, true);
    await flush();
    expect(send).not.toHaveBeenCalled(); // nothing is bound any more
  });

  it("re-sends after a failed request instead of trusting it", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    reporter.setLeaf(1, true, true);
    reporter.bind(1, 10, "focused");
    send.mockRejectedValueOnce(new Error("ipc down"));
    reporter.setLeaf(1, false, false);
    await flush();
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    notify(); // any later trigger re-evaluates and retries
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith([10], "hidden", 2);
  });

  it("ignores a stale response for a class that has since changed", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    reporter.setLeaf(1, true, true);
    reporter.bind(1, 10, "focused");
    let fail!: (error: Error) => void;
    send.mockImplementationOnce(
      () => new Promise((_, reject) => (fail = reject)),
    );
    reporter.setLeaf(1, false, false);
    await flush();
    reporter.setLeaf(1, true, false);
    await flush();
    expect(send).toHaveBeenLastCalledWith([10], "visible", 2);
    fail(new Error("late"));
    await flush();
    await flush();
    notify();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
