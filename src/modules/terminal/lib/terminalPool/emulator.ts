import { detectMonoFontFamily } from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { buildTerminalTheme } from "@/styles/terminalTheme";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import {
  terminalDeleteSequence,
  terminalLineNavigationSequence,
  terminalWordNavigationSequence,
} from "../keymap";
import {
  getGlBackend,
  type GlAttachment,
} from "./glContextPool";

// Per-leaf PERSISTENT emulator lifecycle — the source of truth for a leaf's
// terminal state for its whole lifetime.
//
// WHY: The single root cause of Defects A/B/C was recycling whole xterm
// Terminal objects across leaves and rebuilding a backgrounded leaf from a
// lossy serialize-snapshot + 256KB ring. Here, ONE Terminal is created per
// leafId, kept until the leaf is disposed, and ALWAYS fed PTY bytes. There is
// no serialize, no clear()+reset() on switch, no ring. A tab switch is a pure
// view op (see view.ts). The buffer is byte-faithful across unlimited
// hide/show cycles because it is never torn down.
//
// WHEN: createEmulator() runs once when a leaf is first attached.
// disposeEmulator() runs on tab close. Everything else (attach/detach view,
// GL grant) operates on the live emulator without mutating its buffer.
//
// HOW: The emulator owns its persistent host div (created once, lives in the
// offscreen recycler when hidden, moved into the visible container when shown).
// The IME keymap handler and onData->PTY wiring are registered ONCE here
// (verbatim from the old rendererPool.createSlot) — not re-registered on every
// switch as the old bindSlot did.

export type EmulatorBridge = {
  writeToPty(data: string): void;
  resizePty(cols: number, rows: number): void;
};

export type Emulator = {
  readonly leafId: number;
  readonly term: Terminal;
  readonly fitAddon: FitAddon;
  readonly searchAddon: SearchAddon;
  readonly host: HTMLDivElement;
  gl: GlAttachment | null;
  /** Set true once OSC handlers are registered (once per lifetime). */
  oscRegistered: boolean;
  oscDisposers: (() => void)[];
  // View bookkeeping (owned by view.ts but stored here so the emulator is the
  // single record per leaf).
  container: HTMLDivElement | null;
  observer: ResizeObserver | null;
  fitTimer: ReturnType<typeof setTimeout> | null;
  ptyTimer: ReturnType<typeof setTimeout> | null;
  lastCols: number;
  lastRows: number;
  lastW: number;
  lastH: number;
};

const emulators = new Map<number, Emulator>();

export type EmulatorAdapter = {
  resolveLeaf(leafId: number): EmulatorBridge | null;
  isLeafFocused(leafId: number): boolean;
};

let adapter: EmulatorAdapter | null = null;

export function configureEmulatorAdapter(a: EmulatorAdapter): void {
  adapter = a;
}

export function getEmulatorAdapter(): EmulatorAdapter | null {
  return adapter;
}

let recyclerEl: HTMLDivElement | null = null;

/**
 * The single offscreen host for all HIDDEN emulators. A leaf's host lives here
 * (DOM-detached from the visible tree) whenever the leaf is not on screen.
 *
 * F1 RESOLUTION: parking the host here makes screenElement.isConnected===false
 * (WebGL renderer early-returns) AND drops it from the IntersectionObserver
 * (RenderService._isPaused -> no rAF scheduled). Both render layers stop while
 * the parser keeps the buffer current. Verified against installed xterm.js /
 * addon-webgl.js. Repurposed from the old rendererPool recycler.
 */
export function getRecycler(): HTMLDivElement {
  if (recyclerEl && recyclerEl.isConnected) return recyclerEl;
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

export function termOptions() {
  const prefs = usePreferencesStore.getState();
  return {
    fontFamily: prefs.terminalFontFamily || detectMonoFontFamily(),
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

/**
 * Get the existing emulator for a leaf, or null. Never creates.
 */
export function getEmulator(leafId: number): Emulator | null {
  return emulators.get(leafId) ?? null;
}

export function forEachEmulator(fn: (e: Emulator) => void): void {
  for (const e of emulators.values()) fn(e);
}

export function emulatorCount(): number {
  return emulators.size;
}

/**
 * TEST-ONLY: insert a pre-built Emulator record into the live Map without going
 * through ensureEmulator (which calls term.open() and needs a full DOM). Lets
 * the integration test exercise the real view/preferences/GL grant paths
 * against real HEADLESS Terminal objects in node.
 */
export function __registerEmulatorForTest(emu: Emulator): void {
  emulators.set(emu.leafId, emu);
}

/** TEST-ONLY: clear all registered emulators (between integration test cases). */
export function __resetEmulatorsForTest(): void {
  emulators.clear();
}

/**
 * Create (or return existing) the persistent emulator for a leaf. Opens it into
 * its own host div, which starts parked in the offscreen recycler. The keymap
 * handler + onData->PTY wiring are registered ONCE here.
 */
export function ensureEmulator(leafId: number): Emulator {
  const existing = emulators.get(leafId);
  if (existing) return existing;

  const term = new Terminal(termOptions());
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(
    new WebLinksAddon((_e, uri) => openUrl(uri).catch(console.error)),
  );

  const host = document.createElement("div");
  host.style.cssText = "width:100%;height:100%;";
  host.setAttribute("data-terax-leaf", String(leafId));
  getRecycler().appendChild(host);
  term.open(host);

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

  // NOTE: we do NOT grant a WebGL context here. ensureEmulator runs eagerly for
  // EVERY leaf (e.g. on a multi-tab restore, before any of them is shown), so an
  // unconditional grant here would allocate up to N real WebGL contexts BEFORE
  // recomputeGl prunes back to MAX_GL_CONTEXTS — transiently blowing past
  // WebKit's ~16-context ceiling and breaking the "never exceeds cap" invariant.
  // recomputeGl()/attachView() (view.ts) are the ONLY grant path: a context is
  // granted strictly under the cap, at the moment a leaf is attached/visible.

  term.attachCustomKeyEventHandler((event) => {
    // During IME composition the browser is assembling a multi-keystroke
    // character (Chinese pinyin -> hanzi, Korean jamo -> syllable, etc.).
    // Raw keydown events — including the Enter that commits a candidate —
    // must NOT be forwarded to the PTY; xterm will receive the final composed
    // string through its own compositionend handler instead. keyCode 229
    // ("Process") is what Chromium reports for every key pressed inside an
    // active IME session when isComposing is not yet set.
    if (event.isComposing || event.keyCode === 229) return false;

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
      if (event.type === "keydown" && term.hasSelection()) {
        const sel = term.getSelection();
        if (sel) void navigator.clipboard.writeText(sel).catch(() => {});
      }
      event.preventDefault();
      return false;
    }
    if (isTerminalPaste(event)) {
      if (event.type === "keydown") {
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text) term.paste(text);
          })
          .catch(() => {});
      }
      event.preventDefault();
      return false;
    }
    return true;
  });

  term.onData((data) => {
    adapter?.resolveLeaf(leafId)?.writeToPty(data);
  });

  emulators.set(leafId, emu);
  return emu;
}

/**
 * Grant a live WebGL context to an emulator (idempotent). Falls back silently
 * to the DOM renderer if WebGL is unavailable/disabled.
 */
export function grantGl(emu: Emulator): void {
  if (emu.gl) return;
  emu.gl = getGlBackend().attach(emu.term, () => {
    // onContextLoss recovery callback: clear our handle, re-grant.
    emu.gl = null;
    if (!usePreferencesStore.getState().terminalWebglEnabled) return;
    grantGl(emu);
    if (emu.gl) {
      try {
        emu.term.refresh(0, emu.term.rows - 1);
      } catch {}
    }
  });
}

/**
 * Revoke an emulator's WebGL context (it falls back to the DOM renderer, still
 * reading the same live buffer). Frees the GL context under the ~16 ceiling.
 */
export function revokeGl(emu: Emulator): void {
  if (!emu.gl) return;
  getGlBackend().dispose(emu.gl);
  emu.gl = null;
}

/**
 * Fully dispose a leaf's emulator (tab close). Tears down OSC handlers,
 * observer, timers, GL context, then the Terminal. Removes it from the Map.
 */
export function disposeEmulator(leafId: number): void {
  const emu = emulators.get(leafId);
  if (!emu) return;
  for (const d of emu.oscDisposers) {
    try {
      d();
    } catch {}
  }
  emu.oscDisposers = [];
  emu.observer?.disconnect();
  emu.observer = null;
  if (emu.fitTimer) clearTimeout(emu.fitTimer);
  if (emu.ptyTimer) clearTimeout(emu.ptyTimer);
  emu.fitTimer = null;
  emu.ptyTimer = null;
  revokeGl(emu);
  try {
    emu.term.dispose();
  } catch (e) {
    console.warn("[terax] term dispose failed:", e);
  }
  if (emu.host.parentNode) emu.host.parentNode.removeChild(emu.host);
  emulators.delete(leafId);
}
