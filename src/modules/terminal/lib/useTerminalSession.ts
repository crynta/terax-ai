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
const RESIZE_DEBOUNCE_MS = 7.5;

type Options = {
  container: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  initialCwd?: string;
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
};

export function useTerminalSession({
  container,
  visible,
  initialCwd,
  onSearchReady,
  onExit,
  onCwd,
}: Options) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyRef = useRef<PtySession | null>(null);

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    (async () => {
      await document.fonts.load(`${FONT_SIZE}px "JetBrains Mono"`);
      if (disposed || !container.current) return;

      const term = new Terminal({
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE,
        lineHeight: 1.05,
        theme: buildTerminalTheme(),
        cursorBlink: true,
        cursorStyle: "bar",
        cursorInactiveStyle: "outline",
        scrollback: 10_000,
        allowProposedApi: true,
      });
      termRef.current = term;

      const fit = new FitAddon();
      fitRef.current = fit;
      term.loadAddon(fit);

      const search = new SearchAddon();
      term.loadAddon(search);
      term.loadAddon(
        new WebLinksAddon((_e, uri) => openUrl(uri).catch(console.error)),
      );

      term.open(container.current);
      fit.fit();

      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch (e) {
        console.warn("WebGL renderer unavailable:", e);
      }

      const prompt = registerPromptTracker(term);
      cleanups.push(
        registerCwdHandler(term, (cwd) => onCwd?.(cwd)),
        prompt.dispose,
      );
      onSearchReady?.(search);

      const pty = await openPty(
        term.cols,
        term.rows,
        {
          onData: (bytes) => term.write(bytes),
          onExit: (code) => {
            term.write(`\r\n\x1b[2m[process exited: ${code}]\x1b[0m\r\n`);
            term.options.disableStdin = true;
            onExit?.(code);
          },
        },
        initialCwd,
      );
      if (disposed) {
        pty.close();
        return;
      }
      ptyRef.current = pty;

      term.onData((data) => pty.write(data));

      let lastCols = term.cols;
      let lastRows = term.rows;
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;

      const observer = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          resizeTimer = null;
          if (disposed) return;
          fit.fit();
          if (term.cols === lastCols && term.rows === lastRows) return;
          lastCols = term.cols;
          lastRows = term.rows;
          pty.resize(term.cols, term.rows);
        }, RESIZE_DEBOUNCE_MS);
      });
      observer.observe(container.current);
      cleanups.push(() => {
        observer.disconnect();
        if (resizeTimer) clearTimeout(resizeTimer);
      });

      if (visible) term.focus();
    })();

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
      ptyRef.current?.close();
      ptyRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    fitRef.current?.fit();
    termRef.current?.focus();
  }, [visible]);

  const write = useCallback((data: string) => {
    ptyRef.current?.write(data);
  }, []);

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  return { write, focus };
}
