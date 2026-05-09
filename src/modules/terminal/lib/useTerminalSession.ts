import { buildTerminalTheme } from "@/styles/terminalTheme";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { registerCwdHandler, registerPromptTracker } from "./osc-handlers";
import { openPty, type PtySession } from "./pty-bridge";

const FONT_FAMILY = '"JetBrains Mono", SFMono-Regular, Menlo, monospace';
const FONT_SIZE = 14;

const LOCAL_URL_RE =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{1,5})?(?:\/[^\s\x1b]*)?/g;

type Callbacks = {
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
  onDetectedLocalUrl?: (url: string) => void;
};

// Session lives outside React so split / unsplit only re-parent the DOM,
// they don't tear down the xterm Terminal or close the PTY. Real disposal
// happens via `disposeSession`, called from App.tsx when a leaf actually
// disappears from the pane tree.
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
  lastDetectedUrl: string | null;
  webglLoaded: boolean;
  ready: Promise<void>;
  disposed: boolean;
};

const sessions = new Map<number, Session>();

function ensureSession(leafId: number, initialCwd?: string): Session {
  const existing = sessions.get(leafId);
  if (existing) return existing;

  const term = new Terminal({
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    lineHeight: 1.05,
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
    lastDetectedUrl: null,
    webglLoaded: false,
    ready: Promise.resolve(),
    disposed: false,
  };
  sessions.set(leafId, session);

  // Per-session decoder so interleaved chunks across leaves don't splice
  // a multi-byte UTF-8 codepoint between unrelated streams.
  const urlDecoder = new TextDecoder("utf-8", { fatal: false });

  session.ready = (async () => {
    await document.fonts.load(`${FONT_SIZE}px "JetBrains Mono"`);
    if (session.disposed) return;

    const prompt = registerPromptTracker(term);
    session.cleanups.push(prompt.dispose);
    session.cleanups.push(
      registerCwdHandler(term, (cwd) => {
        session.lastCwd = cwd;
        session.callbacks.onCwd?.(cwd);
      }),
    );

    const pty = await openPty(
      term.cols,
      term.rows,
      {
        onData: (bytes) => {
          term.write(bytes);
          if (containsSchemeSeparator(bytes)) {
            const text = urlDecoder.decode(bytes, { stream: true });
            const matches = text.match(LOCAL_URL_RE);
            if (matches && matches.length > 0) {
              const url = stripTrailingPunct(matches[matches.length - 1]);
              if (url && url !== session.lastDetectedUrl) {
                session.lastDetectedUrl = url;
                session.callbacks.onDetectedLocalUrl?.(url);
              }
            }
          }
        },
        onExit: (code) => {
          term.write(`\r\n\x1b[2m[process exited: ${code}]\x1b[0m\r\n`);
          term.options.disableStdin = true;
          session.callbacks.onExit?.(code);
        },
      },
      initialCwd,
    );
    if (session.disposed) {
      pty.close();
      return;
    }
    session.pty = pty;
    term.onData((data) => pty.write(data));
  })();

  return session;
}

function attachSession(
  leafId: number,
  container: HTMLDivElement,
  callbacks: Callbacks,
): void {
  const s = sessions.get(leafId);
  if (!s || s.disposed) return;
  s.callbacks = callbacks;

  if (!s.term.element) {
    s.term.open(container);
    if (!s.webglLoaded) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        s.term.loadAddon(webgl);
        s.webglLoaded = true;
      } catch (e) {
        console.warn("WebGL renderer unavailable:", e);
      }
    }
  } else if (s.term.element.parentNode !== container) {
    container.appendChild(s.term.element);
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

  // Defer one frame so the new container's layout is finalized before fit.
  // First attach + every re-parent both go through this — keeps PTY and
  // term cols in sync without waiting on the ResizeObserver to trip.
  requestAnimationFrame(() => {
    if (s.disposed) return;
    s.fitAddon.fit();
    s.lastW = container.clientWidth;
    s.lastH = container.clientHeight;
    if (
      s.pty &&
      (s.term.cols !== s.lastSentCols || s.term.rows !== s.lastSentRows)
    ) {
      s.lastSentCols = s.term.cols;
      s.lastSentRows = s.term.rows;
      s.pty.resize(s.term.cols, s.term.rows);
    }

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
  });

  // Re-emit known state to the new mount so App.tsx state stays in sync
  // after a re-attach (the previous detach cleared callbacks).
  if (s.lastCwd !== null) callbacks.onCwd?.(s.lastCwd);
  if (s.lastDetectedUrl !== null)
    callbacks.onDetectedLocalUrl?.(s.lastDetectedUrl);
  callbacks.onSearchReady?.(s.searchAddon);
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
  onDetectedLocalUrl?: (url: string) => void;
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
  onDetectedLocalUrl,
}: Options) {
  const cbRef = useRef({ onSearchReady, onExit, onCwd, onDetectedLocalUrl });
  cbRef.current = { onSearchReady, onExit, onCwd, onDetectedLocalUrl };

  ensureSession(leafId, initialCwd);

  useEffect(() => {
    let cancelled = false;
    const s = sessions.get(leafId);
    if (!s) return;
    s.ready.then(() => {
      if (cancelled || !container.current) return;
      attachSession(leafId, container.current, {
        onSearchReady: (a) => cbRef.current.onSearchReady?.(a),
        onExit: (c) => cbRef.current.onExit?.(c),
        onCwd: (c) => cbRef.current.onCwd?.(c),
        onDetectedLocalUrl: (u) => cbRef.current.onDetectedLocalUrl?.(u),
      });
      if (visible && focused) s.term.focus();
    });
    return () => {
      cancelled = true;
      detachSession(leafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafId]);

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

function stripTrailingPunct(url: string): string {
  return url.replace(/[.,);\]]+$/, "");
}

function containsSchemeSeparator(bytes: Uint8Array): boolean {
  const n = bytes.length;
  for (let i = 0; i < n - 2; i++) {
    if (bytes[i] === 0x3a && bytes[i + 1] === 0x2f && bytes[i + 2] === 0x2f) {
      return true;
    }
  }
  return false;
}
