import { detectMonoFontFamily } from "@/lib/fonts";
import { buildTerminalTheme } from "@/styles/terminalTheme";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { dbgTerminalAc, isTerminalAutocompleteDebug } from "./autocomplete/debug";
import {
  createThrottle,
  getPromptLineDiagnostics,
  isOnPromptLine,
} from "./autocomplete/extractPrefix";
import { STATIC_COMMAND_LINES } from "./autocomplete/staticCommands";
import { HistoryRing } from "./autocomplete/historyRing";
import { cursorPixelOffset, measureCellMetrics } from "./autocomplete/measureTerminal";
import { rankSuggestions } from "./autocomplete/rankSuggestions";
import { UserInputAccumulator } from "./autocomplete/userInputAccumulator";
import {
  registerCwdHandler,
  registerShellIntegrationMarkers,
  registerTeraxOpenHandler,
  type TeraxOpenInput,
} from "./osc-handlers";
import { openPty, type PtySession } from "./pty-bridge";
import type { TerminalAutocompleteUiModel } from "./autocomplete/types";

export type { TeraxOpenInput };

const FONT_SIZE = 14;

type Options = {
  container: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  initialCwd?: string;
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
  onDetectedLocalUrl?: (url: string) => void;
  onTeraxOpen?: (input: TeraxOpenInput) => void;
  /** When unset, terminal autocomplete UI is off. */
  getTerminalAutocompleteEnabled?: () => boolean;
  onTerminalAutocompleteModel?: (model: TerminalAutocompleteUiModel | null) => void;
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
  onTeraxOpen,
  getTerminalAutocompleteEnabled,
  onTerminalAutocompleteModel,
}: Options) {
  const detectedRef = useRef<string | null>(null);
  const onDetectedRef = useRef(onDetectedLocalUrl);
  const onCwdRef = useRef(onCwd);
  const onExitRef = useRef(onExit);
  const onSearchReadyRef = useRef(onSearchReady);
  const onTeraxOpenRef = useRef(onTeraxOpen);
  const getAcEnabledRef = useRef(getTerminalAutocompleteEnabled);
  const onAcModelRef = useRef(onTerminalAutocompleteModel);
  const autocompletePickRef = useRef<(index: number) => void>(() => {});
  useEffect(() => {
    onDetectedRef.current = onDetectedLocalUrl;
    onCwdRef.current = onCwd;
    onExitRef.current = onExit;
    onSearchReadyRef.current = onSearchReady;
    onTeraxOpenRef.current = onTeraxOpen;
    getAcEnabledRef.current = getTerminalAutocompleteEnabled;
    onAcModelRef.current = onTerminalAutocompleteModel;
  }, [
    onDetectedLocalUrl,
    onCwd,
    onExit,
    onSearchReady,
    onTeraxOpen,
    getTerminalAutocompleteEnabled,
    onTerminalAutocompleteModel,
  ]);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyRef = useRef<PtySession | null>(null);

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    // Deferred a tick so any same-commit mount → cleanup → mount sequence
    // (HMR/dev-only effects) cancels the first spawn before it reaches Rust.
    const startTimer = setTimeout(() => {
      if (disposed || !container.current) return;
      void start();
    }, 0);

    const start = async () => {
      await document.fonts.ready;
      if (disposed || !container.current) return;

      const term = new Terminal({
        fontFamily: detectMonoFontFamily(),
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

      const el = container.current;
      if (!el) return;
      const acLayoutRoot =
        el.offsetParent instanceof HTMLElement ? el.offsetParent : el;

      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch (e) {
        console.warn("WebGL renderer unavailable:", e);
      }

      const historyRing = new HistoryRing();
      const acc = new UserInputAccumulator();
      const throttleAcFromPty = createThrottle(48);
      let acSelectedIdx = 0;
      /** Multi-match list was closed with Esc; ghost-only until another Esc snoozes. */
      let acDropdownDismissed = false;
      /** Esc twice: no autocomplete UI until the next shell prompt. */
      let acSnoozedUntilPrompt = false;
      let acPublishRaf: number | null = null;
      const lastAcModelRef: { current: TerminalAutocompleteUiModel | null } = {
        current: null,
      };

      const acEnabled = () => getAcEnabledRef.current?.() ?? false;

      const publishAcModel = (m: TerminalAutocompleteUiModel | null) => {
        lastAcModelRef.current = m;
        if (acPublishRaf != null) cancelAnimationFrame(acPublishRaf);
        acPublishRaf = requestAnimationFrame(() => {
          acPublishRaf = null;
          onAcModelRef.current?.(lastAcModelRef.current);
        });
      };

      const shellMarkers = registerShellIntegrationMarkers(term, {
        onPromptStart: () => {
          acc.clear();
          acSelectedIdx = 0;
          acDropdownDismissed = false;
          acSnoozedUntilPrompt = false;
          publishAcModel(null);
        },
      });

      const recomputeAutocomplete = () => {
        if (!acEnabled()) {
          publishAcModel(null);
          return;
        }
        if (acSnoozedUntilPrompt) {
          publishAcModel(null);
          return;
        }
        if (isTerminalAutocompleteDebug()) {
          const d = getPromptLineDiagnostics(term, shellMarkers);
          dbgTerminalAc("recompute", {
            ...d,
            prefix: acc.get(),
            cols: term.cols,
            rows: term.rows,
          });
        }
        if (!isOnPromptLine(term, shellMarkers)) {
          publishAcModel(null);
          return;
        }
        const prefix = acc.get();
        if (prefix.length === 0) {
          acDropdownDismissed = false;
          publishAcModel(null);
          return;
        }
        const hist = historyRing.matchPrefix(prefix, 24);
        const ranked = rankSuggestions(prefix, hist, STATIC_COMMAND_LINES);
        if (ranked.length === 0) {
          publishAcModel(null);
          return;
        }
        acSelectedIdx = Math.min(Math.max(acSelectedIdx, 0), ranked.length - 1);
        const line = ranked[acSelectedIdx] ?? ranked[0];
        const suggestionsOut =
          acDropdownDismissed && ranked.length > 1 ? [line] : ranked;
        const si = Math.min(acSelectedIdx, suggestionsOut.length - 1);
        const primary = suggestionsOut[si] ?? suggestionsOut[0];
        const ghost =
          primary.toLowerCase().startsWith(prefix.toLowerCase()) &&
          primary.length > prefix.length
            ? primary.slice(prefix.length)
            : "";
        const m = measureCellMetrics(term, acLayoutRoot);
        const cur = cursorPixelOffset(term, m);
        publishAcModel({
          ghostSuffix: ghost,
          suggestions: suggestionsOut,
          selectedIndex: si,
          anchorLeft: cur.left,
          anchorTop: cur.top,
          cellH: m.cellH,
          fontFamily: term.options.fontFamily ?? "monospace",
          fontSize: term.options.fontSize ?? FONT_SIZE,
        });
      };

      const applyCompletionIndex = (index: number) => {
        if (!acEnabled()) return;
        const prefix = acc.get();
        const hist = historyRing.matchPrefix(prefix, 24);
        const ranked = rankSuggestions(prefix, hist, STATIC_COMMAND_LINES);
        if (ranked.length === 0) return;
        const pick = ranked[Math.min(Math.max(index, 0), ranked.length - 1)];
        if (!pick || !pick.toLowerCase().startsWith(prefix.toLowerCase())) return;
        if (pick.length <= prefix.length) return;
        const suf = pick.slice(prefix.length);
        pty.write(suf);
        acc.set(pick);
        acSelectedIdx = 0;
        acDropdownDismissed = false;
        publishAcModel(null);
        requestAnimationFrame(() => {
          if (acEnabled()) recomputeAutocomplete();
        });
      };

      autocompletePickRef.current = applyCompletionIndex;

      cleanups.push(
        registerCwdHandler(term, (cwd) => onCwdRef.current?.(cwd)),
        registerTeraxOpenHandler(term, (input) => onTeraxOpenRef.current?.(input)),
        shellMarkers.dispose,
        () => {
          if (acPublishRaf != null) cancelAnimationFrame(acPublishRaf);
          publishAcModel(null);
        },
      );

      term.attachCustomKeyEventHandler((ev) => {
        if (!acEnabled()) return true;
        if (ev.type !== "keydown") return true;
        const dom = ev as unknown as KeyboardEvent;

        if (dom.key === "Escape") {
          if (!isOnPromptLine(term, shellMarkers)) return true;
          if (acSnoozedUntilPrompt) return true;

          const modelEsc = lastAcModelRef.current;
          const hasOpenDropdown = modelEsc && modelEsc.suggestions.length > 1;

          if (hasOpenDropdown) {
            acDropdownDismissed = true;
            recomputeAutocomplete();
            return false;
          }

          if (acDropdownDismissed && acc.get().length > 0) {
            acSnoozedUntilPrompt = true;
            acDropdownDismissed = false;
            acSelectedIdx = 0;
            publishAcModel(null);
            return false;
          }

          if (
            modelEsc &&
            (modelEsc.suggestions.length > 0 || modelEsc.ghostSuffix.length > 0)
          ) {
            acSnoozedUntilPrompt = true;
            acDropdownDismissed = false;
            acSelectedIdx = 0;
            publishAcModel(null);
            return false;
          }

          return true;
        }

        const model = lastAcModelRef.current;
        if (!model || model.suggestions.length === 0) return true;
        if (model.suggestions.length > 1 && dom.key === "ArrowDown") {
          dom.preventDefault();
          acSelectedIdx = Math.min(acSelectedIdx + 1, model.suggestions.length - 1);
          recomputeAutocomplete();
          return false;
        }
        if (model.suggestions.length > 1 && dom.key === "ArrowUp") {
          dom.preventDefault();
          acSelectedIdx = Math.max(acSelectedIdx - 1, 0);
          recomputeAutocomplete();
          return false;
        }
        if (dom.key === "Tab" && !dom.shiftKey) {
          const prefix = acc.get();
          const pick =
            model.suggestions[
              Math.min(acSelectedIdx, model.suggestions.length - 1)
            ];
          if (
            pick &&
            pick.toLowerCase().startsWith(prefix.toLowerCase()) &&
            pick.length > prefix.length
          ) {
            dom.preventDefault();
            applyCompletionIndex(acSelectedIdx);
            return false;
          }
        }
        return true;
      });
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
            if (acEnabled()) throttleAcFromPty(recomputeAutocomplete);
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

      term.onData((data) => {
        if (getAcEnabledRef.current?.()) {
          const { submitted, submittedLine } = acc.applyUserData(data);
          if (submitted && submittedLine) historyRing.push(submittedLine);
          if (submitted) {
            acDropdownDismissed = false;
            acSnoozedUntilPrompt = false;
          }
          acSelectedIdx = 0;
          recomputeAutocomplete();
        }
        pty.write(data);
        if (getAcEnabledRef.current?.()) {
          throttleAcFromPty(recomputeAutocomplete);
        }
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
          if (acEnabled()) recomputeAutocomplete();
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
    };

    return () => {
      disposed = true;
      clearTimeout(startTimer);
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

  const applyAutocompletePick = useCallback((index: number) => {
    autocompletePickRef.current(index);
  }, []);

  return { write, focus, getBuffer, getSelection, applyTheme, applyAutocompletePick };
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
