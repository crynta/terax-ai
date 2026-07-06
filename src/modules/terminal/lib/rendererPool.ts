import { resolveFontFamily } from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { buildTerminalTheme } from "@/styles/terminalTheme";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { type FontWeight, Terminal } from "@xterm/xterm";
import { shouldCursorBlink } from "./cursorBlink";
import {
  terminalDeleteSequence,
  terminalLineNavigationSequence,
  terminalWordNavigationSequence,
} from "./keymap";
import {
  readTerminalClipboard,
  writeTerminalClipboard,
} from "./terminalClipboard";

export const POOL_MAX_SIZE = 5;
const FIT_DEBOUNCE_MS = 8;
const PTY_RESIZE_DEBOUNCE_MS = 256;
const SNAPSHOT_SCROLLBACK_CAP = 5_000;

export type SlotAdapter = {
  resolveLeaf(leafId: number): LeafBridge | null;
  evictLeaf(leafId: number): void;
  isLeafFocused(leafId: number): boolean;
  isLeafBlocks(leafId: number): boolean;
  isLeafBusy(leafId: number): boolean;
  isLeafVisible(leafId: number): boolean;
  storeSnapshot(leafId: number, out: SerializeOutput): void;
};

export type LeafBridge = {
  writeToPty(data: string): void;
  resizePty(cols: number, rows: number): void;
  // Force a SIGWINCH on the underlying PTY at the given dims. Implemented
  // as a +1 row / restore bump because the Linux kernel suppresses winsize
  // ioctls that don't actually change the size. Used to make alt-screen
  // TUIs repaint from scratch after they were dormant.
  kickPty(cols: number, rows: number): void;
};

export type Slot = {
  readonly id: number;
  readonly term: Terminal;
  readonly fitAddon: FitAddon;
  readonly searchAddon: SearchAddon;
  readonly serializeAddon: SerializeAddon;
  readonly host: HTMLDivElement;
  webglAddon: WebglAddon | null;
  webglCanvases: HTMLCanvasElement[];
  currentLeafId: number | null;
  // Leaf whose buffer this slot still holds intact after release; serialized
  // only if another leaf steals the slot.
  retainedLeafId: number | null;
  parked: boolean;
  oscDisposers: (() => void)[];
  observer: ResizeObserver | null;
  fitTimer: ReturnType<typeof setTimeout> | null;
  ptyTimer: ReturnType<typeof setTimeout> | null;
  webglReapTimer: ReturnType<typeof setTimeout> | null;
  slotReapTimer: ReturnType<typeof setTimeout> | null;
  unhideRaf: number | null;
  lastCols: number;
  lastRows: number;
  lastW: number;
  lastH: number;
  lastUsedAt: number;
};

const slots: Slot[] = [];
let recyclerEl: HTMLDivElement | null = null;
let adapter: SlotAdapter | null = null;

let windowActive =
  typeof document === "undefined" || (!document.hidden && document.hasFocus());
let windowActivityBound = false;
let cursorBlinkEnabled = false;
// Per-leaf overrides from shell tools (nvim etc.); win over the global pref.
const cursorBlinkOverrides = new Map<number, boolean>();

export type LeafFontOverride = {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
};
const fontOverrides = new Map<number, LeafFontOverride>();

export type PaddingSides = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

let terminalPadding: PaddingSides = { top: 0, right: 0, bottom: 0, left: 0 };
const paddingOverrides = new Map<number, PaddingSides>();

// Classic-terminal ghost suggestions hook into the slot's single custom key
// handler through this registry (xterm allows only one such handler).
const classicKeyHooks = new Map<number, (ev: KeyboardEvent) => boolean>();

// Multi-SSH input broadcast: leaf → all leaves (incl. itself) that should
// receive its keystrokes. Maintained by App per tab.
const broadcastGroups = new Map<number, number[]>();

export function setBroadcastGroup(leaves: number[], enabled: boolean): void {
  for (const id of leaves) {
    if (enabled) broadcastGroups.set(id, leaves);
    else broadcastGroups.delete(id);
  }
}

export function setClassicKeyHook(
  leafId: number,
  hook: ((ev: KeyboardEvent) => boolean) | null,
): void {
  if (hook) classicKeyHooks.set(leafId, hook);
  else classicKeyHooks.delete(leafId);
}

/** Positive padding goes on the leaf's container (the slot host fills its
 *  content box); negative padding is emulated by growing the host past the
 *  container with negative margins, clipping the terminal's edges. Either
 *  way the fit addon picks the change up via its ResizeObserver. */
function applyPaddingOnSlot(slot: Slot): void {
  const leafId = slot.currentLeafId;
  if (leafId === null) return;
  const container = slot.host.parentElement;
  if (!container || container.hasAttribute("data-terax-recycler")) return;
  const p: PaddingSides = paddingOverrides.get(leafId) ?? terminalPadding;

  const pos = (v: number) => (v > 0 ? v : 0);
  const hasPositive =
    pos(p.top) || pos(p.right) || pos(p.bottom) || pos(p.left);
  const pad = hasPositive
    ? `${pos(p.top)}px ${pos(p.right)}px ${pos(p.bottom)}px ${pos(p.left)}px`
    : "";
  if (container.style.padding !== pad) container.style.padding = pad;

  const neg = (v: number) => (v < 0 ? v : 0);
  const negX = -(neg(p.left) + neg(p.right));
  const negY = -(neg(p.top) + neg(p.bottom));
  if (negX > 0 || negY > 0) {
    if (container.style.overflow !== "hidden") {
      container.style.overflow = "hidden";
    }
    slot.host.style.margin = `${neg(p.top)}px ${neg(p.right)}px ${neg(p.bottom)}px ${neg(p.left)}px`;
    slot.host.style.width = negX > 0 ? `calc(100% + ${negX}px)` : "100%";
    slot.host.style.height = negY > 0 ? `calc(100% + ${negY}px)` : "100%";
  } else if (slot.host.style.margin !== "") {
    slot.host.style.margin = "";
    slot.host.style.width = "100%";
    slot.host.style.height = "100%";
  }
}

export function applyTerminalPadding(padding: PaddingSides): void {
  terminalPadding = padding;
  for (const slot of slots) applyPaddingOnSlot(slot);
}

/** Shell-tool padding override for one leaf; null restores the global pref. */
export function setLeafPaddingOverride(
  leafId: number,
  padding: PaddingSides | null,
): void {
  if (padding === null) paddingOverrides.delete(leafId);
  else paddingOverrides.set(leafId, padding);
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (slot) applyPaddingOnSlot(slot);
}

function bindWindowActivityListeners(): void {
  if (windowActivityBound || typeof window === "undefined") return;
  windowActivityBound = true;
  const sync = () => setWindowActive(!document.hidden && document.hasFocus());
  window.addEventListener("focus", sync);
  window.addEventListener("blur", sync);
  document.addEventListener("visibilitychange", sync);
}

function setWindowActive(active: boolean): void {
  if (windowActive === active) return;
  windowActive = active;
  for (const slot of slots) {
    if (slot.currentLeafId === null) continue;
    applyCursorBlinkOnSlot(
      slot,
      adapter?.isLeafFocused(slot.currentLeafId) ?? false,
    );
  }
}

export function configureRendererPool(a: SlotAdapter): void {
  adapter = a;
  bindWindowActivityListeners();
}

export function forEachSlot(fn: (slot: Slot) => void): void {
  for (const s of slots) fn(s);
}

export function poolSize(): number {
  return slots.length;
}

export type PoolSlotStat = {
  id: number;
  leafId: number | null;
  retainedLeafId: number | null;
  parked: boolean;
  cols: number;
  rows: number;
  bufferLines: number;
  webgl: boolean;
  canvases: number;
};

export function poolSlotStats(): PoolSlotStat[] {
  return slots.map((s) => ({
    id: s.id,
    leafId: s.currentLeafId,
    retainedLeafId: s.retainedLeafId,
    parked: s.parked,
    cols: s.term.cols,
    rows: s.term.rows,
    bufferLines: s.term.buffer.active.length,
    webgl: !!s.webglAddon,
    canvases: s.webglCanvases.length,
  }));
}

// Bracketed paste via xterm, so an app that enabled it (Claude Code) treats a
// dropped path as a real paste while a plain shell gets the literal text.
export function pasteIntoLeaf(leafId: number, text: string): boolean {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (!slot) return false;
  slot.term.paste(text);
  return true;
}

function getRecycler(): HTMLDivElement {
  if (recyclerEl?.isConnected) return recyclerEl;
  const el = document.createElement("div");
  el.setAttribute("data-terax-recycler", "");
  el.style.cssText =
    "position:fixed;left:-99999px;top:-99999px;width:1024px;height:768px;overflow:hidden;pointer-events:none;contain:strict;";
  document.body.appendChild(el);
  recyclerEl = el;
  return el;
}

const MCR_BG_ACTIVE = 4.5;
const MCR_BG_INACTIVE = 1;

function bgActive(
  prefs: ReturnType<typeof usePreferencesStore.getState>,
): boolean {
  return prefs.backgroundKind === "image" && !!prefs.backgroundImageId;
}

function termOptions() {
  const prefs = usePreferencesStore.getState();
  return {
    fontFamily: resolveFontFamily(prefs.terminalFontFamily),
    fontWeight: prefs.terminalFontWeight as FontWeight,
    letterSpacing: prefs.terminalLetterSpacing,
    fontSize: Math.max(4, Math.round(prefs.terminalFontSize * prefs.zoomLevel)),
    theme: buildTerminalTheme(),
    cursorBlink: false,
    cursorStyle: "bar" as const,
    cursorInactiveStyle: "outline" as const,
    scrollback: prefs.terminalScrollback,
    allowProposedApi: true,
    minimumContrastRatio: bgActive(prefs) ? MCR_BG_ACTIVE : MCR_BG_INACTIVE,
  };
}

export function applyBackgroundActive(active: boolean): void {
  const value = active ? MCR_BG_ACTIVE : MCR_BG_INACTIVE;
  for (const slot of slots) {
    if (slot.term.options.minimumContrastRatio === value) continue;
    slot.term.options.minimumContrastRatio = value;
  }
}

function createSlot(): Slot {
  const term = new Terminal(termOptions());
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const serializeAddon = new SerializeAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(serializeAddon);
  term.loadAddon(
    new WebLinksAddon((_e, uri) => openUrl(uri).catch(console.error)),
  );

  const host = document.createElement("div");
  host.style.cssText = "width:100%;height:100%;";
  host.setAttribute("data-terax-slot", String(slots.length));
  getRecycler().appendChild(host);
  term.open(host);

  const slot: Slot = {
    id: slots.length,
    term,
    fitAddon,
    searchAddon,
    serializeAddon,
    host,
    webglAddon: null,
    webglCanvases: [],
    currentLeafId: null,
    retainedLeafId: null,
    parked: false,
    oscDisposers: [],
    observer: null,
    fitTimer: null,
    ptyTimer: null,
    webglReapTimer: null,
    slotReapTimer: null,
    unhideRaf: null,
    lastCols: term.cols,
    lastRows: term.rows,
    lastW: 0,
    lastH: 0,
    lastUsedAt: 0,
  };

  term.attachCustomKeyEventHandler((event) => {
    // During IME composition the browser is assembling a multi-keystroke
    // character (Chinese pinyin → hanzi, Korean jamo → syllable, etc.).
    // Raw keydown events — including the Enter that commits a candidate —
    // must NOT be forwarded to the PTY; xterm will receive the final
    // composed string through its own compositionend handler instead.
    // keyCode 229 ("Process") is what Chromium reports for every key
    // pressed inside an active IME session when isComposing is not yet set.
    if (event.isComposing || event.keyCode === 229) return false;

    const leafId = slot.currentLeafId;
    if (leafId === null) return false;
    // Ghost-suggestion accept/dismiss gets first pick (classic tabs only).
    const ghostHook = classicKeyHooks.get(leafId);
    if (ghostHook && event.type === "keydown" && ghostHook(event)) {
      event.preventDefault();
      return false;
    }
    const bridge = adapter?.resolveLeaf(leafId);
    if (!bridge) return true;
    const lineNavigation = terminalLineNavigationSequence(event, {
      isMac: IS_MAC,
    });
    if (lineNavigation) {
      event.preventDefault();
      if (event.type === "keydown") bridge.writeToPty(lineNavigation);
      return false;
    }
    const wordNavigation = terminalWordNavigationSequence(event);
    if (wordNavigation) {
      event.preventDefault();
      if (event.type === "keydown") bridge.writeToPty(wordNavigation);
      return false;
    }
    const deleteSeq = terminalDeleteSequence(event, { isMac: IS_MAC });
    if (deleteSeq) {
      event.preventDefault();
      if (event.type === "keydown") bridge.writeToPty(deleteSeq);
      return false;
    }
    if (isShiftEnter(event)) {
      event.preventDefault();
      if (event.type === "keydown") bridge.writeToPty("\x1b\r");
      return false;
    }
    if (isTerminalCopy(event)) {
      if (event.type === "keydown" && slot.term.hasSelection()) {
        const sel = slot.term.getSelection();
        if (sel) void writeTerminalClipboard(sel);
      }
      event.preventDefault();
      return false;
    }
    if (isTerminalPaste(event)) {
      if (event.type === "keydown") {
        const targetLeafId = slot.currentLeafId;
        void readTerminalClipboard().then((text) => {
          if (text && slot.currentLeafId === targetLeafId)
            slot.term.paste(text);
        });
      }
      event.preventDefault();
      return false;
    }
    return true;
  });

  term.onData((data) => {
    const leafId = slot.currentLeafId;
    if (leafId === null) return;
    // Broadcast group (multi-SSH): mirror keystrokes to every sibling pane.
    const group = broadcastGroups.get(leafId);
    if (group) {
      for (const sibling of group) {
        adapter?.resolveLeaf(sibling)?.writeToPty(data);
      }
      return;
    }
    adapter?.resolveLeaf(leafId)?.writeToPty(data);
  });

  slots.push(slot);
  return slot;
}

type PickResult = { slot: Slot; previousLeafId: number | null };

function isAltScreen(s: Slot): boolean {
  try {
    return s.term.buffer.active.type === "alternate";
  } catch {
    return false;
  }
}

function evictionScore(s: Slot): number {
  const leafId = s.currentLeafId;
  const visible = leafId !== null && (adapter?.isLeafVisible(leafId) ?? false);
  const busy = leafId !== null && (adapter?.isLeafBusy(leafId) ?? false);
  const blocks = leafId !== null && (adapter?.isLeafBlocks(leafId) ?? false);
  const focused = leafId !== null && (adapter?.isLeafFocused(leafId) ?? false);
  return (
    (visible ? 1000 : 0) +
    (isAltScreen(s) ? 100 : 0) +
    (busy ? 80 : 0) +
    (blocks ? 50 : 0) +
    (focused ? 10 : 0) +
    s.lastUsedAt / 1e12
  );
}

function pickSlotFor(leafId: number): PickResult {
  const retainedOwn = slots.find(
    (s) => s.currentLeafId === null && s.retainedLeafId === leafId,
  );
  if (retainedOwn) return { slot: retainedOwn, previousLeafId: null };

  const clean = slots.find(
    (s) => s.currentLeafId === null && s.retainedLeafId === null,
  );
  if (clean) return { slot: clean, previousLeafId: null };
  if (slots.length < POOL_MAX_SIZE)
    return { slot: createSlot(), previousLeafId: null };

  // Retained buffers are cheaper to lose than bound ones: serialize, no evict.
  let retained: Slot | null = null;
  for (const s of slots) {
    if (s.currentLeafId !== null) continue;
    if (!retained || s.lastUsedAt < retained.lastUsedAt) retained = s;
  }
  if (retained) return { slot: retained, previousLeafId: null };

  let best: Slot | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const s of slots) {
    if (s.currentLeafId === leafId) return { slot: s, previousLeafId: null };
    const score = evictionScore(s);
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  const chosen = best!;
  return { slot: chosen, previousLeafId: chosen.currentLeafId };
}

export type AcquireParams = {
  leafId: number;
  container: HTMLDivElement;
  snapshot: string | null;
  // True if the slot was in alt-screen mode (TUI like vim, htop, dofek)
  // at the time it was released. When set, bindSlot skips ring replay
  // and kicks SIGWINCH so the TUI repaints from scratch.
  altScreen: boolean;
  drainRing: (write: (bytes: Uint8Array) => void) => void;
  shellExited: boolean;
  searchQuery: string | null;
  cols: number;
  rows: number;
  registerOsc: (term: Terminal) => (() => void)[];
  onSearchReady: (addon: SearchAddon) => void;
};

export function acquireSlot(params: AcquireParams): Slot {
  const existing = slots.find((s) => s.currentLeafId === params.leafId);
  if (existing) {
    rewireSlot(existing, params);
    return existing;
  }

  const pick = pickSlotFor(params.leafId);
  if (pick.previousLeafId !== null) {
    adapter?.evictLeaf(pick.previousLeafId);
  }
  if (
    pick.slot.currentLeafId !== null &&
    pick.slot.currentLeafId !== params.leafId
  ) {
    detachSlotFromLeaf(pick.slot, false);
  }
  if (
    pick.slot.retainedLeafId !== null &&
    pick.slot.retainedLeafId !== params.leafId
  ) {
    adapter?.storeSnapshot(pick.slot.retainedLeafId, serializeSlot(pick.slot));
    discardRetention(pick.slot);
  }
  bindSlot(pick.slot, params);
  return pick.slot;
}

function discardRetention(slot: Slot): void {
  slot.retainedLeafId = null;
  for (const d of slot.oscDisposers) {
    try {
      d();
    } catch {}
  }
  slot.oscDisposers = [];
}

function bindSlot(slot: Slot, p: AcquireParams): void {
  const fast = slot.retainedLeafId === p.leafId;
  const stale =
    !slot.webglAddon ||
    slot.parked ||
    performance.now() - slot.lastUsedAt > SLOT_STALE_MS;
  const hadWebgl = !!slot.webglAddon;
  slot.retainedLeafId = null;
  slot.currentLeafId = p.leafId;
  slot.lastUsedAt = performance.now();

  cancelPendingUnhide(slot);
  cancelWebglReap(slot);
  cancelSlotReap(slot);
  unparkSlotHost(slot);
  if (!fast) {
    slot.host.style.visibility = "hidden";
    if (hadWebgl) disposeSlotWebgl(slot);
  }

  if (slot.host.parentNode !== p.container) {
    p.container.appendChild(slot.host);
  }

  slot.term.options.disableStdin = p.shellExited;

  if (!fast) {
    slot.term.clear();
    slot.term.reset();

    if (
      p.cols > 0 &&
      p.rows > 0 &&
      (slot.term.cols !== p.cols || slot.term.rows !== p.rows)
    ) {
      slot.term.resize(p.cols, p.rows);
    }

    if (p.snapshot) {
      try {
        slot.term.write(p.snapshot);
      } catch (e) {
        console.warn("[terax] snapshot replay failed:", e);
      }
    }
    if (p.altScreen) {
      // TUI output is incremental cursor-positioned updates that can't be
      // replayed on top of a stale snapshot; the SIGWINCH kick below makes
      // the TUI redraw from scratch instead.
      p.drainRing(() => {});
    } else {
      p.drainRing((bytes) => slot.term.write(bytes));
    }
    try {
      slot.term.write("\x1b[?25h");
    } catch {}

    for (const d of slot.oscDisposers) {
      try {
        d();
      } catch {}
    }
    slot.oscDisposers = p.registerOsc(slot.term);
  } else {
    p.drainRing((bytes) => slot.term.write(bytes));
  }

  setupResizeObserver(slot, p);
  slot.fitAddon.fit();
  slot.lastCols = slot.term.cols;
  slot.lastRows = slot.term.rows;
  slot.lastW = p.container.clientWidth;
  slot.lastH = p.container.clientHeight;
  if (slot.lastCols !== p.cols || slot.lastRows !== p.rows) {
    // resizePty updates session.cols/rows + pty backend; no separate scope call.
    adapter?.resolveLeaf(p.leafId)?.resizePty(slot.lastCols, slot.lastRows);
  }

  if (!fast && p.searchQuery) {
    try {
      slot.searchAddon.findNext(p.searchQuery);
    } catch {}
  }

  applyCursorBlinkOnSlot(slot, adapter?.isLeafFocused(p.leafId) ?? false);
  applyFontOnSlot(slot);
  applyPaddingOnSlot(slot);

  if (!fast && p.altScreen && !p.shellExited) {
    adapter?.resolveLeaf(p.leafId)?.kickPty(slot.term.cols, slot.term.rows);
  }

  if (fast) {
    if (stale) {
      if (!slot.webglAddon) attachWebgl(slot);
      try {
        slot.term.refresh(0, slot.term.rows - 1);
      } catch {}
    }
    if (adapter?.isLeafFocused(p.leafId)) slot.term.focus();
  } else {
    scheduleUnhide(slot, stale || hadWebgl);
  }

  p.onSearchReady(slot.searchAddon);
}

function scheduleUnhide(slot: Slot, stale: boolean): void {
  slot.unhideRaf = requestAnimationFrame(() => {
    slot.unhideRaf = requestAnimationFrame(() => {
      slot.unhideRaf = null;
      slot.host.style.visibility = "";
      if (stale) {
        if (!slot.webglAddon) attachWebgl(slot);
        try {
          slot.term.refresh(0, slot.term.rows - 1);
        } catch {}
      }
      const leafId = slot.currentLeafId;
      if (leafId !== null && adapter?.isLeafFocused(leafId)) {
        slot.term.focus();
      }
    });
  });
}

function cancelPendingUnhide(slot: Slot): void {
  if (slot.unhideRaf !== null) {
    cancelAnimationFrame(slot.unhideRaf);
    slot.unhideRaf = null;
  }
}

function rewireSlot(slot: Slot, p: AcquireParams): void {
  slot.lastUsedAt = performance.now();
  unparkSlotHost(slot);
  if (slot.host.parentNode !== p.container) {
    p.container.appendChild(slot.host);
  }
  applyPaddingOnSlot(slot);
  setupResizeObserver(slot, p);
  slot.fitAddon.fit();
  slot.lastW = p.container.clientWidth;
  slot.lastH = p.container.clientHeight;
  if (slot.term.cols !== p.cols || slot.term.rows !== p.rows) {
    adapter?.resolveLeaf(p.leafId)?.resizePty(slot.term.cols, slot.term.rows);
  }
  slot.lastCols = slot.term.cols;
  slot.lastRows = slot.term.rows;
  p.onSearchReady(slot.searchAddon);
}

function setupResizeObserver(slot: Slot, p: AcquireParams): void {
  slot.observer?.disconnect();
  if (slot.fitTimer) clearTimeout(slot.fitTimer);
  if (slot.ptyTimer) clearTimeout(slot.ptyTimer);
  slot.fitTimer = null;
  slot.ptyTimer = null;

  const container = p.container;
  const flushPty = () => {
    slot.ptyTimer = null;
    if (slot.currentLeafId !== p.leafId) return;
    if (slot.term.cols === slot.lastCols && slot.term.rows === slot.lastRows)
      return;
    slot.lastCols = slot.term.cols;
    slot.lastRows = slot.term.rows;
    adapter?.resolveLeaf(p.leafId)?.resizePty(slot.lastCols, slot.lastRows);
  };

  slot.observer = new ResizeObserver(() => {
    if (slot.parked) return;
    if (slot.fitTimer) clearTimeout(slot.fitTimer);
    slot.fitTimer = setTimeout(() => {
      slot.fitTimer = null;
      if (slot.currentLeafId !== p.leafId || slot.parked) return;
      // Measure the host, not the container: container clientWidth/Height
      // include padding, so padding changes would look size-neutral and
      // skip the refit (and negative-padding growth only resizes the host).
      const w = slot.host.clientWidth;
      const h = slot.host.clientHeight;
      if (w === slot.lastW && h === slot.lastH) return;
      slot.lastW = w;
      slot.lastH = h;
      slot.fitAddon.fit();
      if (slot.ptyTimer) clearTimeout(slot.ptyTimer);
      slot.ptyTimer = setTimeout(flushPty, PTY_RESIZE_DEBOUNCE_MS);
    }, FIT_DEBOUNCE_MS);
  });
  slot.observer.observe(container);
  slot.observer.observe(slot.host);
}

export type SerializeOutput = {
  snapshot: string | null;
  cols: number;
  rows: number;
  altScreen: boolean;
};

export type ReleaseOutput = { cols: number; rows: number };

export function releaseSlot(leafId: number): ReleaseOutput | null {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (!slot) return null;
  detachSlotFromLeaf(slot, true);
  return { cols: slot.term.cols, rows: slot.term.rows };
}

function serializeSlot(slot: Slot): SerializeOutput {
  let snapshot: string | null = null;
  try {
    const cap = Math.min(
      SNAPSHOT_SCROLLBACK_CAP,
      usePreferencesStore.getState().terminalScrollback,
    );
    snapshot = slot.serializeAddon.serialize({ scrollback: cap });
  } catch (e) {
    console.warn("[terax] serialize failed:", e);
  }
  return {
    snapshot,
    cols: slot.term.cols,
    rows: slot.term.rows,
    altScreen: isAltScreen(slot),
  };
}

function detachSlotFromLeaf(slot: Slot, retain: boolean): void {
  if (retain && slot.currentLeafId !== null) {
    slot.retainedLeafId = slot.currentLeafId;
    parkSlotHost(slot);
  } else {
    discardRetention(slot);
    unparkSlotHost(slot);
    if (slot.host.parentNode !== getRecycler()) {
      getRecycler().appendChild(slot.host);
    }
  }

  slot.observer?.disconnect();
  slot.observer = null;
  if (slot.fitTimer) clearTimeout(slot.fitTimer);
  if (slot.ptyTimer) clearTimeout(slot.ptyTimer);
  slot.fitTimer = null;
  slot.ptyTimer = null;

  cancelPendingUnhide(slot);
  slot.host.style.visibility = "";

  slot.currentLeafId = null;
  slot.lastUsedAt = performance.now();
  scheduleWebglReap(slot);
  scheduleSlotReap(slot);
}

// display:none makes xterm's IntersectionObserver pause rendering while the
// buffer keeps parsing writes; visibility:hidden would not (geometry remains).
function parkSlotHost(slot: Slot): void {
  if (slot.parked) return;
  slot.parked = true;
  slot.host.style.display = "none";
}

function unparkSlotHost(slot: Slot): void {
  if (!slot.parked) return;
  slot.parked = false;
  slot.host.style.display = "";
}

function scheduleWebglReap(slot: Slot): void {
  cancelWebglReap(slot);
  if (!slot.webglAddon) return;
  slot.webglReapTimer = setTimeout(() => {
    slot.webglReapTimer = null;
    if (slot.currentLeafId === null || slot.parked) disposeSlotWebgl(slot);
  }, WEBGL_REAP_GRACE_MS);
}

function cancelWebglReap(slot: Slot): void {
  if (slot.webglReapTimer !== null) {
    clearTimeout(slot.webglReapTimer);
    slot.webglReapTimer = null;
  }
}

function scheduleSlotReap(slot: Slot): void {
  cancelSlotReap(slot);
  slot.slotReapTimer = setTimeout(() => {
    slot.slotReapTimer = null;
    reapIdleSlot(slot);
  }, SLOT_REAP_GRACE_MS);
}

function cancelSlotReap(slot: Slot): void {
  if (slot.slotReapTimer !== null) {
    clearTimeout(slot.slotReapTimer);
    slot.slotReapTimer = null;
  }
}

function reapIdleSlot(slot: Slot): void {
  if (slot.currentLeafId !== null) return;
  const idle = slots.filter((s) => s.currentLeafId === null);
  if (idle.length <= IDLE_SLOTS_KEEP_WARM) return;
  idle.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const surplus = idle.slice(0, idle.length - IDLE_SLOTS_KEEP_WARM);
  if (!surplus.includes(slot)) return;
  if (slot.retainedLeafId !== null) {
    adapter?.storeSnapshot(slot.retainedLeafId, serializeSlot(slot));
  }
  disposeSlot(slot);
}

function disposeSlot(slot: Slot): void {
  cancelSlotReap(slot);
  cancelWebglReap(slot);
  cancelPendingUnhide(slot);
  if (slot.fitTimer) clearTimeout(slot.fitTimer);
  if (slot.ptyTimer) clearTimeout(slot.ptyTimer);
  slot.fitTimer = null;
  slot.ptyTimer = null;
  slot.observer?.disconnect();
  slot.observer = null;
  for (const d of slot.oscDisposers) {
    try {
      d();
    } catch {}
  }
  slot.oscDisposers = [];
  disposeSlotWebgl(slot);
  try {
    slot.term.dispose();
  } catch (e) {
    console.warn("[terax] slot dispose failed:", e);
  }
  slot.host.remove();
  const i = slots.indexOf(slot);
  if (i >= 0) slots.splice(i, 1);
}

const WEBGL_RECOVERY_DELAY_MS = 250;
// Below this a re-shown slot is fresh enough to trust; above it, repaint on
// unhide to defeat silent GPU/context staleness.
const SLOT_STALE_MS = 10_000;
const WEBGL_REAP_GRACE_MS = 30_000;
const SLOT_REAP_GRACE_MS = 45_000;
const IDLE_SLOTS_KEEP_WARM = 1;

function attachWebgl(slot: Slot): void {
  if (slot.webglAddon || !slot.term.element) return;
  if (!usePreferencesStore.getState().terminalWebglEnabled) return;
  const elem = slot.term.element;
  const before = new Set<HTMLCanvasElement>(
    elem.querySelectorAll<HTMLCanvasElement>("canvas"),
  );
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      const cur = slot.webglAddon;
      if (cur === webgl) {
        slot.webglAddon = null;
        slot.webglCanvases = [];
      }
      try {
        webgl.dispose();
      } catch {}
      // Recovery: WebKit may transiently lose contexts on sleep/wake or GPU
      // reset; without re-attach the slot would silently fall back to DOM
      // forever. Defer past WebKit's reset window before retrying.
      setTimeout(() => {
        if (slot.webglAddon || slot.currentLeafId === null || slot.parked)
          return;
        if (!usePreferencesStore.getState().terminalWebglEnabled) return;
        attachWebgl(slot);
        if (slot.webglAddon) {
          try {
            slot.term.refresh(0, slot.term.rows - 1);
          } catch {}
        }
      }, WEBGL_RECOVERY_DELAY_MS);
    });
    slot.term.loadAddon(webgl);
    const after = elem.querySelectorAll<HTMLCanvasElement>("canvas");
    const added: HTMLCanvasElement[] = [];
    for (const c of after) if (!before.has(c)) added.push(c);
    slot.webglAddon = webgl;
    slot.webglCanvases = added;
  } catch (e) {
    console.warn("[terax-webgl] unavailable:", e);
  }
}

function disposeSlotWebgl(slot: Slot): void {
  if (!slot.webglAddon) return;
  const addon = slot.webglAddon;
  for (const canvas of slot.webglCanvases) releaseCanvasContext(canvas);
  slot.webglCanvases = [];
  try {
    addon.dispose();
  } catch (e) {
    console.warn("[terax-webgl] dispose failed:", e);
  }
  try {
    const r = (
      addon as unknown as { _renderer?: Record<string, unknown> | null }
    )._renderer;
    if (r) {
      r._canvas = null;
      r._gl = null;
      r._charAtlas = null;
      r._atlas = null;
    }
    (
      addon as unknown as { _renderer?: unknown; _renderService?: unknown }
    )._renderer = null;
    (
      addon as unknown as { _renderer?: unknown; _renderService?: unknown }
    )._renderService = null;
  } catch {}
  slot.webglAddon = null;
}

function releaseCanvasContext(canvas: HTMLCanvasElement): void {
  let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
  } catch {}
  if (!gl) {
    try {
      gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
    } catch {}
  }
  if (gl) {
    try {
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext && !gl.isContextLost()) ext.loseContext();
    } catch {}
  }
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {}
}

export function applyWebglPreference(enabled: boolean): void {
  for (const slot of slots) {
    if (enabled) {
      if (slot.currentLeafId !== null && !slot.parked && !slot.webglAddon) {
        attachWebgl(slot);
        if (slot.webglAddon) {
          try {
            slot.term.refresh(0, slot.term.rows - 1);
          } catch {}
        }
      }
    } else if (slot.webglAddon) {
      cancelWebglReap(slot);
      disposeSlotWebgl(slot);
    }
  }
}

// Parked and retained slots can't be measured (display:none); poison lastW
// so the refit happens on unpark/rebind instead.
function refitSlot(slot: Slot): void {
  if (slot.parked || slot.currentLeafId === null) {
    slot.lastW = -1;
    return;
  }
  slot.fitAddon.fit();
  slot.lastCols = slot.term.cols;
  slot.lastRows = slot.term.rows;
  adapter
    ?.resolveLeaf(slot.currentLeafId)
    ?.resizePty(slot.term.cols, slot.term.rows);
}

function fontOverrideFor(slot: Slot): LeafFontOverride | undefined {
  return slot.currentLeafId !== null
    ? fontOverrides.get(slot.currentLeafId)
    : undefined;
}

/** Effective font (global prefs merged with the leaf's shell-tool override). */
function applyFontOnSlot(slot: Slot): void {
  const prefs = usePreferencesStore.getState();
  const o = fontOverrideFor(slot);
  const size = Math.max(
    4,
    Math.round((o?.fontSize ?? prefs.terminalFontSize) * prefs.zoomLevel),
  );
  const family = resolveFontFamily(o?.fontFamily ?? prefs.terminalFontFamily);
  const weight = (o?.fontWeight ?? prefs.terminalFontWeight) as FontWeight;
  let refit = false;
  if (slot.term.options.fontSize !== size) {
    slot.term.options.fontSize = size;
    refit = true;
  }
  if (slot.term.options.fontFamily !== family) {
    slot.term.options.fontFamily = family;
    refit = true;
  }
  if (slot.term.options.fontWeight !== weight) {
    slot.term.options.fontWeight = weight;
  }
  if (refit) refitSlot(slot);
}

/** Shell-tool font override for one leaf; null restores the global prefs. */
export function setLeafFontOverride(
  leafId: number,
  override: LeafFontOverride | null,
): void {
  const has =
    override &&
    (override.fontSize !== undefined ||
      override.fontFamily !== undefined ||
      override.fontWeight !== undefined);
  if (has) fontOverrides.set(leafId, override);
  else fontOverrides.delete(leafId);
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (slot) applyFontOnSlot(slot);
}

export function applyFontSize(size: number): void {
  for (const slot of slots) {
    if (fontOverrideFor(slot)?.fontSize !== undefined) {
      applyFontOnSlot(slot);
      continue;
    }
    if (slot.term.options.fontSize === size) continue;
    slot.term.options.fontSize = size;
    refitSlot(slot);
  }
}

export function applyLetterSpacing(spacing: number): void {
  for (const slot of slots) {
    if (slot.term.options.letterSpacing === spacing) continue;
    slot.term.options.letterSpacing = spacing;
    refitSlot(slot);
  }
}

export function applyFontFamily(family: string): void {
  const resolved = resolveFontFamily(family);
  for (const slot of slots) {
    if (fontOverrideFor(slot)?.fontFamily !== undefined) {
      applyFontOnSlot(slot);
      continue;
    }
    if (slot.term.options.fontFamily === resolved) continue;
    slot.term.options.fontFamily = resolved;
    refitSlot(slot);
  }
}

export function applyFontWeight(weight: string): void {
  for (const slot of slots) {
    if (fontOverrideFor(slot)?.fontWeight !== undefined) {
      applyFontOnSlot(slot);
      continue;
    }
    if (slot.term.options.fontWeight === weight) continue;
    slot.term.options.fontWeight = weight as FontWeight;
  }
}

export function applyScrollback(value: number): void {
  for (const slot of slots) {
    if (slot.term.options.scrollback === value) continue;
    slot.term.options.scrollback = value;
  }
}

export function applyTheme(): void {
  const theme = buildTerminalTheme();
  for (const slot of slots) {
    slot.term.options.theme = theme;
  }
}

export function focusSlot(leafId: number): void {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  slot?.term.focus();
}

export function setSlotFocused(leafId: number, focused: boolean): void {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (!slot) return;
  applyCursorBlinkOnSlot(slot, focused);
}

export function applyCursorBlink(enabled: boolean): void {
  cursorBlinkEnabled = enabled;
  for (const slot of slots) {
    if (slot.currentLeafId === null) continue;
    applyCursorBlinkOnSlot(
      slot,
      adapter?.isLeafFocused(slot.currentLeafId) ?? false,
    );
  }
}

function applyCursorBlinkOnSlot(slot: Slot, focused: boolean): void {
  const leafId = slot.currentLeafId;
  const base =
    leafId !== null
      ? (cursorBlinkOverrides.get(leafId) ?? cursorBlinkEnabled)
      : cursorBlinkEnabled;
  const desired = shouldCursorBlink(base, windowActive, focused);
  if (slot.term.options.cursorBlink === desired) return;
  slot.term.options.cursorBlink = desired;
}

/** Shell-tool override for one leaf's cursor blink; null restores the pref. */
export function setLeafCursorBlinkOverride(
  leafId: number,
  value: boolean | null,
): void {
  if (value === null) cursorBlinkOverrides.delete(leafId);
  else cursorBlinkOverrides.set(leafId, value);
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (slot) {
    applyCursorBlinkOnSlot(slot, adapter?.isLeafFocused(leafId) ?? false);
  }
}

export function getSlotForLeaf(leafId: number): Slot | null {
  return slots.find((s) => s.currentLeafId === leafId) ?? null;
}

export function isLeafAltScreen(leafId: number): boolean {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  return slot ? isAltScreen(slot) : false;
}

export function parkLeafSlot(leafId: number): void {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (!slot) return;
  parkSlotHost(slot);
  scheduleWebglReap(slot);
}

export function refreshLeafSlot(leafId: number): void {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (!slot) return;
  cancelWebglReap(slot);
  unparkSlotHost(slot);
  if (usePreferencesStore.getState().terminalWebglEnabled && !slot.webglAddon) {
    attachWebgl(slot);
  }
  // The observer skips parked slots; catch up on container resizes here.
  const container = slot.host.parentElement;
  if (
    container &&
    (container.clientWidth !== slot.lastW ||
      container.clientHeight !== slot.lastH)
  ) {
    slot.lastW = container.clientWidth;
    slot.lastH = container.clientHeight;
    slot.fitAddon.fit();
    if (slot.term.cols !== slot.lastCols || slot.term.rows !== slot.lastRows) {
      slot.lastCols = slot.term.cols;
      slot.lastRows = slot.term.rows;
      adapter?.resolveLeaf(leafId)?.resizePty(slot.lastCols, slot.lastRows);
    }
  }
  try {
    slot.term.refresh(0, slot.term.rows - 1);
  } catch {}
}

export function disposeLeafSlot(leafId: number): void {
  const slot = slots.find(
    (s) => s.currentLeafId === leafId || s.retainedLeafId === leafId,
  );
  if (slot) disposeSlot(slot);
}

export function discardRetainedSlot(leafId: number): void {
  const slot = slots.find(
    (s) => s.currentLeafId === null && s.retainedLeafId === leafId,
  );
  if (!slot) return;
  discardRetention(slot);
  slot.term.clear();
  slot.term.reset();
}

export function getLiveSlotForLeaf(leafId: number): Slot | null {
  return (
    slots.find(
      (s) => s.currentLeafId === leafId || s.retainedLeafId === leafId,
    ) ?? null
  );
}

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

function isTerminalCopy(e: KeyboardEvent): boolean {
  return (
    !IS_MAC &&
    e.ctrlKey &&
    e.shiftKey &&
    !e.altKey &&
    !e.metaKey &&
    (e.code === "KeyC" || e.key === "c" || e.key === "C")
  );
}

function isTerminalPaste(e: KeyboardEvent): boolean {
  return (
    !IS_MAC &&
    e.ctrlKey &&
    e.shiftKey &&
    !e.altKey &&
    !e.metaKey &&
    (e.code === "KeyV" || e.key === "v" || e.key === "V")
  );
}

function isShiftEnter(e: KeyboardEvent): boolean {
  return (
    e.key === "Enter" && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
  );
}
