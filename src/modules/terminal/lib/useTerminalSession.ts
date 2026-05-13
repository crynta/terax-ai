import { detectMonoFontFamily } from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { buildTerminalTheme } from "@/styles/terminalTheme";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  registerCwdHandler,
  registerPromptTracker,
} from "./osc-handlers";
import { openPty, type PtySession } from "./pty-bridge";

const BACKWARD_KILL_WORD = "\x17";

type Callbacks = {
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
};

// Lives outside React so split/unsplit re-parent the DOM without tearing
// down the term or PTY. Real disposal: `disposeSession`.
type Session = {
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  pty: PtySession | null;
  cleanups: (() => void)[];
  callbacks: Callbacks;
  observer: ResizeObserver | null;
  fitTimer: ReturnType<typeof setTimeout> | null;
  ptyTimer: ReturnType<typeof setTimeout> | null;
  lastSentCols: number;
  lastSentRows: number;
  lastW: number;
  lastH: number;
  lastCwd: string | null;
  pendingExit: number | null;
  webglEnabled: boolean;
  webglAddon: WebglAddon | null;
  ready: Promise<void>;
  disposed: boolean;
  initialCwd: string | undefined;
  ptyOpening: boolean;
};

const sessions = new Map<number, Session>();

function ensureSession(leafId: number, initialCwd?: string): Session {
  const existing = sessions.get(leafId);
  if (existing) return existing;

  const prefs = usePreferencesStore.getState();
  const webglEnabled = prefs.terminalWebglEnabled;
  const fontSize = prefs.terminalFontSize;

  const term = new Terminal({
    fontFamily: detectMonoFontFamily(),
    fontSize,
    theme: buildTerminalTheme(),
    cursorBlink: true,
    cursorStyle: "bar",
    cursorInactiveStyle: "outline",
    // 5k lines × 80 cols × ~16 B per cell ≈ 6 MB per leaf. 10k doubled
    // that for output almost no one scrolls back to. Keep this knob in
    // mind if/when we add a "scrollback" preference.
    scrollback: 5_000,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  const searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);
  term.loadAddon(
    new WebLinksAddon((_e, uri) => openUrl(uri).catch(console.error)),
  );

  const session: Session = {
    term,
    fitAddon,
    searchAddon,
    pty: null,
    cleanups: [],
    callbacks: {},
    observer: null,
    fitTimer: null,
    ptyTimer: null,
    lastSentCols: 0,
    lastSentRows: 0,
    lastW: 0,
    lastH: 0,
    lastCwd: null,
    pendingExit: null,
    webglEnabled,
    webglAddon: null,
    ready: Promise.resolve(),
    disposed: false,
    initialCwd,
    ptyOpening: false,
  };
  sessions.set(leafId, session);

  term.attachCustomKeyEventHandler((event) => {
    if (!isCtrlBackspace(event)) return true;
    const pty = session.pty;
    if (!pty) return true;
    event.preventDefault();
    event.stopPropagation();
    pty.write(BACKWARD_KILL_WORD);
    return false;
  });

  // Routes through session.pty so respawn doesn't need to rebind.
  term.onData((data) => session.pty?.write(data));

  // PTY is opened lazily in attachSession after the first fit, so the shell
  // starts with the real terminal size and never flushes a 80x24-sized
  // prompt into scrollback.
  session.ready = (async () => {
    await document.fonts.ready;
    if (session.disposed) return;

    const prompt = registerPromptTracker(term);
    session.cleanups.push(prompt.dispose);
    session.cleanups.push(
      registerCwdHandler(term, (cwd) => {
        session.lastCwd = cwd;
        session.callbacks.onCwd?.(cwd);
      }),
    );
  })();

  return session;
}

function openPtyForSession(
  s: Session,
  cwd: string | undefined,
): Promise<PtySession> {
  return openPty(
    s.term.cols,
    s.term.rows,
    {
      // Hot path — keep this callback to a single statement. URL detection
      // runs out-of-band against the xterm buffer (see ensureSession's
      // scan interval), so no UTF-8 decode or regex happens per chunk.
      onData: (bytes) => s.term.write(bytes),
      onExit: (code) => {
        s.term.options.disableStdin = true;
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
  s.term.reset();
  s.term.options.disableStdin = false;
  s.lastSentCols = 0;
  s.lastSentRows = 0;
  s.pendingExit = null;
  // Hold the flag so attachSession can't open a second PTY while we await.
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
  if (s.observer) {
    pty.resize(s.term.cols, s.term.rows);
    s.lastSentCols = s.term.cols;
    s.lastSentRows = s.term.rows;
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

  const firstAttach = !s.term.element;
  if (firstAttach) {
    s.term.open(container);
  } else if (s.term.element && s.term.element.parentNode !== container) {
    container.appendChild(s.term.element);
  }

  // Sync fit before WebGL load and PTY open so the renderer measures the
  // real container and the shell starts at the right cols/rows.
  s.fitAddon.fit();
  s.lastW = container.clientWidth;
  s.lastH = container.clientHeight;

  if (firstAttach && !s.webglAddon && s.webglEnabled) {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        if (s.webglAddon === webgl) s.webglAddon = null;
      });
      s.term.loadAddon(webgl);
      s.webglAddon = webgl;
    } catch (e) {
      console.warn("WebGL renderer unavailable:", e);
    }
  }

  if (!s.pty && !s.ptyOpening) {
    s.ptyOpening = true;
    s.lastSentCols = s.term.cols;
    s.lastSentRows = s.term.rows;
    openPtyForSession(s, s.initialCwd)
      .then((pty) => {
        s.ptyOpening = false;
        if (s.disposed) {
          pty.close();
          return;
        }
        s.pty = pty;
        if (s.term.cols !== s.lastSentCols || s.term.rows !== s.lastSentRows) {
          s.lastSentCols = s.term.cols;
          s.lastSentRows = s.term.rows;
          pty.resize(s.term.cols, s.term.rows);
        }
      })
      .catch((e) => {
        s.ptyOpening = false;
        console.error("openPty failed:", e);
      });
  } else if (
    s.pty &&
    (s.term.cols !== s.lastSentCols || s.term.rows !== s.lastSentRows)
  ) {
    s.lastSentCols = s.term.cols;
    s.lastSentRows = s.term.rows;
    s.pty.resize(s.term.cols, s.term.rows);
  }

  s.observer?.disconnect();
  s.observer = null;
  if (s.fitTimer) {
    clearTimeout(s.fitTimer);
    s.fitTimer = null;
  }
  if (s.ptyTimer) {
    clearTimeout(s.ptyTimer);
    s.ptyTimer = null;
  }

  // Two-stage debounce:
  //  - FIT runs frequently (~one frame) so xterm visually keeps up with
  //    the window during drag. Local, no IPC.
  //  - PTY_RESIZE only fires on the trailing edge of the drag, because
  //    SIGWINCH is what causes shells / fancy prompts (powerlevel10k,
  //    starship) to redraw mid-resize, which the user perceives as
  //    blinking. The shell only cares about the FINAL size.
  const FIT_DEBOUNCE_MS = 8;
  const PTY_RESIZE_DEBOUNCE_MS = 256;

  const flushPtyResize = () => {
    s.ptyTimer = null;
    if (!s.pty || s.disposed) return;
    if (s.term.cols === s.lastSentCols && s.term.rows === s.lastSentRows)
      return;
    s.lastSentCols = s.term.cols;
    s.lastSentRows = s.term.rows;
    s.pty.resize(s.term.cols, s.term.rows);
  };

  s.observer = new ResizeObserver(() => {
    if (s.fitTimer) clearTimeout(s.fitTimer);
    s.fitTimer = setTimeout(() => {
      s.fitTimer = null;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === s.lastW && h === s.lastH) return;
      s.lastW = w;
      s.lastH = h;
      s.fitAddon.fit();
      if (s.ptyTimer) clearTimeout(s.ptyTimer);
      s.ptyTimer = setTimeout(flushPtyResize, PTY_RESIZE_DEBOUNCE_MS);
    }, FIT_DEBOUNCE_MS);
  });
  s.observer.observe(container);

  // Re-sync App state after re-attach (prior detach cleared callbacks).
  if (s.lastCwd !== null) callbacks.onCwd?.(s.lastCwd);
  callbacks.onSearchReady?.(s.searchAddon);
  if (s.pendingExit !== null) {
    const code = s.pendingExit;
    s.pendingExit = null;
    callbacks.onExit?.(code);
  }
}

function detachSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) return;
  s.observer?.disconnect();
  s.observer = null;
  if (s.fitTimer) {
    clearTimeout(s.fitTimer);
    s.fitTimer = null;
  }
  if (s.ptyTimer) {
    clearTimeout(s.ptyTimer);
    s.ptyTimer = null;
  }
  s.callbacks = {};
}

export function disposeSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) return;
  s.disposed = true;
  s.cleanups.forEach((fn) => fn());
  s.observer?.disconnect();
  if (s.fitTimer) clearTimeout(s.fitTimer);
  if (s.ptyTimer) clearTimeout(s.ptyTimer);
  s.pty?.close();
  s.term.dispose();
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
  const cbRef = useRef({
    onSearchReady,
    onExit,
    onCwd,
  });
  cbRef.current = {
    onSearchReady,
    onExit,
    onCwd,
  };

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
      if (visible && focused) s.term.focus();
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
    if (!s) return;
    if (s.term.options.fontSize === fontSize) return;
    s.term.options.fontSize = fontSize;
    s.fitAddon.fit();
  }, [leafId, fontSize]);

  const webglPref = usePreferencesStore((p) => p.terminalWebglEnabled);
  useEffect(() => {
    const s = sessions.get(leafId);
    if (!s) return;
    s.webglEnabled = webglPref;
    if (!s.term.element) return;
    if (webglPref && !s.webglAddon) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl.dispose();
          if (s.webglAddon === webgl) s.webglAddon = null;
        });
        s.term.loadAddon(webgl);
        s.webglAddon = webgl;
      } catch (e) {
        console.warn("WebGL renderer unavailable:", e);
      }
    } else if (!webglPref && s.webglAddon) {
      s.webglAddon.dispose();
      s.webglAddon = null;
    }
  }, [leafId, webglPref]);

  useLayoutEffect(() => {
    if (!visible) return;
    const s = sessions.get(leafId);
    if (!s) return;
    s.fitAddon.fit();
    if (focused) s.term.focus();
  }, [leafId, visible, focused]);

  const write = useCallback(
    (data: string) => sessions.get(leafId)?.pty?.write(data),
    [leafId],
  );

  const focus = useCallback(() => {
    sessions.get(leafId)?.term.focus();
  }, [leafId]);

  const getBuffer = useCallback(
    (maxLines = 200): string | null => {
      const s = sessions.get(leafId);
      if (!s) return null;
      const buf = s.term.buffer.active;
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
    const sel = sessions.get(leafId)?.term.getSelection() ?? "";
    return sel.length > 0 ? sel : null;
  }, [leafId]);

  const applyTheme = useCallback(() => {
    const s = sessions.get(leafId);
    if (!s) return;
    s.term.options.theme = buildTerminalTheme();
  }, [leafId]);

  return { write, focus, getBuffer, getSelection, applyTheme };
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

