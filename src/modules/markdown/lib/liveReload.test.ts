import { describe, expect, it } from "vitest";
import { createCoalescer, touchesPath, type Timers } from "./liveReload";

function fakeTimers() {
  let time = 0;
  let next = 1;
  const queue = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    now: () => time,
    set: (fn, ms) => {
      const id = next++;
      queue.set(id, { at: time + ms, fn });
      return id;
    },
    clear: (h) => void queue.delete(h as number),
  };
  const advance = (ms: number) => {
    const end = time + ms;
    for (;;) {
      const due = [...queue.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      queue.delete(due[0]);
      time = due[1].at;
      due[1].fn();
    }
    time = end;
  };
  return { timers, advance };
}

describe("touchesPath", () => {
  it("matches the file regardless of separator style", () => {
    expect(touchesPath(["C:\\p\\a.md"], "C:/p/a.md")).toBe(true);
    expect(touchesPath(["/p/b.md", "/p/a.md"], "/p/a.md")).toBe(true);
  });

  it("ignores other files and parent directories", () => {
    expect(touchesPath(["/p", "/p/b.md"], "/p/a.md")).toBe(false);
  });
});

describe("createCoalescer", () => {
  it("collapses a burst into one trailing call", () => {
    const { timers, advance } = fakeTimers();
    let calls = 0;
    const c = createCoalescer(() => calls++, 100, 1000, timers);
    c.poke();
    advance(50);
    c.poke();
    advance(50);
    c.poke();
    advance(99);
    expect(calls).toBe(0);
    advance(1);
    expect(calls).toBe(1);
    expect(c.pending).toBe(false);
  });

  it("still fires every maxWait while events keep arriving", () => {
    const { timers, advance } = fakeTimers();
    let calls = 0;
    const c = createCoalescer(() => calls++, 100, 300, timers);
    for (let t = 0; t < 700; t += 50) {
      c.poke();
      advance(50);
    }
    expect(calls).toBe(2);
  });

  it("cancel drops a pending call", () => {
    const { timers, advance } = fakeTimers();
    let calls = 0;
    const c = createCoalescer(() => calls++, 100, 1000, timers);
    c.poke();
    c.cancel();
    advance(500);
    expect(calls).toBe(0);
  });
});
