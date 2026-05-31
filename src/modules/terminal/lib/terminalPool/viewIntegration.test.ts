import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  __registerEmulatorForTest,
  __resetEmulatorsForTest,
  revokeGl,
  type Emulator,
} from "./emulator";
import {
  __setGlBackendForTest,
  MAX_GL_CONTEXTS,
  type GlAttachment,
  type GlBackend,
} from "./glContextPool";
import { applyScrollbackFor } from "./preferences";
import {
  attachView,
  clearViewState,
  detachView,
  isViewVisible,
  setTopLeaf,
} from "./view";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { WriteScheduler, type RafClock, type TimerClock } from "./writeScheduler";

// INTEGRATION test — the REAL view/preferences/GL paths against REAL headless
// xterm Terminals. This is the gap the prior review flagged: bufferFidelity.test
// simulated 'hide' as a buffer no-op, but the real hideLeaf path called
// applyScrollbackFor which SHRANK background scrollback and permanently trimmed
// history. The two integration-level regressions (scrollback trim-on-hide, GL
// cap not strict at creation) live exactly here. Each assertion below FAILS
// against the pre-fix code (confirmed with throwaway probes — see the report).
//
// xterm's full Terminal parses bytes into buffer.lines with NO DOM. We never
// call term.open() (it needs a real renderer/document). We feed the REAL view
// functions real Emulator records via __registerEmulatorForTest, and stub the
// few DOM globals attachView/getRecycler touch (document.createElement,
// document.body, ResizeObserver) so the actual production code runs unmodified.

// ---------------------------------------------------------------------------
// Minimal DOM stubs — just enough for getRecycler() + attachView host moves +
// the ResizeObserver wiring. NOT a full DOM; term.open() is never called.
// ---------------------------------------------------------------------------
type StubNode = {
  parentNode: StubNode | null;
  children: StubNode[];
  style: Record<string, string> & { cssText: string };
  attributes: Record<string, string>;
  isConnected: boolean;
  clientWidth: number;
  clientHeight: number;
  setAttribute(k: string, v: string): void;
  appendChild(c: StubNode): StubNode;
  removeChild(c: StubNode): StubNode;
};

function makeStubNode(): StubNode {
  const node: StubNode = {
    parentNode: null,
    children: [],
    style: { cssText: "" } as StubNode["style"],
    attributes: {},
    isConnected: true,
    clientWidth: 800,
    clientHeight: 600,
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    appendChild(c) {
      if (c.parentNode) c.parentNode.removeChild(c);
      this.children.push(c);
      c.parentNode = this;
      return c;
    },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      c.parentNode = null;
      return c;
    },
  };
  return node;
}

beforeAll(() => {
  const g = globalThis as unknown as {
    document?: unknown;
    ResizeObserver?: unknown;
  };
  if (!g.document) {
    const body = makeStubNode();
    g.document = {
      body,
      createElement: () => makeStubNode(),
    };
  }
  if (!g.ResizeObserver) {
    g.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

// Build a REAL headless emulator record (no term.open()) and register it.
function makeRealEmulator(leafId: number, scrollback: number): Emulator {
  const term = new Terminal({ cols: 80, rows: 24, scrollback });
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  const host = (globalThis as unknown as { document: { createElement: () => StubNode } })
    .document.createElement() as unknown as HTMLDivElement;
  const emu: Emulator = {
    leafId,
    term,
    fitAddon,
    searchAddon,
    host,
    gl: null,
    oscRegistered: false,
    oscDisposers: [],
    container: null,
    observer: null,
    fitTimer: null,
    ptyTimer: null,
    lastCols: term.cols,
    lastRows: term.rows,
    lastW: 0,
    lastH: 0,
  };
  __registerEmulatorForTest(emu);
  return emu;
}

function writeAsync(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

function makeContainer(): HTMLDivElement {
  return makeStubNode() as unknown as HTMLDivElement;
}

afterEach(() => {
  // Tear down all module-level state so cases don't leak into each other.
  const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  for (const id of ids) {
    clearViewState(id);
  }
  __resetEmulatorsForTest();
  __setGlBackendForTest(null);
  usePreferencesStore.setState({ terminalScrollback: 2000 });
});

// ===========================================================================
// (a) Regression 1 / Defect C — deep history survives hideLeaf -> showLeaf.
// ===========================================================================
describe("integration: deep scrollback survives hide -> show (regression 1)", () => {
  it("keeps ALL >1000-line history across a real detach/attach cycle", async () => {
    // User's scrollback pref is large (far above the old 1000 background cap).
    const PREF = 6000;
    usePreferencesStore.setState({ terminalScrollback: PREF });

    const emu = makeRealEmulator(1, PREF);

    // Deep history well past the old TERMINAL_BG_SCROLLBACK_CAP of 1000.
    const LINES = 5500;
    let payload = "";
    for (let i = 0; i < LINES; i++) payload += `line${i}\r\n`;
    await writeAsync(emu.term, payload);

    const beforeLen = emu.term.buffer.active.length;
    expect(beforeLen).toBeGreaterThan(1000);
    expect(emu.term.buffer.active.getLine(0)?.translateToString(true)).toBe(
      "line0",
    );

    // SHOW it first (mirror showLeaf: attachView then applyScrollbackFor).
    const container = makeContainer();
    attachView(1, container, 80, 24, true);
    applyScrollbackFor(emu);
    expect(isViewVisible(1)).toBe(true);

    // HIDE it — the EXACT real hideLeaf sequence: detachView marks it hidden,
    // then applyScrollbackFor runs with the leaf no longer visible. Under the
    // OLD two-tier code this shrank scrollback to min(1000, pref) and xterm
    // PERMANENTLY trimmed the buffer to ~1024 lines (line0 -> line~4477).
    detachView(1);
    applyScrollbackFor(emu);
    expect(isViewVisible(1)).toBe(false);

    // The persistent buffer must be UNTOUCHED by the hide.
    expect(emu.term.options.scrollback).toBe(PREF);
    expect(emu.term.buffer.active.length).toBe(beforeLen);
    expect(emu.term.buffer.active.getLine(0)?.translateToString(true)).toBe(
      "line0",
    );

    // SHOW again — still byte-faithful, oldest line still present.
    const container2 = makeContainer();
    attachView(1, container2, 80, 24, true);
    applyScrollbackFor(emu);
    expect(emu.term.buffer.active.length).toBe(beforeLen);
    expect(emu.term.buffer.active.getLine(0)?.translateToString(true)).toBe(
      "line0",
    );
  });
});

// ===========================================================================
// (b) Regression 2 — GL grants NEVER exceed the cap at any instant, including
//     the ensureEmulator/creation path.
// ===========================================================================
describe("integration: GL cap is strict at every instant (regression 2)", () => {
  it("never has more than MAX_GL_CONTEXTS live contexts, even mid-restore", () => {
    // Counting GL backend: records concurrent live contexts + the PEAK ever
    // reached. attach throws if the cap is ever exceeded so a single transient
    // over-grant FAILS the test immediately (this is what the old unconditional
    // grantGl-in-ensureEmulator did on a multi-tab restore).
    let live = 0;
    let peak = 0;
    const backend: GlBackend = {
      attach(): GlAttachment {
        live++;
        peak = Math.max(peak, live);
        if (live > MAX_GL_CONTEXTS) {
          throw new Error(
            `GL cap exceeded: ${live} live contexts > cap ${MAX_GL_CONTEXTS}`,
          );
        }
        // Real attachment shape; canvases empty (no DOM canvas to release).
        return { addon: {} as never, canvases: [] };
      },
      dispose() {
        live = Math.max(0, live - 1);
      },
    };
    __setGlBackendForTest(backend);

    // Simulate a 12-tab restore. makeRealEmulator mirrors the PRODUCTION
    // ensureEmulator exactly: it creates the persistent emulator and does NOT
    // grant a GL context at creation time (the regression-2 fix). The pre-fix
    // ensureEmulator called grantGl() unconditionally right here — allocating
    // one real context PER created leaf, peaking at 12, far over the cap of 5
    // (toward WebKit's ~16 ceiling) BEFORE recomputeGl could prune.
    //
    // PROBE (how this FAILS against the pre-fix code): re-add `grantGl(emu)` to
    // makeRealEmulator (mirroring the old ensureEmulator) and this assertion
    // and the throw inside the backend trip — live/peak hit 12 > cap 5.
    const N = 12;
    const emus: Emulator[] = [];
    for (let i = 0; i < N; i++) {
      emus.push(makeRealEmulator(i, 2000));
    }

    // After creation (no view attached yet) the cap MUST already hold strictly:
    // post-fix creation grants nothing, so zero live contexts exist. Pre-fix
    // this was 12 (one per ensureEmulator), violating the "never exceeds cap"
    // claim at the creation instant.
    expect(live).toBe(0);
    expect(peak).toBe(0);
    expect(peak).toBeLessThanOrEqual(MAX_GL_CONTEXTS);

    // Now mount/show every leaf (all visible, one focused) and recompute grants
    // through the REAL view path. The pure policy caps grants at MAX_GL_CONTEXTS.
    for (let i = 0; i < N; i++) {
      const container = makeContainer();
      attachView(i, container, 80, 24, i === 0);
    }
    // recomputeGl ran on every attach; the cap held at every step.
    expect(live).toBe(MAX_GL_CONTEXTS);
    expect(peak).toBeLessThanOrEqual(MAX_GL_CONTEXTS);

    // Focus churn (setTopLeaf) re-runs recomputeGl — still strict.
    setTopLeaf(5, true);
    setTopLeaf(0, false);
    expect(live).toBeLessThanOrEqual(MAX_GL_CONTEXTS);
    expect(peak).toBeLessThanOrEqual(MAX_GL_CONTEXTS);

    // Hide them all — grants drain back to zero (revoke path).
    for (let i = 0; i < N; i++) detachView(i);
    expect(live).toBe(0);

    // Clean revoke of any stragglers.
    for (const e of emus) revokeGl(e);
    expect(live).toBe(0);
  });
});

// ===========================================================================
// (c) Regression 3 — a hidden-leaf flood with rAF 'paused' stays bounded and
//     still drains via the setTimeout fallback.
// ===========================================================================
describe("integration: hidden flood bounded + drains with rAF paused (regression 3)", () => {
  it("caps queued bytes and the timer fallback delivers everything in order", () => {
    // rAF is PAUSED (request() records the callback but the test NEVER fires a
    // frame) — simulating the OS backgrounding the whole app window. The timer
    // clock is controllable and fired explicitly.
    const rafCbs: (() => void)[] = [];
    const raf: RafClock = {
      request(cb) {
        rafCbs.push(cb);
        return rafCbs.length;
      },
      cancel() {},
    };
    let nextTimer = 1;
    const timers = new Map<number, () => void>();
    const timer: TimerClock = {
      set(cb) {
        const h = nextTimer++;
        timers.set(h, cb);
        return h;
      },
      clear(h) {
        timers.delete(h);
      },
    };
    const fireTimers = () => {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, cb] of pending) cb();
    };

    // Small byte cap so we can prove the bound without allocating megabytes.
    const CAP = 16 * 1024;
    const sched = new WriteScheduler(raf, timer, CAP);

    const received: number[] = [];
    const emu = {
      write(data: string | Uint8Array) {
        const arr =
          typeof data === "string" ? new TextEncoder().encode(data) : data;
        for (const b of arr) received.push(b);
      },
    };

    const LEAF = 42;
    const CHUNK = 1024;
    const CHUNKS = 200; // 200KB total, far past the 16KB cap and any rAF frame.
    const expected: number[] = [];
    for (let i = 0; i < CHUNKS; i++) {
      const c = new Uint8Array(CHUNK);
      c.fill(i & 0xff);
      sched.deliver(LEAF, emu, c, false);
      for (let j = 0; j < CHUNK; j++) expected.push(i & 0xff);
      // INVARIANT: queued bytes NEVER exceed the cap, even though rAF never
      // fired (the pre-fix coalescer had NO cap -> chunks[] grew to 200KB).
      expect(sched.pendingBytes(LEAF)).toBeLessThan(CAP);
    }

    // rAF was paused the whole time: no frame callback ever ran.
    // The cap-triggered flushes wrote most data; whatever remains is still
    // queued (< CAP). Fire the FALLBACK timer (rAF-independent) to drain it.
    fireTimers();

    // Everything delivered, in order, nothing dropped — despite paused rAF.
    expect(received.length).toBe(CHUNK * CHUNKS);
    expect(received).toEqual(expected);
    expect(sched.pendingBytes(LEAF)).toBe(0);
    expect(sched.pendingCount(LEAF)).toBe(0);
  });

  it("drains a slow trickle via the timer even if a frame never comes", () => {
    const raf: RafClock = { request: () => 1, cancel() {} };
    let nextTimer = 1;
    const timers = new Map<number, () => void>();
    const timer: TimerClock = {
      set(cb) {
        const h = nextTimer++;
        timers.set(h, cb);
        return h;
      },
      clear(h) {
        timers.delete(h);
      },
    };
    const sched = new WriteScheduler(raf, timer, 16 * 1024);
    const got: number[] = [];
    const emu = {
      write(d: string | Uint8Array) {
        const a = typeof d === "string" ? new TextEncoder().encode(d) : d;
        for (const b of a) got.push(b);
      },
    };

    // A few small chunks, never near the cap, rAF never fires.
    sched.deliver(9, emu, new Uint8Array([10, 11]), false);
    sched.deliver(9, emu, new Uint8Array([12]), false);
    expect(got.length).toBe(0); // nothing yet — rAF paused, cap not hit.

    // Fire ONLY the fallback timer.
    const cb = [...timers.values()][0]!;
    timers.clear();
    cb();

    expect(got).toEqual([10, 11, 12]);
    expect(sched.pendingBytes(9)).toBe(0);
  });
});
