import { shadcnDark } from "@/themes";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { registerCwdHandler, registerPromptTracker } from "./osc-handlers";
import { openPty, type PtySession } from "./pty-bridge";

const FONT_FAMILY = '"JetBrains Mono", SFMono-Regular, Menlo, monospace';
const FONT_SIZE = 14;
const MAX_WRAP_WIPE_ROWS = 8;

type Options = {
  container: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
};

export function useTerminalSession({
  container,
  visible,
  onSearchReady,
  onExit,
  onCwd,
}: Options) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    let disposed = false;
    let pty: PtySession | null = null;
    const cleanups: Array<() => void> = [];

    (async () => {
      await document.fonts.load(`${FONT_SIZE}px "JetBrains Mono"`);
      if (disposed || !container.current) return;

      const term = new Terminal({
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE,
        lineHeight: 1.25,
        theme: shadcnDark,
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

      pty = await openPty(term.cols, term.rows, {
        onData: (bytes) => term.write(bytes),
        onExit: (code) => {
          term.write(`\r\n\x1b[2m[process exited: ${code}]\x1b[0m\r\n`);
          term.options.disableStdin = true;
          onExit?.(code);
        },
      });
      if (disposed) {
        pty.close();
        return;
      }

      term.onData((data) => pty?.write(data));
      term.onResize(({ cols, rows }) => pty?.resize(cols, rows));

      let rafId = 0;
      const onWinResize = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          fit.fit();
          wipeWrappedPrompt(term, prompt.getMarker());
        });
      };
      window.addEventListener("resize", onWinResize);
      cleanups.push(() => {
        window.removeEventListener("resize", onWinResize);
        if (rafId) cancelAnimationFrame(rafId);
      });

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

  useEffect(() => {
    if (!visible) return;
    const id = requestAnimationFrame(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [visible]);
}

function wipeWrappedPrompt(
  term: Terminal,
  marker: ReturnType<typeof registerPromptTracker>["getMarker"] extends () => infer T
    ? T
    : never,
) {
  if (!marker) return;
  const buf = term.buffer.active;
  if (buf.type !== "normal") return;
  const promptLine = marker.line;
  const cursorLine = buf.baseY + buf.cursorY;
  const delta = cursorLine - promptLine;
  if (delta <= 0 || delta > MAX_WRAP_WIPE_ROWS) return;
  term.write(`\x1b[${delta}A\r\x1b[J`);
}
