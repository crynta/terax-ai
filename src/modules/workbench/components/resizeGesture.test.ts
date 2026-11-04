import { describe, expect, it, vi } from "vitest";
import { createResizeGesture } from "./resizeGesture";

function setup() {
  const frames: (() => void)[] = [];
  const io = {
    begin: vi.fn(),
    end: vi.fn(),
    apply: vi.fn(),
    schedule: vi.fn((flush: () => void) => frames.push(flush)),
    cancel: vi.fn(),
  };
  return { io, frames, gesture: createResizeGesture(io) };
}

describe("divider resize gesture", () => {
  it("spans one terminal gesture however many updates it carries", () => {
    const { io, gesture } = setup();
    gesture.start();
    gesture.start();
    gesture.update([0.4, 0.6]);
    gesture.update([0.3, 0.7]);
    expect(io.begin).toHaveBeenCalledTimes(1);
    expect(io.end).not.toHaveBeenCalled();
    gesture.finish();
    gesture.finish();
    expect(io.end).toHaveBeenCalledTimes(1);
    expect(gesture.active).toBe(false);
  });

  it("writes at most one ratio update per frame, the latest one", () => {
    const { io, frames, gesture } = setup();
    gesture.start();
    gesture.update([0.4, 0.6]);
    gesture.update([0.3, 0.7]);
    expect(io.schedule).toHaveBeenCalledTimes(1);
    frames[0]();
    expect(io.apply).toHaveBeenCalledExactlyOnceWith([0.3, 0.7]);
  });

  it("applies a pending update when it ends between frames", () => {
    const { io, gesture } = setup();
    gesture.start();
    gesture.update([0.25, 0.75]);
    gesture.finish();
    expect(io.cancel).toHaveBeenCalledTimes(1);
    expect(io.apply).toHaveBeenCalledExactlyOnceWith([0.25, 0.75]);
    expect(io.end).toHaveBeenCalledTimes(1);
  });

  it("ends nothing it never began", () => {
    const { io, gesture } = setup();
    gesture.finish();
    expect(io.end).not.toHaveBeenCalled();
    expect(io.apply).not.toHaveBeenCalled();
  });
});
