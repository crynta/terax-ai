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
    expect(pacer.plan(new Set([scrolling]), false, 5)).toEqual({
      kind: "frame",
    });
    expect(pacer.due(scrolling, false, 17)).toBe(true);
    expect(pacer.due(streaming, false, 17)).toBe(false);
    pacer.presented(scrolling, 140);
    expect(pacer.due(scrolling, false, 160)).toBe(false);
    expect(pacer.due(scrolling, false, 207)).toBe(true);
    expect(pacer.plan(new Set(), false, 207)).toEqual({ kind: "idle" });
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

  it("presents a pane that has never drawn at once and sleeps between unfocused frames", () => {
    const pacer = new SurfaceFramePacer();
    const surface = { isFocused: () => true };
    const dirty = new Set([surface]);
    expect(pacer.plan(dirty, true, 0)).toEqual({ kind: "frame" });
    pacer.presented(surface, 0);
    expect(pacer.due(surface, true, 8)).toBe(false);
    expect(pacer.due(surface, true, 1_000 / 60)).toBe(true);
    // Unknown display phase: sleep until one refresh before the deadline.
    const plan = pacer.plan(dirty, false, 0);
    expect(plan.kind).toBe("wait");
    expect(plan.kind === "wait" ? plan.delayMs : 0).toBeCloseTo(
      1_000 / 15 - 1_000 / 60,
    );
    expect(pacer.due(surface, false, 50)).toBe(false);
    expect(pacer.due(surface, false, 1_000 / 15)).toBe(true);
    pacer.reset();
    expect(pacer.due(surface, false, 0)).toBe(true);
  });
});

describe("resize gestures", () => {
  it("presents every pane on every display refresh while a gesture is live, whatever its cadence", () => {
    const pacer = new SurfaceFramePacer();
    const background = { isFocused: () => false };
    const unfocusedWindowPane = { isFocused: () => true };
    pacer.presented(background, 0);
    pacer.presented(unfocusedWindowPane, 0);
    // Without a gesture both wait for their own cadence.
    expect(pacer.due(background, true, 8)).toBe(false);
    expect(pacer.due(unfocusedWindowPane, false, 8)).toBe(false);

    pacer.setGesture(true);
    for (const now of [8, 16]) {
      expect(pacer.due(background, true, now)).toBe(true);
      expect(pacer.due(unfocusedWindowPane, true, now)).toBe(true);
    }
    pacer.dirty(background, 10);
    expect(pacer.plan(new Set([background]), true, 10)).toEqual({
      kind: "frame",
    });

    // The gesture ends: the cadence is back.
    pacer.setGesture(false);
    pacer.presented(background, 20);
    expect(pacer.due(background, true, 28)).toBe(false);
  });
});

describe("shared frame ticks", () => {
  it("makes a background pane wait for the end of the tick in which it turned dirty", () => {
    const pacer = new SurfaceFramePacer();
    const pane = { isFocused: () => false };
    pacer.presented(pane, 0);
    // 100 ms of silence, then output at 110 ms (tick [100, 133.3)).
    pacer.dirty(pane, 110);
    expect(pacer.due(pane, true, 111)).toBe(false);
    expect(pacer.due(pane, true, 132)).toBe(false);
    expect(pacer.due(pane, true, 100 + 1_000 / 30)).toBe(true);
  });

  it("lets a pane that turns dirty within a tick of another join that pane's frame", () => {
    const pacer = new SurfaceFramePacer();
    const first = { isFocused: () => false };
    const second = { isFocused: () => false };
    for (const pane of [first, second]) pacer.presented(pane, 0);
    pacer.dirty(first, 101);
    pacer.dirty(second, 128);
    const boundary = 100 + 1_000 / 30;
    expect(pacer.due(first, true, boundary)).toBe(true);
    expect(pacer.due(second, true, boundary)).toBe(true);
    // And they share one frame request: nothing is due before the boundary.
    const plan = pacer.plan(new Set([first, second]), true, 105);
    expect(plan.kind).toBe("wait");
    expect(plan.kind === "wait" ? plan.delayMs : 0).toBeCloseTo(
      boundary - 105 - 1_000 / 60,
    );
  });

  it("presents a pane at most once per tick, even after a late frame", () => {
    const pacer = new SurfaceFramePacer();
    const pane = { isFocused: () => false };
    const tick = 1_000 / 30;
    pacer.presented(pane, 0);
    pacer.dirty(pane, tick * 3 + 1);
    // Presented late in its tick: dirty again right away, but not before a full tick later.
    const lateFrame = tick * 4 + 12;
    expect(pacer.due(pane, true, lateFrame)).toBe(true);
    pacer.presented(pane, lateFrame);
    pacer.dirty(pane, lateFrame + 1);
    expect(pacer.due(pane, true, tick * 5 - 2)).toBe(false);
    expect(pacer.due(pane, true, tick * 5)).toBe(true);
    // One tick per frame, however late: the frame after that one waits a whole tick more.
    pacer.presented(pane, tick * 5 + 10);
    pacer.dirty(pane, tick * 5 + 11);
    expect(pacer.due(pane, true, tick * 6 - 2)).toBe(false);
    expect(pacer.due(pane, true, tick * 6)).toBe(true);
  });

  it("never delays the focused pane or a pane the user is interacting with", () => {
    const pacer = new SurfaceFramePacer();
    const focused = { isFocused: () => true };
    const other = { isFocused: () => false };
    pacer.presented(focused, 0);
    pacer.presented(other, 0);
    pacer.dirty(focused, 101);
    pacer.dirty(other, 101);
    expect(pacer.due(focused, true, 101 + 1_000 / 60)).toBe(true);
    expect(pacer.due(other, true, 101 + 1_000 / 60)).toBe(false);
    pacer.interact(other, 101);
    expect(pacer.due(other, true, 101 + 1_000 / 60)).toBe(true);
  });

  it("snaps every pane of an unfocused window to its slower tick", () => {
    const pacer = new SurfaceFramePacer();
    const pane = { isFocused: () => true };
    pacer.presented(pane, 0);
    pacer.dirty(pane, 70);
    const tick = 1_000 / 15;
    expect(pacer.due(pane, false, tick * 2 - 1)).toBe(false);
    expect(pacer.due(pane, false, tick * 2)).toBe(true);
  });
});

describe("frame wakeups", () => {
  it("costs one animation frame per presented frame at the display's own rate", () => {
    const h = simulation({ refreshMs: 1_000 / 60, windowFocused: true });
    const pane = h.pane(true);
    h.everyVsync(pane, 3_000);
    h.run(3_000);
    expect(h.stats.timers).toBe(0);
    expect(h.stats.idleCallbacks).toBe(0);
    expect(h.stats.frames).toBeGreaterThan(170);
  });

  it("does not spend an animation frame per vsync waiting for a 60 Hz pane on a 120 Hz display", () => {
    const h = simulation({ refreshMs: 1_000 / 120, windowFocused: true });
    const pane = h.pane(true);
    h.everyVsync(pane, 4_000);
    h.run(4_000);
    // The first frames learn the refresh interval; afterwards no callback is wasted.
    expect(h.stats.frames).toBeGreaterThan(200);
    expect(h.stats.idleCallbacks).toBeLessThan(h.stats.frames * 0.1);
    expect(h.stats.callbacks).toBeLessThan(h.stats.frames * 1.1);
  });

  it("requests a callback only for the vsync that can serve a background pane's tick", () => {
    for (const refreshMs of [1_000 / 60, 1_000 / 120]) {
      const h = simulation({ refreshMs, windowFocused: true });
      const pane = h.pane(false);
      h.every(pane, 5, 4_000);
      h.run(4_000);
      expect(h.stats.frames).toBeGreaterThan(110);
      expect(h.stats.frames).toBeLessThanOrEqual(121);
      expect(h.stats.idleCallbacks).toBeLessThan(h.stats.frames * 0.1);
    }
  });

  it("wakes the page at most once per tick for four agent panes redrawing a dozen times a second", () => {
    const seconds = 10;
    const h = simulation({ refreshMs: 1_000 / 60, windowFocused: true });
    const panes = [h.pane(true), h.pane(false), h.pane(false), h.pane(false)];
    // Roughly 12 Hz each, out of phase, like four independent sessions.
    for (const [index, pane] of panes.entries())
      h.every(pane, 83, seconds * 1_000, index * 21 + 3);
    h.run(seconds * 1_000);
    const redraws = panes.length * Math.floor((seconds * 1_000) / 83);
    // Before shared ticks every redraw of a background pane was its own frame.
    expect(h.stats.presents).toBeGreaterThanOrEqual(redraws * 0.9);
    expect(h.stats.callbacks).toBeLessThan(redraws * 0.8);
    // The three background panes can wake the page at most 30 times a second between them.
    const background = simulation({
      refreshMs: 1_000 / 60,
      windowFocused: true,
    });
    const agents = [1, 2, 3, 4].map(() => background.pane(false));
    for (const [index, pane] of agents.entries())
      background.every(pane, 83, seconds * 1_000, index * 21 + 5);
    background.run(seconds * 1_000);
    expect(background.stats.frames).toBeLessThanOrEqual(seconds * 30 + 2);
    expect(background.stats.frames).toBeLessThan(
      background.stats.presents * 0.7,
    );
  });
});

// A virtual page: vsyncs, timers and animation-frame callbacks driven by the real pacer, with the
// same planning loop the renderer runtimes use.
function simulation(options: { refreshMs: number; windowFocused: boolean }) {
  type Surface = { isFocused(): boolean };
  const pacer = new SurfaceFramePacer();
  const queue: Array<{ at: number; seq: number; run: () => void }> = [];
  const dirty = new Set<Surface>();
  const stats = {
    callbacks: 0,
    idleCallbacks: 0,
    timers: 0,
    frames: 0,
    presents: 0,
  };
  let seq = 0;
  let now = 0;
  let framePending = false;
  let timerPending = false;
  const at = (time: number, run: () => void) =>
    queue.push({ at: time, seq: seq++, run });
  const nextVsync = (time: number) =>
    (Math.floor(time / options.refreshMs + 1e-9) + 1) * options.refreshMs;
  const request = () => {
    if (framePending || timerPending || dirty.size === 0) return;
    const plan = pacer.plan(dirty, options.windowFocused, now);
    if (plan.kind === "wait") {
      timerPending = true;
      at(now + plan.delayMs, () => {
        timerPending = false;
        stats.timers += 1;
        request();
      });
    } else if (plan.kind === "frame") {
      framePending = true;
      const vsync = nextVsync(now);
      at(vsync, () => flush(vsync));
    }
  };
  const flush = (frameAt: number) => {
    framePending = false;
    pacer.frameStarted(frameAt);
    stats.callbacks += 1;
    const batch = [...dirty];
    dirty.clear();
    let presented = 0;
    for (const pane of batch) {
      if (!pacer.due(pane, options.windowFocused, frameAt)) {
        dirty.add(pane);
        continue;
      }
      pacer.settled(pane);
      pacer.presented(pane, frameAt);
      presented += 1;
    }
    stats.presents += presented;
    if (presented > 0) stats.frames += 1;
    else stats.idleCallbacks += 1;
    request();
  };
  const output = (pane: Surface, time: number) =>
    at(time, () => {
      pacer.dirty(pane, now);
      dirty.add(pane);
      request();
    });
  return {
    stats,
    pane: (focused: boolean): Surface => ({ isFocused: () => focused }),
    /** New output every `periodMs` after `offsetMs`. */
    every(pane: Surface, periodMs: number, untilMs: number, offsetMs = 0) {
      for (let time = offsetMs; time < untilMs; time += periodMs)
        output(pane, time);
    },
    everyVsync(pane: Surface, untilMs: number) {
      for (
        let time = options.refreshMs / 2;
        time < untilMs;
        time += options.refreshMs
      )
        output(pane, time);
    },
    run(untilMs: number) {
      while (queue.length > 0) {
        queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const next = queue.shift();
        if (!next || next.at > untilMs) break;
        now = next.at;
        next.run();
      }
    },
  };
}
