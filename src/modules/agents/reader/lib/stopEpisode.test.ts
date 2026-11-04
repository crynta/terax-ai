import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/terminal/lib/terminalSessionApi", () => ({
  writeToSession: vi.fn(() => true),
}));

import { FORCE_AFTER_MS, liveWorking, tickStop } from "./stopControl";
import {
  pressStopFor,
  resetStopFor,
  tickStopFor,
  useStopStore,
} from "./stopStore";

describe("liveWorking", () => {
  it("trusts the spinner line over the hook phase", () => {
    expect(liveWorking("idle", { done: false }, true)).toBe(true);
    expect(liveWorking("working", { done: true }, true)).toBe(false);
  });

  it("treats an input box with no spinner as idle, even if the phase says working", () => {
    // Esc interrupts Claude without a Stop hook, so the phase stays "working".
    expect(liveWorking("working", null, true)).toBe(false);
  });

  it("falls back to the phase when the screen can't be read", () => {
    expect(liveWorking("working", null, false)).toBe(true);
    expect(liveWorking("finished", null, false)).toBe(false);
  });
});

describe("Force stop belongs to the current working episode", () => {
  beforeEach(() => useStopStore.setState({ states: {}, stops: {} }));

  it("ends once the screen shows Claude stopped, even with the phase still at working", () => {
    vi.useFakeTimers();
    const start = Date.now();
    pressStopFor(1);
    vi.setSystemTime(start + FORCE_AFTER_MS + 10);
    tickStopFor(1, true);
    expect(useStopStore.getState().states[1]?.kind).toBe("force");
    tickStopFor(1, liveWorking("working", null, true));
    expect(useStopStore.getState().states[1]?.kind).toBe("stopped");
    vi.useRealTimers();
  });

  it("goes back to plain Stop when a new turn starts", () => {
    useStopStore.setState({
      states: { 2: { kind: "force", at: 0, presses: 1 } },
      stops: {},
    });
    resetStopFor(2);
    expect(useStopStore.getState().states[2]?.kind).toBe("idle");
  });

  it("never offers Force stop without a press", () => {
    let state = tickStop({ kind: "idle" }, 0, true);
    state = tickStop(state, FORCE_AFTER_MS * 3, true);
    expect(state.kind).toBe("idle");
  });
});
