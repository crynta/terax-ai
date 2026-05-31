import { ensureMonoFontsLoaded } from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SearchAddon } from "@xterm/addon-search";
import type { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  createShellIntegrationState,
  registerCwdHandler,
  registerPromptTracker,
} from "./osc-handlers";
import { openPty, type PtySession } from "./pty-bridge";
import {
  applyBackgroundActive,
  applyCursorBlinkFor,
  applyFontFamily,
  applyFontSize,
  applyLetterSpacing,
  applyScrollback,
  applyScrollbackFor,
  applyTheme as applyPoolTheme,
  applyWebglPreference,
  attachView,
  clearViewState,
  configureEmulatorAdapter,
  detachView,
  disposeEmulator,
  ensureEmulator,
  focusLeaf,
  getEmulator,
  setTopLeaf,
  WriteScheduler,
} from "./terminalPool";

// Per-leaf terminal session coordinator.
//
// REWRITTEN for the persistent-buffer model. Public surface unchanged:
//   whenSessionReady / writeToSession / clearFocusedTerminal / leafIdForPty /
//   respawnSession / disposeSession + the useTerminalSession hook returning
//   { write, focus, getBuffer, getSelection, applyTheme }.
//
// The Session record no longer carries snapshot / dormantRing /
// altScreenAtRelease / hasSlot — there is one persistent emulator per leaf
// (terminalPool) that is ALWAYS fed PTY bytes. Visibility drives a pure view
// attach/detach, never a buffer rebuild.

type Callbacks = {
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
};

type Session = {
  pty: PtySession | null;
  ptyOpening: boolean;
  initialCwd: string | undefined;
  lastCwd: string | null;
  pendingExit: number | null;
  shellExited: boolean;
  callbacks: Callbacks;
  visibleNow: boolean;
  focusedNow: boolean;
  disposed: boolean;
  ready: Promise<void>;
  cols: number;
  rows: number;
  container: HTMLDivElement | null;
  searchQuery: string | null;
};

const sessions = new Map<number, Session>();

// One coalescer for the whole app (keyed internally by leafId). Visible leaves
// write synchronously; hidden leaves coalesce per animation frame (F3).
const writeScheduler = new WriteScheduler();

const readyLeaves = new Set<number>();
const readyWaiters = new Map<
  number,
  { resolve: () => void; timer: ReturnType<typeof setTimeout> }[]
>();

function markSessionReady(leafId: number): void {
  if (readyLeaves.has(leafId)) return;
  readyLeaves.add(leafId);
  const waiters = readyWaiters.get(leafId);
  if (!waiters) return;
  readyWaiters.delete(leafId);
  for (const w of waiters) {
    clearTimeout(w.timer);
    w.resolve();
  }
}

export function whenSessionReady(leafId: number, timeoutMs = 4000): Promise<void> {
  if (readyLeaves.has(leafId)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const arr = readyWaiters.get(leafId);
      const i = arr?.findIndex((w) => w.timer === timer) ?? -1;
      if (arr && i >= 0) arr.splice(i, 1);
      resolve();
    }, timeoutMs);
    const arr = readyWaiters.get(leafId) ?? [];
    arr.push({ resolve, timer });
    readyWaiters.set(leafId, arr);
  });
}

export function writeToSession(leafId: number, data: string): boolean {
  const s = sessions.get(leafId);
  if (!s || !s.pty) return false;
  void s.pty.write(data);
  return true;
}

/**
 * Clear the scrollback and screen of the currently focused terminal, keeping
 * the active prompt line — macOS Terminal's ⌘K behaviour. Returns false when no
 * focused terminal is bound (e.g. focus is in the editor or AI panel).
 */
export function clearFocusedTerminal(): boolean {
  for (const [leafId, s] of sessions) {
    if (!s.visibleNow || !s.focusedNow) continue;
    const emu = getEmulator(leafId);
    if (!emu) continue;
    emu.term.clear();
    return true;
  }
  return false;
}

export function leafIdForPty(ptyId: number): number | null {
  for (const [leafId, s] of sessions) {
    if (s.pty?.id === ptyId) return leafId;
  }
  return null;
}

// Wire the terminalPool's adapter so its persistent emulators can reach the PTY
// for this leaf (onData / resize) and query focus. No kickPty/evictLeaf — those
// were lossy-rebuild machinery and are deleted.
configureEmulatorAdapter({
  resolveLeaf(leafId) {
    const s = sessions.get(leafId);
    if (!s) return null;
    return {
      writeToPty: (data) => {
        s.pty?.write(data);
      },
      resizePty: (cols, rows) => {
        s.cols = cols;
        s.rows = rows;
        s.pty?.resize(cols, rows);
      },
    };
  },
  isLeafFocused(leafId) {
    const s = sessions.get(leafId);
    return !!s && s.visibleNow && s.focusedNow;
  },
});

function ensureSession(leafId: number, initialCwd?: string): Session {
  const existing = sessions.get(leafId);
  if (existing) return existing;

  const session: Session = {
    pty: null,
    ptyOpening: false,
    initialCwd,
    lastCwd: null,
    pendingExit: null,
    shellExited: false,
    callbacks: {},
    visibleNow: false,
    focusedNow: false,
    disposed: false,
    ready: Promise.resolve(),
    cols: 0,
    rows: 0,
    container: null,
    searchQuery: null,
  };
  sessions.set(leafId, session);

  session.ready = (async () => {
    await ensureMonoFontsLoaded();
    await document.fonts.ready;
  })();

  return session;
}

/**
 * PTY bytes always flow into the persistent emulator. The write scheduler
 * decides immediate (visible) vs coalesced-per-frame (hidden) — never dropped.
 */
function deliverPtyBytes(leafId: number, bytes: Uint8Array): void {
  const s = sessions.get(leafId);
  if (!s) return;
  const emu = ensureEmulator(leafId);
  ensureOscHandlers(leafId, emu.term);
  writeScheduler.deliver(leafId, emu.term, bytes, s.visibleNow);
}

/**
 * Register the OSC 7 (cwd) + OSC 133 (prompt) handlers ONCE per emulator
 * lifetime. Under the persistent model the emulator survives every tab switch,
 * so re-registering on each attach (the old behavior) would leak handlers.
 */
function ensureOscHandlers(leafId: number, term: Terminal): void {
  const emu = getEmulator(leafId);
  if (!emu || emu.oscRegistered) return;
  emu.oscRegistered = true;
  const s = sessions.get(leafId);
  // Shared in-command flag — see osc-handlers.ts. The prompt tracker flips it
  // on OSC 133 B/C/D/A; the cwd handler reads it to ignore OSC 7 emitted by
  // untrusted command output (remote SSH, `cat` of an attacker file, etc.).
  const shellState = createShellIntegrationState();
  const prompt = registerPromptTracker(term, shellState);
  const cwd = registerCwdHandler(
    term,
    (next) => {
      markSessionReady(leafId);
      const sess = sessions.get(leafId);
      if (!sess) return;
      if (sess.lastCwd === next) return;
      sess.lastCwd = next;
      sess.callbacks.onCwd?.(next);
    },
    shellState,
  );
  emu.oscDisposers = [prompt.dispose, cwd];
  // If a cwd was already known (e.g. re-entry), surface it.
  if (s?.lastCwd != null) s.callbacks.onCwd?.(s.lastCwd);
}

async function openPtyForSession(
  leafId: number,
  s: Session,
  cwd: string | undefined,
): Promise<PtySession> {
  const startCols = s.cols > 0 ? s.cols : 80;
  const startRows = s.rows > 0 ? s.rows : 24;
  return openPty(
    startCols,
    startRows,
    {
      onData: (bytes) => deliverPtyBytes(leafId, bytes),
      onExit: (code) => {
        s.shellExited = true;
        s.pty = null;
        const emu = getEmulator(leafId);
        if (emu) emu.term.options.disableStdin = true;
        if (s.callbacks.onExit) s.callbacks.onExit(code);
        else s.pendingExit = code;
      },
    },
    cwd,
  );
}

/**
 * Show a leaf: ensure its persistent emulator exists, register OSC handlers
 * once, attach the host into the visible container (xterm repaints from the
 * live buffer), flush any coalesced background bytes, restore focus.
 */
function showLeaf(leafId: number, s: Session): void {
  if (!s.container) return;
  const emu = ensureEmulator(leafId);
  ensureOscHandlers(leafId, emu.term);
  emu.term.options.disableStdin = s.shellExited;
  attachView(leafId, s.container, s.cols, s.rows, s.focusedNow);
  // Foreground gets full scrollback pref.
  applyScrollbackFor(emu);
  // Drain any bytes that coalesced while the leaf was hidden so the on-show
  // repaint reflects the very latest output.
  writeScheduler.flush(leafId);
  if (s.searchQuery) {
    try {
      emu.searchAddon.findNext(s.searchQuery);
    } catch {}
  }
  applyCursorBlinkFor(leafId, s.focusedNow);
  s.callbacks.onSearchReady?.(emu.searchAddon);
  if (s.lastCwd !== null) s.callbacks.onCwd?.(s.lastCwd);
  if (s.pendingExit !== null) {
    const code = s.pendingExit;
    s.pendingExit = null;
    s.callbacks.onExit?.(code);
  }
}

/**
 * Hide a leaf: park its host in the offscreen recycler (DOM-detach => render
 * stops, buffer stays live). Drop background scrollback cap. The buffer is NOT
 * serialized or cleared.
 */
function hideLeaf(leafId: number): void {
  detachView(leafId);
  const emu = getEmulator(leafId);
  if (emu) applyScrollbackFor(emu);
}

function attachSession(
  leafId: number,
  container: HTMLDivElement,
  callbacks: Callbacks,
): void {
  const s = sessions.get(leafId);
  if (!s || s.disposed) return;
  s.callbacks = callbacks;
  s.container = container;

  // Create the persistent emulator up-front so PTY bytes have somewhere to go
  // even before the leaf is ever shown.
  const emu = ensureEmulator(leafId);
  ensureOscHandlers(leafId, emu.term);

  if (s.visibleNow) showLeaf(leafId, s);

  if (!s.pty && !s.ptyOpening && !s.shellExited) {
    s.ptyOpening = true;
    openPtyForSession(leafId, s, s.initialCwd)
      .then((pty) => {
        s.ptyOpening = false;
        if (s.disposed) {
          pty.close();
          return;
        }
        s.pty = pty;
        if (s.cols > 0 && s.rows > 0) pty.resize(s.cols, s.rows);
      })
      .catch((e) => {
        s.ptyOpening = false;
        console.error("[terax] openPty failed:", e);
      });
  }
}

/**
 * React effect cleanup: the leaf's DOM container is going away. Park the view
 * but DO NOT dispose the emulator (the leaf still exists; it may remount). The
 * emulator is only disposed via disposeSession on real tab close.
 */
function detachSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) return;
  hideLeaf(leafId);
  s.callbacks = {};
  s.container = null;
}

export async function respawnSession(
  leafId: number,
  cwd?: string,
): Promise<void> {
  const s = sessions.get(leafId);
  if (!s || s.disposed) return;
  s.pty?.close();
  s.pty = null;
  s.shellExited = false;
  s.pendingExit = null;
  writeScheduler.cancel(leafId);

  // Respawn clears the SAME persistent emulator (it survives the respawn).
  const emu = getEmulator(leafId);
  if (emu) {
    emu.term.options.disableStdin = false;
    emu.term.clear();
    emu.term.reset();
  }

  s.ptyOpening = true;
  let pty: PtySession;
  try {
    pty = await openPtyForSession(leafId, s, cwd ?? s.initialCwd);
  } catch (e) {
    s.ptyOpening = false;
    console.error("[terax] respawn openPty failed:", e);
    return;
  }
  s.ptyOpening = false;
  if (s.disposed) {
    pty.close();
    return;
  }
  s.pty = pty;
  if (s.cols > 0 && s.rows > 0) pty.resize(s.cols, s.rows);
}

export function disposeSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) return;
  s.disposed = true;
  writeScheduler.cancel(leafId);
  clearViewState(leafId);
  // Real teardown on tab close: dispose the persistent emulator + free its GL
  // context (the old code only unbound a recycled slot — this is the correct
  // lifecycle end).
  disposeEmulator(leafId);
  s.pty?.close();
  s.pty = null;
  sessions.delete(leafId);
  readyLeaves.delete(leafId);
  const waiters = readyWaiters.get(leafId);
  if (waiters) {
    readyWaiters.delete(leafId);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve();
    }
  }
}

type Options = {
  leafId: number;
  container: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  focused?: boolean;
  initialCwd?: string;
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
};

export function useTerminalSession({
  leafId,
  container,
  visible,
  focused = true,
  initialCwd,
  onSearchReady,
  onExit,
  onCwd,
}: Options) {
  const cbRef = useRef({ onSearchReady, onExit, onCwd });
  cbRef.current = { onSearchReady, onExit, onCwd };

  useEffect(() => {
    let cancelled = false;
    const s = ensureSession(leafId, initialCwd);
    s.ready.then(() => {
      if (cancelled || s.disposed) return;
      const node = container.current;
      if (!node) return;
      attachSession(leafId, node, {
        onSearchReady: (a) => cbRef.current.onSearchReady?.(a),
        onExit: (c) => cbRef.current.onExit?.(c),
        onCwd: (c) => cbRef.current.onCwd?.(c),
      });
      if (s.visibleNow && s.focusedNow) focusLeaf(leafId);
    });
    return () => {
      cancelled = true;
      detachSession(leafId);
    };
  }, [leafId, container, initialCwd]);

  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  const zoomLevel = usePreferencesStore((p) => p.zoomLevel);
  useEffect(() => {
    applyFontSize(Math.max(4, Math.round(fontSize * zoomLevel)));
  }, [fontSize, zoomLevel]);

  const fontFamily = usePreferencesStore((p) => p.terminalFontFamily);
  useEffect(() => {
    applyFontFamily(fontFamily);
  }, [fontFamily]);

  const letterSpacing = usePreferencesStore((p) => p.terminalLetterSpacing);
  useEffect(() => {
    applyLetterSpacing(letterSpacing);
  }, [letterSpacing]);

  const scrollback = usePreferencesStore((p) => p.terminalScrollback);
  useEffect(() => {
    applyScrollback(scrollback);
  }, [scrollback]);

  const webglPref = usePreferencesStore((p) => p.terminalWebglEnabled);
  useEffect(() => {
    applyWebglPreference(webglPref);
  }, [webglPref]);

  const bgActive = usePreferencesStore(
    (p) => p.backgroundKind === "image" && !!p.backgroundImageId,
  );
  useEffect(() => {
    applyBackgroundActive(bgActive);
  }, [bgActive]);

  useEffect(() => {
    const s = sessions.get(leafId);
    if (!s) return;
    const wasVisible = s.visibleNow;
    s.visibleNow = visible;
    s.focusedNow = focused;
    if (visible) {
      if (s.container && !wasVisible) showLeaf(leafId, s);
      setTopLeaf(leafId, focused);
      applyCursorBlinkFor(leafId, focused);
      if (focused) focusLeaf(leafId);
    } else if (wasVisible) {
      hideLeaf(leafId);
    }
  }, [leafId, visible, focused]);

  const write = useCallback(
    (data: string) => sessions.get(leafId)?.pty?.write(data),
    [leafId],
  );

  const focus = useCallback(() => focusLeaf(leafId), [leafId]);

  const getBuffer = useCallback(
    (maxLines = 200): string | null => {
      const s = sessions.get(leafId);
      if (!s) return null;
      const emu = getEmulator(leafId);
      if (!emu) return "";
      const buf = emu.term.buffer.active;
      const total = buf.length;
      const lines: string[] = [];
      const start = Math.max(0, total - maxLines);
      for (let i = start; i < total; i++) {
        lines.push(buf.getLine(i)?.translateToString(true) ?? "");
      }
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      return lines.join("\n");
    },
    [leafId],
  );

  const getSelection = useCallback((): string | null => {
    const emu = getEmulator(leafId);
    const sel = emu?.term.getSelection() ?? "";
    return sel.length > 0 ? sel : null;
  }, [leafId]);

  const applyTheme = useCallback(() => {
    applyPoolTheme();
  }, []);

  return useMemo(
    () => ({ write, focus, getBuffer, getSelection, applyTheme }),
    [write, focus, getBuffer, getSelection, applyTheme],
  );
}
