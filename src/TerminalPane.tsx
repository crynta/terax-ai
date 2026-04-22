import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { openPty, type PtySession } from "./pty";
import { shadcnDark } from "./themes";

const FONT_FAMILY = '"JetBrains Mono", SFMono-Regular, Menlo, monospace';
const FONT_SIZE = 13;

type Props = {
  /** Stable identity — used by parent to decide focus + fit on visibility change. */
  tabId: number;
  visible: boolean;
  /** Called once the search addon is ready so the parent can drive search across tabs. */
  onSearchReady?: (tabId: number, addon: SearchAddon) => void;
  /** Called when the underlying shell exits. */
  onExit?: (tabId: number, code: number) => void;
};

export function TerminalPane({ tabId, visible, onSearchReady, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);

  // Boot the terminal exactly once.
  useEffect(() => {
    let pty: PtySession | null = null;
    let disposed = false;
    const cleanups: Array<() => void> = [];

    (async () => {
      await document.fonts.load(`${FONT_SIZE}px "JetBrains Mono"`);
      if (disposed) return;

      const term = new Terminal({
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE,
        lineHeight: 1.25,
        theme: shadcnDark,
        cursorBlink: true,
        cursorStyle: "bar",
        cursorInactiveStyle: "outline",
        scrollback: 10_000,
        smoothScrollDuration: 80,
        allowProposedApi: true,
      });
      termRef.current = term;

      const fit = new FitAddon();
      fitRef.current = fit;
      term.loadAddon(fit);

      const search = new SearchAddon();
      term.loadAddon(search);

      term.loadAddon(
        new WebLinksAddon((_e, uri) => {
          openUrl(uri).catch(console.error);
        }),
      );

      term.open(containerRef.current!);
      fit.fit();

      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      try {
        term.loadAddon(webgl);
      } catch (e) {
        console.warn("WebGL renderer unavailable:", e);
      }

      onSearchReady?.(tabId, search);

      const session = await openPty(term.cols, term.rows, {
        onData: (bytes) => term.write(bytes),
        onExit: (code) => {
          term.write(`\r\n\x1b[2m[process exited: ${code}]\x1b[0m\r\n`);
          term.options.disableStdin = true;
          onExit?.(tabId, code);
        },
      });
      if (disposed) {
        session.close();
        return;
      }
      pty = session;

      term.onData((data) => pty?.write(data));
      term.onResize(({ cols, rows }) => pty?.resize(cols, rows));

      const onWinResize = () => fit.fit();
      window.addEventListener("resize", onWinResize);
      cleanups.push(() => window.removeEventListener("resize", onWinResize));

      if (visible) term.focus();
    })();

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
      pty?.close();
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When tab becomes visible, re-fit (dimensions may have changed while hidden)
  // and refocus the terminal.
  useEffect(() => {
    if (!visible) return;
    // Defer to next paint so layout has the new dimensions.
    const id = requestAnimationFrame(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [visible]);

  return (
    <div
      ref={containerRef}
      style={{
        display: visible ? "block" : "none",
        height: "100%",
        width: "100%",
      }}
    />
  );
}
