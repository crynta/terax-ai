import { describe, expect, it, vi } from "vitest";
import { TerminalFitQueue } from "./TerminalFitQueue";

describe("TerminalFitQueue", () => {
  it("coalesces observer samples and applies only the newest geometry", () => {
    const queue = new TerminalFitQueue();
    const measure = vi.fn(() => ({ width: 900, height: 500 }));

    queue.request({ width: 700, height: 500 });
    queue.request({ width: 640, height: 500 });
    queue.request({ width: 620, height: 500 });

    expect(queue.take(measure)).toEqual({ width: 620, height: 500 });
    expect(measure).not.toHaveBeenCalled();
    expect(queue.take(measure)).toBeNull();
    expect(queue.diagnostics()).toEqual({
      requests: 3,
      applications: 1,
      coalesced: 2,
      pending: false,
    });
  });

  it("remeasures at commit time when an explicit sample is unavailable", () => {
    const queue = new TerminalFitQueue();
    queue.request({ width: 700, height: 500 });
    queue.request();

    expect(queue.take(() => ({ width: 680, height: 480 }))).toEqual({
      width: 680,
      height: 480,
    });
  });

  it("drops pending geometry when its surface detaches", () => {
    const queue = new TerminalFitQueue();
    queue.request({ width: 700, height: 500 });
    queue.clear();

    expect(queue.pending).toBe(false);
    expect(queue.take(() => ({ width: 1, height: 1 }))).toBeNull();
  });
});
