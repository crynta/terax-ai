import { buildTerminalTheme } from "@/styles/terminalTheme";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

type Options = {
  container: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  initialCwd?: string;
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
  onDetectedLocalUrl?: (url: string) => void;
};

// Matches dev-server-style local URLs (vite, next dev, webpack, …). Anchors
// on a word boundary so we don't catch substrings of longer paths.
const LOCAL_URL_RE =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{1,5})?(?:\/[^\s\x1b]*)?/g;

export function useTerminalSession({
  container,
  visible,
  initialCwd,
  onSearchReady,
  onExit,
  onCwd,
  onDetectedLocalUrl,
}: Options) {
  const detectedRef = useRef<string | null>(null);
  const onDetectedRef = useRef(onDetectedLocalUrl);
  const onCwdRef = useRef(onCwd);
  const onExitRef = useRef(onExit);
  const onSearchReadyRef = useRef(onSearchReady);
  useEffect(() => {
    onDetectedRef.current = onDetectedLocalUrl;
    onCwdRef.current = onCwd;
    onExitRef.current = onExit;
    onSearchReadyRef.current = onSearchReady;
  }, [onDetectedLocalUrl, onCwd, onExit, onSearchReady]);
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
        // 5k lines × 80 cols × ~16 B per cell ≈ 6 MB per tab. 10k doubled
        // that for output almost no one scrolls back to. Keep this knob in
        // mind if/when we add a "scrollback" preference.
        scrollback: 5_000,
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
        registerCwdHandler(term, (cwd) => onCwdRef.current?.(cwd)),
        prompt.dispose,
      );
      onSearchReadyRef.current?.(search);

      // Per-session decoder so interleaved chunks across tabs don't splice
      // a multi-byte UTF-8 codepoint between unrelated streams.
      const urlDecoder = new TextDecoder("utf-8", { fatal: false });

      const pty = await openPty(
        term.cols,
        term.rows,
        {
          onData: (bytes) => {
            term.write(bytes);
            // Sniff for dev-server URLs in raw output. Byte-level prefilter
            // (':' '/' '/') skips decode+regex on the overwhelming majority
            // of chunks (ordinary terminal output, log tails, test runs).
            if (onDetectedRef.current && containsSchemeSeparator(bytes)) {
              const text = urlDecoder.decode(bytes, { stream: true });
              const matches = text.match(LOCAL_URL_RE);
              if (matches && matches.length > 0) {
                const url = stripTrailingPunct(matches[matches.length - 1]);
                if (url && url !== detectedRef.current) {
                  detectedRef.current = url;
                  onDetectedRef.current(url);
                }
              }
            }
          },
          onCwd: (cwd) => onCwdRef.current?.(cwd),
          onExit: (code) => {
            term.write(`\r\n\x1b[2m[process exited: ${code}]\x1b[0m\r\n`);
            term.options.disableStdin = true;
            onExitRef.current?.(code);
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

      // Intercept clipboard image pastes at the capture phase so xterm's
      // internal textarea never sees them. When the clipboard has an image
      // (no text), xterm sends nothing to the PTY — Claude Code and other
      // CLIs never learn a paste was attempted. Instead we write the image
      // to a temp file and paste the path into the PTY.
      const handleImagePaste = async (event: ClipboardEvent) => {
        const active = document.activeElement;
        // Only act when focus is inside our terminal container.
        const termEl = container.current;
        if (!termEl || (!termEl.contains(active) && active !== termEl)) return;

        const items = Array.from(event.clipboardData?.items ?? []);
        const imgItem = items.find((i) => i.type.startsWith("image/"));
        if (!imgItem) return; // text/other paste — let xterm handle normally

        event.preventDefault();
        event.stopImmediatePropagation();

        try {
          const blob = imgItem.getAsFile();
          if (!blob) return;
          const buf = await blob.arrayBuffer();
          const u8 = new Uint8Array(buf);

          // btoa via String.fromCharCode has a call-stack limit on large
          // images, so we chunk the conversion.
          let binary = "";
          const chunk = 8_192;
          for (let i = 0; i < u8.length; i += chunk) {
            binary += String.fromCharCode(...u8.subarray(i, i + chunk));
          }

          const ext =
            (imgItem.type.split("/")[1] ?? "png").replace("jpeg", "jpg");
          const path = await invoke<string>("write_temp_image", {
            data: btoa(binary),
            ext,
          });
          ptyRef.current?.write(path);
        } catch (err) {
          console.error("[terax] image paste failed:", err);
        }
      };

      document.addEventListener("paste", handleImagePaste, { capture: true });
      cleanups.push(() =>
        document.removeEventListener("paste", handleImagePaste, {
          capture: true,
        }),
      );

      // ── Drag-and-drop image support ──────────────────────────────────────
      // Two channels are needed:
      //   1. Tauri native drop — fires for files dragged from Finder/Explorer.
      //      Tauri intercepts these before HTML5 events, but gives us the real
      //      filesystem path so no temp-file write is required.
      //   2. HTML5 drop — fires for images dragged from a browser window.
      //      Here we read the bytes and write to a temp file (same path as paste).

      // Reusable helper: encode an ArrayBuffer as base64 without exceeding the
      // call-stack limit that `String.fromCharCode(...largeArray)` would hit.
      const arrayBufferToBase64 = (buf: ArrayBuffer): string => {
        const u8 = new Uint8Array(buf);
        let binary = "";
        const chunk = 8_192;
        for (let i = 0; i < u8.length; i += chunk) {
          binary += String.fromCharCode(...u8.subarray(i, i + chunk));
        }
        return btoa(binary);
      };

      const IMAGE_EXT_RE =
        /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|ico|heic|avif)$/i;

      // 1. Tauri native file-drop (Finder → terminal).
      //    The payload contains actual filesystem paths — paste the image path
      //    directly without creating a temp copy.
      const unlistenDrop = await listen<{
        paths: string[];
        position: { x: number; y: number };
      }>("tauri://drag-drop", (event) => {
        const termEl = container.current;
        if (!termEl) return;

        const { paths, position } = event.payload;
        if (!paths?.length) return;

        // Tauri positions are in physical pixels; convert to CSS pixels.
        const dpr = window.devicePixelRatio || 1;
        const lx = position.x / dpr;
        const ly = position.y / dpr;
        const rect = termEl.getBoundingClientRect();
        if (lx < rect.left || lx > rect.right || ly < rect.top || ly > rect.bottom)
          return;

        const imgPath = paths.find((p) => IMAGE_EXT_RE.test(p));
        if (!imgPath) return;

        ptyRef.current?.write(imgPath);
      });
      cleanups.push(unlistenDrop);

      // 2. HTML5 drop (image dragged from browser / other web source).
      const handleDragOver = (event: DragEvent) => {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      };

      const handleDrop = async (event: DragEvent) => {
        event.preventDefault();
        const files = Array.from(event.dataTransfer?.files ?? []);
        const imgFile = files.find((f) => f.type.startsWith("image/"));
        if (!imgFile) return;

        try {
          const buf = await imgFile.arrayBuffer();
          const ext = (imgFile.type.split("/")[1] ?? "png").replace(
            "jpeg",
            "jpg",
          );
          const path = await invoke<string>("write_temp_image", {
            data: arrayBufferToBase64(buf),
            ext,
          });
          ptyRef.current?.write(path);
        } catch (err) {
          console.error("[terax] image drop failed:", err);
        }
      };

      const dropTarget = container.current;
      dropTarget.addEventListener("dragover", handleDragOver);
      dropTarget.addEventListener("drop", handleDrop);
      cleanups.push(() => {
        dropTarget.removeEventListener("dragover", handleDragOver);
        dropTarget.removeEventListener("drop", handleDrop);
      });

      // Two-stage debounce:
      //  - FIT runs frequently (~one frame) so xterm visually keeps up with
      //    the window during drag. Local, no IPC.
      //  - PTY_RESIZE only fires on the trailing edge of the drag, because
      //    SIGWINCH is what causes shells / fancy prompts (powerlevel10k,
      //    starship) to redraw mid-resize, which the user perceives as
      //    blinking. The shell only cares about the FINAL size.
      const FIT_DEBOUNCE_MS = 8;
      const PTY_RESIZE_DEBOUNCE_MS = 256;
      let lastSentCols = term.cols;
      let lastSentRows = term.rows;
      let lastW = container.current.clientWidth;
      let lastH = container.current.clientHeight;
      let fitTimer: ReturnType<typeof setTimeout> | null = null;
      let ptyTimer: ReturnType<typeof setTimeout> | null = null;

      const el = container.current;
      const flushPtyResize = () => {
        ptyTimer = null;
        if (disposed) return;
        if (term.cols === lastSentCols && term.rows === lastSentRows) return;
        lastSentCols = term.cols;
        lastSentRows = term.rows;
        pty.resize(term.cols, term.rows);
      };

      const observer = new ResizeObserver(() => {
        if (fitTimer) clearTimeout(fitTimer);
        fitTimer = setTimeout(() => {
          fitTimer = null;
          if (disposed) return;
          const w = el.clientWidth;
          const h = el.clientHeight;
          if (w === lastW && h === lastH) return;
          lastW = w;
          lastH = h;
          fit.fit();
          // Schedule (or re-schedule) a single trailing pty.resize. The
          // shell sees one SIGWINCH after the drag settles, not 60+/s.
          if (ptyTimer) clearTimeout(ptyTimer);
          ptyTimer = setTimeout(flushPtyResize, PTY_RESIZE_DEBOUNCE_MS);
        }, FIT_DEBOUNCE_MS);
      });
      observer.observe(el);
      cleanups.push(() => {
        observer.disconnect();
        if (fitTimer) clearTimeout(fitTimer);
        if (ptyTimer) clearTimeout(ptyTimer);
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

  const getBuffer = useCallback((maxLines = 200): string | null => {
    const t = termRef.current;
    if (!t) return null;
    const buf = t.buffer.active;
    const total = buf.length;
    const lines: string[] = [];
    const start = Math.max(0, total - maxLines);
    for (let i = start; i < total; i++) {
      lines.push(buf.getLine(i)?.translateToString(true) ?? "");
    }
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  }, []);

  const getSelection = useCallback((): string | null => {
    const sel = termRef.current?.getSelection() ?? "";
    return sel.length > 0 ? sel : null;
  }, []);

  const applyTheme = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = buildTerminalTheme();
  }, []);

  return { write, focus, getBuffer, getSelection, applyTheme };
}

function stripTrailingPunct(url: string): string {
  return url.replace(/[.,);\]]+$/, "");
}

// Looks for the literal byte sequence ":" "/" "/" — the cheapest signal
// that a chunk *might* contain a URL. Avoids per-chunk UTF-8 decode + regex
// scan when running noisy commands.
function containsSchemeSeparator(bytes: Uint8Array): boolean {
  const n = bytes.length;
  for (let i = 0; i < n - 2; i++) {
    if (bytes[i] === 0x3a && bytes[i + 1] === 0x2f && bytes[i + 2] === 0x2f) {
      return true;
    }
  }
  return false;
}
