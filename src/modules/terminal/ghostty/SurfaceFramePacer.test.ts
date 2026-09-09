import { describe, expect, it } from "vitest";
import { SurfaceFramePacer } from "@/modules/terminal/ghostty/SurfaceFramePacer";

describe("per-pane frame pacing", () => {
  it("gives only the interacting pane foreground cadence while the window is unfocused", () => {
    const pacer = new SurfaceFramePacer();
    const scrolling = { isFocused: () => false };
    const streaming = { isFocused: () => true };
    pacer.presented(scrolling, 0);
    pacer.presented(streaming, 0);
    pacer.interact(scrolling, 5);
    expect(pacer.delay(new Set([scrolling]), false, 5)).toBe(0);
    expect(pacer.due(scrolling, false, 17)).toBe(true);
    expect(pacer.due(streaming, false, 17)).toBe(false);
    pacer.presented(scrolling, 140);
    expect(pacer.due(scrolling, false, 160)).toBe(false);
    expect(pacer.due(scrolling, false, 207)).toBe(true);
    expect(pacer.delay(new Set(), false, 207)).toBe(Number.POSITIVE_INFINITY);
  });

  it("does not pull background panes to the focused pane's cadence", () => {
    const pacer = new SurfaceFramePacer();
    const focused = { isFocused: () => true };
    const background = { isFocused: () => false };
    let focusedFrames = 0;
    let backgroundFrames = 0;
    for (let frame = 0; frame < 600; frame++) {
      const now = (frame * 1_000) / 60;
      if (pacer.due(focused, true, now)) {
        focusedFrames++;
        pacer.presented(focused, now);
      }
      if (pacer.due(background, true, now)) {
        backgroundFrames++;
        pacer.presented(background, now);
      }
    }
    expect(focusedFrames).toBe(600);
    expect(backgroundFrames).toBe(300);
  });

  it("requests RAF before the presentation deadline and sleeps between unfocused frames", () => {
    const pacer = new SurfaceFramePacer();
    const surface = { isFocused: () => true };
    const dirty = new Set([surface]);
    pacer.presented(surface, 0);
    expect(pacer.delay(dirty, true, 0)).toBe(0);
    expect(pacer.due(surface, true, 8)).toBe(false);
    expect(pacer.due(surface, true, 1_000 / 60)).toBe(true);
    expect(pacer.delay(dirty, false, 0)).toBeCloseTo(50);
    expect(pacer.due(surface, false, 50)).toBe(false);
    expect(pacer.due(surface, false, 1_000 / 15)).toBe(true);
    pacer.reset();
    expect(pacer.due(surface, false, 0)).toBe(true);
  });
});
