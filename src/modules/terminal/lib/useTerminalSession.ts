import { detectMonoFontFamily } from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { buildTerminalTheme } from "@/styles/terminalTheme";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { DormantRing } from "./dormantRing";
import { registerCwdHandler, registerPromptTracker } from "./osc-handlers";
import { openPty, type PtySession } from "./pty-bridge";

const BACKWARD_KILL_WORD = "\x17";
const SHIFT_ENTER = "\x1b\r";

const HIBERNATE_SNAPSHOT_SCROLLBACK_CAP = 5_000;
const FIT_DEBOUNCE_MS = 8;
const PTY_RESIZE_DEBOUNCE_MS = 256;

type Callbacks = {
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
};

type LiveTerm = {
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  webglAddon: WebglAddon | null;
  webglCanvases: HTMLCanvasElement[];
  oscDisposers: (() => void)[];
  observer: ResizeObserver | null;
  fitTimer: ReturnType<typeof setTimeout> | null;
  ptyTimer: ReturnType<typeof setTimeout> | null;
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
  webglEnabled: boolean;
  disposed: boolean;
  ready: Promise<void>;
  lastSentCols: number;
  lastSentRows: number;
  lastW: number;
  lastH: number;
  container: HTMLDivElement | null;
  live: LiveTerm | null;
  snapshot: string | null;
  dormantRing: DormantRing;
  handleData: (bytes: Uint8Array) => void;
};

const sessions = new Map<number, Session>();

function termOptions() {
  const prefs = usePreferencesStore.getState();
  return {
    fontFamily: detectMonoFontFamily(),
    fontSize: prefs.terminalFontSize,
    theme: buildTerminalTheme(),
    cursorBlink: true,
    cursorStyle: "bar" as const,
    cursorInactiveStyle: "outline" as const,
    scrollback: prefs.terminalScrollback,
    allowProposedApi: true,
  };
}

function buildLiveTerm(s: Session, cols?: number, rows?: number): LiveTerm {
  const term = new Terminal(termOptions());
  if (cols && rows) term.resize(cols, rows);

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  const searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);
  term.loadAddon(
    new WebLinksAddon((_e, uri) => openUrl(uri).catch(console.error)),
  );

  term.attachCustomKeyEventHandler((event) => {
    const pty = s.pty;
    if (!pty) return true;
    if (isCtrlBackspace(event)) {
      event.preventDefault();
      event.stopPropagation();
      pty.write(BACKWARD_KILL_WORD);
      return false;
    }
    if (isShiftEnter(event)) {
      event.preventDefault();
      event.stopPropagation();
      pty.write(SHIFT_ENTER);
      return false;
    }
    return true;
  });

  term.onData((data) => s.pty?.write(data));

  const prompt = registerPromptTracker(term);
  const cwd = registerCwdHandler(term, (next) => {
    if (s.lastCwd === next) return;
    s.lastCwd = next;
    s.callbacks.onCwd?.(next);
  });

  s.handleData = (bytes) => term.write(bytes);

  return {
    term,
    fitAddon,
    searchAddon,
    webglAddon: null,
    webglCanvases: [],
    oscDisposers: [prompt.dispose, cwd],
    observer: null,
    fitTimer: null,
    ptyTimer: null,
  };
}

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
    webglEnabled: usePreferencesStore.getState().terminalWebglEnabled,
    disposed: false,
    ready: Promise.resolve(),
    lastSentCols: 0,
    lastSentRows: 0,
    lastW: 0,
    lastH: 0,
    container: null,
    live: null,
    snapshot: null,
    dormantRing: new DormantRing(),
    handleData: () => {},
  };
  session.handleData = (bytes) => session.dormantRing.push(bytes);
  sessions.set(leafId, session);

  session.ready = (async () => {
    await document.fonts.ready;
  })();

  return session;
}

function openPtyForSession(
  s: Session,
  cwd: string | undefined,
): Promise<PtySession> {
  const live = s.live;
  const startCols = live?.term.cols ?? s.lastSentCols ?? 80;
  const startRows = live?.term.rows ?? s.lastSentRows ?? 24;
  return openPty(
    startCols,
    startRows,
    {
      onData: (bytes) => s.handleData(bytes),
      onExit: (code) => {
        s.shellExited = true;
        s.pty = null;
        if (s.live) s.live.term.options.disableStdin = true;
        if (s.callbacks.onExit) s.callbacks.onExit(code);
        else s.pendingExit = code;
      },
    },
    cwd,
  );
}

export async function respawnSession(
  leafId: number,
  cwd?: string,
): Promise<void> {
  const s = sessions.get(leafId);
  if (!s || s.disposed) return;
  s.pty?.close();
  s.pty = null;

  s.snapshot = null;
  s.dormantRing = new DormantRing();
  s.shellExited = false;
  s.pendingExit = null;

  const carryCols = s.live?.term.cols ?? s.lastSentCols ?? 0;
  const carryRows = s.live?.term.rows ?? s.lastSentRows ?? 0;

  if (!s.live) {
    s.live = buildLiveTerm(s, carryCols, carryRows);
    s.handleData = (bytes) => s.live!.term.write(bytes);
    if (s.container) reopenLive(s);
  } else {
    s.live.term.reset();
    s.live.term.options.disableStdin = false;
  }

  s.lastSentCols = 0;
  s.lastSentRows = 0;
  s.ptyOpening = true;
  let pty: PtySession;
  try {
    pty = await openPtyForSession(s, cwd);
  } catch (e) {
    s.ptyOpening = false;
    console.error("respawnSession: openPty failed:", e);
    return;
  }
  s.ptyOpening = false;
  if (s.disposed) {
    pty.close();
    return;
  }
  s.pty = pty;
  if (s.live?.observer) {
    pty.resize(s.live.term.cols, s.live.term.rows);
    s.lastSentCols = s.live.term.cols;
    s.lastSentRows = s.live.term.rows;
  }
}

function reopenLive(s: Session): void {
  const live = s.live;
  const container = s.container;
  if (!live || !container) return;
  if (!live.term.element) {
    live.term.open(container);
  } else if (live.term.element.parentNode !== container) {
    container.appendChild(live.term.element);
  }
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

  if (!s.live && s.visibleNow) wakeFromHibernate(s);
  const live = s.live;
  if (!live) {
    if (!s.pty && !s.ptyOpening && !s.shellExited) {
      s.ptyOpening = true;
      openPtyForSession(s, s.initialCwd)
        .then((pty) => {
          s.ptyOpening = false;
          if (s.disposed) {
            pty.close();
            return;
          }
          s.pty = pty;
        })
        .catch((e) => {
          s.ptyOpening = false;
          console.error("openPty failed:", e);
        });
    }
    return;
  }

  reopenLive(s);

  live.fitAddon.fit();
  s.lastW = container.clientWidth;
  s.lastH = container.clientHeight;

  syncWebgl(leafId, s);

  if (!s.pty && !s.ptyOpening) {
    s.ptyOpening = true;
    s.lastSentCols = live.term.cols;
    s.lastSentRows = live.term.rows;
    openPtyForSession(s, s.initialCwd)
      .then((pty) => {
        s.ptyOpening = false;
        if (s.disposed) {
          pty.close();
          return;
        }
        s.pty = pty;
        const cur = s.live;
        if (cur && (cur.term.cols !== s.lastSentCols || cur.term.rows !== s.lastSentRows)) {
          s.lastSentCols = cur.term.cols;
          s.lastSentRows = cur.term.rows;
          pty.resize(cur.term.cols, cur.term.rows);
        }
      })
      .catch((e) => {
        s.ptyOpening = false;
        console.error("openPty failed:", e);
      });
  } else if (
    s.pty &&
    (live.term.cols !== s.lastSentCols || live.term.rows !== s.lastSentRows)
  ) {
    s.lastSentCols = live.term.cols;
    s.lastSentRows = live.term.rows;
    s.pty.resize(live.term.cols, live.term.rows);
  }

  live.observer?.disconnect();
  live.observer = null;
  if (live.fitTimer) {
    clearTimeout(live.fitTimer);
    live.fitTimer = null;
  }
  if (live.ptyTimer) {
    clearTimeout(live.ptyTimer);
    live.ptyTimer = null;
  }

  // Two-stage debounce: trailing-edge pty resize avoids prompt flicker on
  // shells with rich prompts (p10k, starship) during drag.
  const flushPtyResize = () => {
    if (!live) return;
    live.ptyTimer = null;
    if (!s.pty || s.disposed) return;
    if (live.term.cols === s.lastSentCols && live.term.rows === s.lastSentRows)
      return;
    s.lastSentCols = live.term.cols;
    s.lastSentRows = live.term.rows;
    s.pty.resize(live.term.cols, live.term.rows);
  };

  live.observer = new ResizeObserver(() => {
    if (live.fitTimer) clearTimeout(live.fitTimer);
    live.fitTimer = setTimeout(() => {
      live.fitTimer = null;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === s.lastW && h === s.lastH) return;
      s.lastW = w;
      s.lastH = h;
      live.fitAddon.fit();
      if (live.ptyTimer) clearTimeout(live.ptyTimer);
      live.ptyTimer = setTimeout(flushPtyResize, PTY_RESIZE_DEBOUNCE_MS);
    }, FIT_DEBOUNCE_MS);
  });
  live.observer.observe(container);

  if (s.lastCwd !== null) callbacks.onCwd?.(s.lastCwd);
  callbacks.onSearchReady?.(live.searchAddon);
  if (s.pendingExit !== null) {
    const code = s.pendingExit;
    s.pendingExit = null;
    callbacks.onExit?.(code);
  }
}

const webglStats = { attach: 0, dispose: 0, loseContextOk: 0, contextLoss: 0 };
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as { __teraxWebglStats?: () => typeof webglStats })
    .__teraxWebglStats = () => ({ ...webglStats });
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
      if (ext && !gl.isContextLost()) {
        ext.loseContext();
        webglStats.loseContextOk++;
      }
    } catch (e) {
      console.warn("[terax-webgl] loseContext failed:", e);
    }
  }
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {}
  try {
    canvas.parentNode?.removeChild(canvas);
  } catch {}
}

function attachWebgl(_leafId: number, s: Session): void {
  const live = s.live;
  if (!live || live.webglAddon || !s.webglEnabled || !live.term.element) return;
  const elem = live.term.element;
  const before = new Set<HTMLCanvasElement>(
    elem.querySelectorAll<HTMLCanvasElement>("canvas"),
  );
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      webglStats.contextLoss++;
      const cur = s.live;
      if (cur && cur.webglAddon === webgl) {
        cur.webglAddon = null;
        cur.webglCanvases = [];
      }
      try {
        webgl.dispose();
      } catch {}
    });
    live.term.loadAddon(webgl);
    const after = elem.querySelectorAll<HTMLCanvasElement>("canvas");
    const added: HTMLCanvasElement[] = [];
    for (const c of after) if (!before.has(c)) added.push(c);
    live.webglAddon = webgl;
    live.webglCanvases = added;
    webglStats.attach++;
  } catch (e) {
    console.warn("[terax-webgl] renderer unavailable:", e);
  }
}

function disposeWebgl(_leafId: number, s: Session): void {
  const live = s.live;
  if (!live || !live.webglAddon) return;
  const addon = live.webglAddon;
  // Release GPU resources before addon.dispose() — xterm-addon-webgl 0.19
  // never calls loseContext() itself, so doing it afterwards targets canvases
  // already detached and pending GC.
  for (const canvas of live.webglCanvases) releaseCanvasContext(canvas);
  live.webglCanvases = [];
  try {
    addon.dispose();
  } catch (e) {
    console.warn("[terax-webgl] webgl.dispose failed:", e);
  }
  // addon.dispose() in 0.19 leaves _renderer pointing at canvas/gl, which
  // pins the WebGL slot in JS heap until GC. Break the refs explicitly.
  try {
    const renderer = (
      addon as unknown as {
        _renderer?: Record<string, unknown> | null;
        _renderService?: Record<string, unknown> | null;
      }
    )._renderer;
    if (renderer) {
      renderer._canvas = null;
      renderer._gl = null;
      renderer._charAtlas = null;
      renderer._atlas = null;
    }
    (
      addon as unknown as { _renderer?: unknown; _renderService?: unknown }
    )._renderer = null;
    (
      addon as unknown as { _renderer?: unknown; _renderService?: unknown }
    )._renderService = null;
  } catch {}
  live.webglAddon = null;
  webglStats.dispose++;
}

function syncWebgl(leafId: number, s: Session): void {
  if (!s.live) return;
  const shouldOwn = s.webglEnabled && s.visibleNow;
  if (shouldOwn && !s.live.webglAddon) attachWebgl(leafId, s);
  else if (!shouldOwn && s.live.webglAddon) disposeWebgl(leafId, s);
}

function hibernate(leafId: number, s: Session): void {
  const live = s.live;
  if (!live) return;

  try {
    const serialize = new SerializeAddon();
    live.term.loadAddon(serialize);
    const scrollback = Math.min(
      HIBERNATE_SNAPSHOT_SCROLLBACK_CAP,
      usePreferencesStore.getState().terminalScrollback,
    );
    s.snapshot = serialize.serialize({ scrollback });
    serialize.dispose();
  } catch (e) {
    console.warn("serialize failed; hibernating without snapshot:", e);
    s.snapshot = null;
  }

  s.lastSentCols = live.term.cols;
  s.lastSentRows = live.term.rows;

  s.handleData = (bytes) => s.dormantRing.push(bytes);

  disposeWebgl(leafId, s);
  live.observer?.disconnect();
  if (live.fitTimer) clearTimeout(live.fitTimer);
  if (live.ptyTimer) clearTimeout(live.ptyTimer);
  for (const d of live.oscDisposers) {
    try {
      d();
    } catch (e) {
      console.warn("osc disposer failed:", e);
    }
  }
  try {
    live.term.dispose();
  } catch (e) {
    console.warn("term.dispose failed:", e);
  }
  s.live = null;
}

function wakeFromHibernate(s: Session): void {
  if (s.live || s.disposed) return;
  const live = buildLiveTerm(s, s.lastSentCols, s.lastSentRows);
  s.live = live;
  if (s.shellExited) live.term.options.disableStdin = true;
  if (s.snapshot) {
    try {
      live.term.write(s.snapshot);
    } catch (e) {
      console.warn("snapshot replay failed:", e);
    }
    s.snapshot = null;
  }
  s.dormantRing.drain((bytes) => live.term.write(bytes));
  s.handleData = (bytes) => live.term.write(bytes);
}

function detachSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) return;
  const live = s.live;
  if (live) {
    live.observer?.disconnect();
    live.observer = null;
    if (live.fitTimer) {
      clearTimeout(live.fitTimer);
      live.fitTimer = null;
    }
    if (live.ptyTimer) {
      clearTimeout(live.ptyTimer);
      live.ptyTimer = null;
    }
  }
  s.callbacks = {};
  s.container = null;
}

export function disposeSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) return;
  s.disposed = true;
  const live = s.live;
  if (live) {
    live.observer?.disconnect();
    if (live.fitTimer) clearTimeout(live.fitTimer);
    if (live.ptyTimer) clearTimeout(live.ptyTimer);
    disposeWebgl(leafId, s);
    for (const d of live.oscDisposers) {
      try {
        d();
      } catch {}
    }
    try {
      live.term.dispose();
    } catch {}
    s.live = null;
  }
  s.snapshot = null;
  s.pty?.close();
  s.pty = null;
  sessions.delete(leafId);
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
      if (cancelled || !container.current) return;
      attachSession(leafId, container.current, {
        onSearchReady: (a) => cbRef.current.onSearchReady?.(a),
        onExit: (c) => cbRef.current.onExit?.(c),
        onCwd: (c) => cbRef.current.onCwd?.(c),
      });
      if (visible && focused) s.live?.term.focus();
    });
    return () => {
      cancelled = true;
      detachSession(leafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafId]);

  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  useEffect(() => {
    const s = sessions.get(leafId);
    if (!s?.live) return;
    if (s.live.term.options.fontSize === fontSize) return;
    s.live.term.options.fontSize = fontSize;
    s.live.fitAddon.fit();
  }, [leafId, fontSize]);

  const scrollback = usePreferencesStore((p) => p.terminalScrollback);
  useEffect(() => {
    const s = sessions.get(leafId);
    if (!s?.live) return;
    if (s.live.term.options.scrollback === scrollback) return;
    s.live.term.options.scrollback = scrollback;
  }, [leafId, scrollback]);

  const webglPref = usePreferencesStore((p) => p.terminalWebglEnabled);
  useEffect(() => {
    const s = sessions.get(leafId);
    if (!s) return;
    s.webglEnabled = webglPref;
    s.visibleNow = visible;
    s.focusedNow = focused;
    if (visible) {
      if (!s.live && s.container) {
        wakeFromHibernate(s);
        if (s.live) attachSession(leafId, s.container, s.callbacks);
      }
      syncWebgl(leafId, s);
      if (focused) s.live?.term.focus();
    } else {
      syncWebgl(leafId, s);
      if (s.live) hibernate(leafId, s);
    }
  }, [leafId, webglPref, visible, focused]);

  const write = useCallback(
    (data: string) => sessions.get(leafId)?.pty?.write(data),
    [leafId],
  );

  const focus = useCallback(() => {
    sessions.get(leafId)?.live?.term.focus();
  }, [leafId]);

  const getBuffer = useCallback(
    (maxLines = 200): string | null => {
      const s = sessions.get(leafId);
      if (!s) return null;
      if (s.live) {
        const buf = s.live.term.buffer.active;
        const total = buf.length;
        const lines: string[] = [];
        const start = Math.max(0, total - maxLines);
        for (let i = start; i < total; i++) {
          lines.push(buf.getLine(i)?.translateToString(true) ?? "");
        }
        while (lines.length && lines[lines.length - 1] === "") lines.pop();
        return lines.join("\n");
      }
      if (!s.snapshot) return "";
      const plain = stripAnsi(s.snapshot);
      const lines = plain.split(/\r?\n/);
      const tail = lines.slice(-maxLines);
      while (tail.length && tail[tail.length - 1] === "") tail.pop();
      return tail.join("\n");
    },
    [leafId],
  );

  const getSelection = useCallback((): string | null => {
    const s = sessions.get(leafId);
    const sel = s?.live?.term.getSelection() ?? "";
    return sel.length > 0 ? sel : null;
  }, [leafId]);

  const applyTheme = useCallback(() => {
    const s = sessions.get(leafId);
    if (!s?.live) return;
    s.live.term.options.theme = buildTerminalTheme();
  }, [leafId]);

  return useMemo(
    () => ({ write, focus, getBuffer, getSelection, applyTheme }),
    [write, focus, getBuffer, getSelection, applyTheme],
  );
}

function isCtrlBackspace(event: KeyboardEvent): boolean {
  return (
    event.type === "keydown" &&
    event.key === "Backspace" &&
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  );
}

function isShiftEnter(event: KeyboardEvent): boolean {
  return (
    event.type === "keydown" &&
    event.key === "Enter" &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  );
}

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][AB012]|\x1b[78=>]|\x1bc|\x1b[NOP\]X^_]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}
