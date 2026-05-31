import { describe, expect, it } from "vitest";
import {
  WriteScheduler,
  type RafClock,
  type WritableEmulator,
} from "./writeScheduler";

/**
 * Controllable rAF clock — flush() runs every queued callback in FIFO order,
 * letting tests advance "frames" deterministically with no real timers/DOM.
 */
function makeClock() {
  let next = 1;
  const cbs = new Map<number, () => void>();
  const clock: RafClock = {
    request(cb) {
      const h = next++;
      cbs.set(h, cb);
      return h;
    },
    cancel(h) {
      cbs.delete(h);
    },
  };
  const frame = () => {
    const pending = [...cbs.entries()];
    cbs.clear();
    for (const [, cb] of pending) cb();
  };
  const queued = () => cbs.size;
  return { clock, frame, queued };
}

/** Records every write the emulator receives, concatenated, for byte-exactness. */
function makeRecorder(): WritableEmulator & {
  writes: Uint8Array[];
  joined(): Uint8Array;
} {
  const writes: Uint8Array[] = [];
  return {
    writes,
    write(data: string | Uint8Array) {
      writes.push(
        typeof data === "string" ? new TextEncoder().encode(data) : data,
      );
    },
    joined() {
      let total = 0;
      for (const w of writes) total += w.length;
      const out = new Uint8Array(total);
      let off = 0;
      for (const w of writes) {
        out.set(w, off);
        off += w.length;
      }
      return out;
    },
  };
}

const LEAF = 7;

describe("WriteScheduler — foreground hot path", () => {
  it("writes visible bytes SYNCHRONOUSLY (no coalesce delay)", () => {
    const { clock } = makeClock();
    const sched = new WriteScheduler(clock);
    const emu = makeRecorder();

    sched.deliver(LEAF, emu, new Uint8Array([1, 2, 3]), true);

    // Must have hit the emulator immediately, with no frame advance.
    expect(emu.writes.length).toBe(1);
    expect([...emu.writes[0]!]).toEqual([1, 2, 3]);
    expect(sched.pendingCount(LEAF)).toBe(0);
  });
});

describe("WriteScheduler — hidden coalescing", () => {
  it("coalesces hidden bytes into ONE write per frame, in order, lossless", () => {
    const { clock, frame } = makeClock();
    const sched = new WriteScheduler(clock);
    const emu = makeRecorder();

    sched.deliver(LEAF, emu, new Uint8Array([1, 1]), false);
    sched.deliver(LEAF, emu, new Uint8Array([2, 2]), false);
    sched.deliver(LEAF, emu, new Uint8Array([3, 3]), false);

    // Nothing written yet — all three chunks are queued for the next frame.
    expect(emu.writes.length).toBe(0);
    expect(sched.pendingCount(LEAF)).toBe(3);

    frame();

    // Exactly one coalesced write, byte-exact, in order.
    expect(emu.writes.length).toBe(1);
    expect([...emu.writes[0]!]).toEqual([1, 1, 2, 2, 3, 3]);
    expect(sched.pendingCount(LEAF)).toBe(0);
  });

  it("does NOT drop bytes on a >256KB multi-chunk flood (Defect B regression)", () => {
    // The deleted DormantRing capped at 256KB and dropped the MIDDLE/oldest
    // chunks on overflow — that drop is exactly what garbled cursor-relative
    // TUIs on restore. The scheduler must deliver EVERY byte.
    const { clock, frame } = makeClock();
    const sched = new WriteScheduler(clock);
    const emu = makeRecorder();

    const CHUNK = 4096;
    const CHUNKS = 100; // ~400KB total, well past the old 256KB ring cap
    const expected: number[] = [];
    for (let i = 0; i < CHUNKS; i++) {
      const c = new Uint8Array(CHUNK);
      // Distinct, position-derived content so any dropped middle chunk shows up.
      c.fill(i & 0xff);
      sched.deliver(LEAF, emu, c, false);
      for (let j = 0; j < CHUNK; j++) expected.push(i & 0xff);
    }

    frame();

    const joined = emu.joined();
    expect(joined.length).toBe(CHUNK * CHUNKS);
    // Byte-for-byte: nothing dropped, nothing reordered.
    expect([...joined]).toEqual(expected);
  });

  it("flush() on show delivers queued bytes immediately, before live write", () => {
    const { clock } = makeClock();
    const sched = new WriteScheduler(clock);
    const emu = makeRecorder();

    // Two chunks arrive while hidden...
    sched.deliver(LEAF, emu, new Uint8Array([9, 9]), false);
    sched.deliver(LEAF, emu, new Uint8Array([8]), false);
    // ...then the leaf becomes visible: a visible deliver flushes the queue
    // FIRST (preserving order), then writes the live chunk.
    sched.deliver(LEAF, emu, new Uint8Array([7]), true);

    const joined = emu.joined();
    expect([...joined]).toEqual([9, 9, 8, 7]);
    expect(sched.pendingCount(LEAF)).toBe(0);
  });

  it("cancel() drops queued work without flushing (dispose path)", () => {
    const { clock, frame, queued } = makeClock();
    const sched = new WriteScheduler(clock);
    const emu = makeRecorder();

    sched.deliver(LEAF, emu, new Uint8Array([1, 2, 3]), false);
    expect(queued()).toBe(1);

    sched.cancel(LEAF);
    frame();

    expect(emu.writes.length).toBe(0);
    expect(sched.pendingCount(LEAF)).toBe(0);
    expect(queued()).toBe(0);
  });

  it("isolates leaves (one leaf's flood never touches another)", () => {
    const { clock, frame } = makeClock();
    const sched = new WriteScheduler(clock);
    const a = makeRecorder();
    const b = makeRecorder();

    sched.deliver(1, a, new Uint8Array([1]), false);
    sched.deliver(2, b, new Uint8Array([2]), false);
    frame();

    expect([...a.joined()]).toEqual([1]);
    expect([...b.joined()]).toEqual([2]);
  });
});
