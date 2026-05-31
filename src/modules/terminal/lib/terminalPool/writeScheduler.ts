// F3 — background write coalescer.
//
// WHY: Under the persistent-buffer model every leaf's emulator is ALWAYS fed
// PTY bytes, visible or not (skipping the parse is exactly what the old
// DormantRing did, and that byte-dropping caused Defect B). A backgrounded
// `yes`/`tail -f` flood would otherwise call emulator.write() thousands of
// times per second from every hidden leaf at once.
//
// WHEN: Wraps every PTY -> emulator.write delivery. The VISIBLE/foreground leaf
// writes synchronously on each chunk (zero change to the hot path — locked by a
// test). A HIDDEN leaf appends to a per-emulator pending list and flushes a
// single concatenated write once per animation frame (or immediately on show),
// collapsing thousands of tiny writes into ~60 coalesced writes/sec. xterm's
// own WriteBuffer (WRITE_TIMEOUT_MS slicing + DISCARD_WATERMARK) bounds the
// parse cost on top of this; the coalescer bounds the per-call/scheduler cost.
//
// HOW: A pure scheduler with INJECTABLE clocks (requestAnimationFrame +
// cancelAnimationFrame, AND setTimeout + clearTimeout) so the coalescing is
// unit-tested deterministically with fake timers — no DOM, no canvas. NEVER
// drops bytes; correctness == every byte delivered exactly once, in order.
//
// BOUNDED under a paused rAF (the OS backgrounds the WHOLE app window): rAF is
// throttled/paused while a hidden PTY keeps flooding (`yes`/`tail -f`), so a
// flush gated ONLY on requestAnimationFrame would let the per-leaf chunks[] grow
// unbounded until the window is foregrounded. Two guards prevent that, WITHOUT
// dropping bytes:
//   1. A per-leaf PENDING-BYTE CAP (MAX_PENDING_BYTES). When the queue would
//      exceed it, flush NOW (synchronously write the coalesced bytes into the
//      persistent xterm buffer, which is itself bounded by options.scrollback).
//      This is lossless — every byte still reaches the buffer in order — and
//      caps queue RAM at the cap, mirroring the deleted DormantRing's 256KB
//      hard limit but without DormantRing's lossy middle-byte drop (Defect B).
//   2. A setTimeout FALLBACK flush scheduled alongside the rAF request. If rAF
//      never fires (paused window), the timer drains the queue independently.
//      Whichever fires first flushes; the loser is cancelled in flush().

// Minimal surface of an xterm Terminal this scheduler touches. Kept structural
// (not an import of @xterm/xterm) so the scheduler is testable headless with a
// trivial fake — matching the osc-handlers.test.ts fake-term pattern.
export type WritableEmulator = {
  write(data: string | Uint8Array): void;
};

export type RafClock = {
  request(cb: () => void): number;
  cancel(handle: number): void;
};

/**
 * Timeout clock — the rAF-INDEPENDENT fallback. Injectable so the paused-rAF
 * background-flood path is unit-tested deterministically with fake timers.
 */
export type TimerClock = {
  set(cb: () => void, ms: number): number;
  clear(handle: number): void;
};

const defaultClock: RafClock = {
  request:
    typeof requestAnimationFrame === "function"
      ? (cb) => requestAnimationFrame(cb)
      : (cb) => setTimeout(cb, 16) as unknown as number,
  cancel:
    typeof cancelAnimationFrame === "function"
      ? (h) => cancelAnimationFrame(h)
      : (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
};

const defaultTimer: TimerClock = {
  set: (cb, ms) => setTimeout(cb, ms) as unknown as number,
  clear: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
};

// Hard cap on bytes queued (coalescing) per leaf while hidden. Crossing it
// forces an immediate flush into the persistent buffer so chunks[] RAM stays
// bounded even when rAF is paused. Mirrors the deleted DormantRing's 256KB cap.
export const MAX_PENDING_BYTES = 256 * 1024;

// Fallback flush delay when rAF does not fire (paused background window). ~4
// frames at 60Hz — long enough not to compete with rAF in the foreground, short
// enough to drain a paused-window queue promptly.
export const FALLBACK_FLUSH_MS = 64;

type Pending = {
  emulator: WritableEmulator;
  chunks: Uint8Array[];
  bytes: number;
  rafHandle: number | null;
  timerHandle: number | null;
};

/**
 * Per-emulator write coalescer. One instance owns the pending state for all
 * leaves it schedules for; key by a stable id (the leafId).
 */
export class WriteScheduler {
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly clock: RafClock = defaultClock,
    private readonly timer: TimerClock = defaultTimer,
    private readonly maxPendingBytes: number = MAX_PENDING_BYTES,
  ) {}

  /**
   * Deliver PTY bytes to the leaf's emulator.
   *
   * - visible=true  -> write synchronously NOW (hot-path latency unchanged).
   *   Any bytes that were coalescing while it was hidden are flushed first so
   *   ordering is preserved.
   * - visible=false -> append to the per-leaf pending buffer, flushed once per
   *   animation frame. Never dropped.
   */
  deliver(
    leafId: number,
    emulator: WritableEmulator,
    bytes: Uint8Array,
    visible: boolean,
  ): void {
    if (bytes.length === 0) return;
    if (visible) {
      // Flush anything still queued from the hidden window FIRST so the
      // concatenated history stays in order, then write the live chunk.
      this.flush(leafId);
      emulator.write(bytes);
      return;
    }
    let p = this.pending.get(leafId);
    if (!p) {
      p = { emulator, chunks: [], bytes: 0, rafHandle: null, timerHandle: null };
      this.pending.set(leafId, p);
    } else {
      // Emulator identity is stable per leaf, but defensively keep the latest.
      p.emulator = emulator;
    }
    p.chunks.push(bytes);
    p.bytes += bytes.length;

    // BOUND: if the queue has grown past the cap (rAF paused under a backgrounded
    // window + a PTY flood), flush NOW into the persistent buffer. Lossless —
    // every queued byte is written in order; only the in-memory queue is bounded.
    if (p.bytes >= this.maxPendingBytes) {
      this.flush(leafId);
      return;
    }

    // Schedule a rAF flush (foreground-fast) AND a setTimeout fallback flush
    // (rAF-independent — drains even if the window is backgrounded and rAF is
    // throttled/paused). flush() cancels whichever did not fire.
    if (p.rafHandle === null) {
      p.rafHandle = this.clock.request(() => {
        const cur = this.pending.get(leafId);
        if (cur) cur.rafHandle = null;
        this.flush(leafId);
      });
    }
    if (p.timerHandle === null) {
      p.timerHandle = this.timer.set(() => {
        const cur = this.pending.get(leafId);
        if (cur) cur.timerHandle = null;
        this.flush(leafId);
      }, FALLBACK_FLUSH_MS);
    }
  }

  /**
   * Synchronously flush any pending coalesced bytes for a leaf as a single
   * write. Called on show (the leaf becomes visible) and internally on rAF.
   * Concatenates into one buffer so the parser sees one contiguous stream.
   */
  flush(leafId: number): void {
    const p = this.pending.get(leafId);
    if (!p) return;
    if (p.rafHandle !== null) {
      this.clock.cancel(p.rafHandle);
      p.rafHandle = null;
    }
    if (p.timerHandle !== null) {
      this.timer.clear(p.timerHandle);
      p.timerHandle = null;
    }
    if (p.chunks.length === 0) {
      this.pending.delete(leafId);
      return;
    }
    const chunks = p.chunks;
    this.pending.delete(leafId);
    let total = 0;
    for (const c of chunks) total += c.length;
    if (chunks.length === 1) {
      p.emulator.write(chunks[0]!);
      return;
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }
    p.emulator.write(merged);
  }

  /**
   * Drop any scheduled work for a leaf without flushing — used when the
   * emulator is being disposed (tab close). The bytes are irrelevant because
   * the buffer they would feed is going away.
   */
  cancel(leafId: number): void {
    const p = this.pending.get(leafId);
    if (!p) return;
    if (p.rafHandle !== null) this.clock.cancel(p.rafHandle);
    if (p.timerHandle !== null) this.timer.clear(p.timerHandle);
    this.pending.delete(leafId);
  }

  /** Test/diagnostic: number of queued chunks for a leaf (0 when idle). */
  pendingCount(leafId: number): number {
    return this.pending.get(leafId)?.chunks.length ?? 0;
  }

  /** Test/diagnostic: queued (un-flushed) bytes for a leaf (0 when idle). */
  pendingBytes(leafId: number): number {
    return this.pending.get(leafId)?.bytes ?? 0;
  }
}
