import {
  emulatorCount,
  forEachEmulator,
  getEmulator,
  getEmulatorAdapter,
  getRecycler,
  grantGl,
  revokeGl,
  type Emulator,
} from "./emulator";
import { grantPolicy, type GlLeafState } from "./glContextPool";

// View attach/detach — the tab/pane switch hot path.
//
// WHY: A switch is a pure VIEW op, not a state rebuild. SHOW = move the leaf's
// persistent host into the visible container (xterm's IntersectionObserver
// fires _handleIntersectionChange -> refreshRows, a full repaint from the
// already-correct live buffer — this is the structural cure for Defect A,
// replacing the deleted SLOT_STALE_MS-gated manual refresh). HIDE = move the
// host back to the offscreen recycler (DOM-detach -> both render layers stop;
// see emulator.getRecycler). No serialize, no clear, no replay.
//
// WHEN: attachView on bind/visible; detachView on unbind/hidden. recomputeGl()
// runs after any visibility/focus change to re-grant the scarce GPU contexts.
//
// HOW: the buffer is NEVER mutated here. Only host placement, fit/resize, and
// GL grants change.

const FIT_DEBOUNCE_MS = 8;
const PTY_RESIZE_DEBOUNCE_MS = 256;

// Track which leaves are currently visible + which is top, so recomputeGl can
// run the pure grant policy across the whole fleet.
const visibleLeaves = new Set<number>();
const topLeaves = new Set<number>();

/**
 * Recompute WebGL grants across all live emulators using the pure grant policy.
 * Visible+top leaves get GPU first; over-cap or hidden leaves fall back to the
 * DOM renderer (still correct). Called after any attach/detach/focus change.
 */
export function recomputeGl(): void {
  const states: GlLeafState[] = [];
  forEachEmulator((e) => {
    states.push({
      leafId: e.leafId,
      visible: visibleLeaves.has(e.leafId),
      isTop: topLeaves.has(e.leafId),
    });
  });
  const granted = grantPolicy(states);
  forEachEmulator((e) => {
    if (granted.has(e.leafId)) grantGl(e);
    else revokeGl(e);
  });
}

/**
 * Attach a leaf's persistent host into the visible container and fit it. Marks
 * the leaf visible/top so it is eligible for a GPU grant. Sets up the
 * ResizeObserver -> fit -> debounced PTY resize chain.
 */
export function attachView(
  leafId: number,
  container: HTMLDivElement,
  cols: number,
  rows: number,
  focused: boolean,
): void {
  const emu = getEmulator(leafId);
  if (!emu) return;
  emu.container = container;
  visibleLeaves.add(leafId);
  if (focused) topLeaves.add(leafId);
  else topLeaves.delete(leafId);

  if (emu.host.parentNode !== container) {
    container.appendChild(emu.host);
  }

  // Adopt the caller's known PTY dims as a pre-fit hint to avoid a one-frame
  // size flash, then fit() to the real container — fit() is authoritative and
  // reflows the LIVE buffer (no rebuild). This mirrors the old bindSlot resize.
  if (
    cols > 0 &&
    rows > 0 &&
    (emu.term.cols !== cols || emu.term.rows !== rows)
  ) {
    try {
      emu.term.resize(cols, rows);
    } catch {}
  }

  setupResizeObserver(emu, container);
  emu.fitAddon.fit();
  emu.lastCols = emu.term.cols;
  emu.lastRows = emu.term.rows;
  emu.lastW = container.clientWidth;
  emu.lastH = container.clientHeight;
  if (emu.lastCols !== cols || emu.lastRows !== rows) {
    getEmulatorAdapter()
      ?.resolveLeaf(leafId)
      ?.resizePty(emu.lastCols, emu.lastRows);
  }

  recomputeGl();
}

/**
 * Detach a leaf's host back to the offscreen recycler (DOM-detach => render
 * stops at both layers while the buffer stays current). Marks the leaf hidden
 * and recomputes GL grants. The emulator and its buffer are UNTOUCHED.
 */
export function detachView(leafId: number): void {
  const emu = getEmulator(leafId);
  if (!emu) return;
  visibleLeaves.delete(leafId);
  topLeaves.delete(leafId);

  emu.observer?.disconnect();
  emu.observer = null;
  if (emu.fitTimer) clearTimeout(emu.fitTimer);
  if (emu.ptyTimer) clearTimeout(emu.ptyTimer);
  emu.fitTimer = null;
  emu.ptyTimer = null;
  emu.container = null;

  const recycler = getRecycler();
  if (emu.host.parentNode !== recycler) {
    recycler.appendChild(emu.host);
  }
  recomputeGl();
}

/**
 * Mark which visible leaf is focused (top) and recompute GPU grants so the
 * focused pane is prioritized for the scarce contexts.
 */
export function setTopLeaf(leafId: number, isTop: boolean): void {
  if (!visibleLeaves.has(leafId)) {
    topLeaves.delete(leafId);
    return;
  }
  if (isTop) topLeaves.add(leafId);
  else topLeaves.delete(leafId);
  recomputeGl();
}

export function isViewVisible(leafId: number): boolean {
  return visibleLeaves.has(leafId);
}

export function clearViewState(leafId: number): void {
  visibleLeaves.delete(leafId);
  topLeaves.delete(leafId);
}

function setupResizeObserver(emu: Emulator, container: HTMLDivElement): void {
  emu.observer?.disconnect();
  if (emu.fitTimer) clearTimeout(emu.fitTimer);
  if (emu.ptyTimer) clearTimeout(emu.ptyTimer);
  emu.fitTimer = null;
  emu.ptyTimer = null;

  const flushPty = () => {
    emu.ptyTimer = null;
    if (emu.term.cols === emu.lastCols && emu.term.rows === emu.lastRows)
      return;
    emu.lastCols = emu.term.cols;
    emu.lastRows = emu.term.rows;
    getEmulatorAdapter()
      ?.resolveLeaf(emu.leafId)
      ?.resizePty(emu.lastCols, emu.lastRows);
  };

  emu.observer = new ResizeObserver(() => {
    if (emu.fitTimer) clearTimeout(emu.fitTimer);
    emu.fitTimer = setTimeout(() => {
      emu.fitTimer = null;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === emu.lastW && h === emu.lastH) return;
      emu.lastW = w;
      emu.lastH = h;
      emu.fitAddon.fit();
      if (emu.ptyTimer) clearTimeout(emu.ptyTimer);
      emu.ptyTimer = setTimeout(flushPty, PTY_RESIZE_DEBOUNCE_MS);
    }, FIT_DEBOUNCE_MS);
  });
  emu.observer.observe(container);
}

export function liveLeafCount(): number {
  return emulatorCount();
}
