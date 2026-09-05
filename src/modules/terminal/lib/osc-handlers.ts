import { IS_WINDOWS } from "@/lib/platform";
import { readTerminalTokens } from "@/styles/tokens";
import type { IMarker, Terminal } from "@xterm/xterm";
import { getLiveSlotForLeaf, poolSlotStats } from "./rendererPool";

const MAX_OSC52_CLIPBOARD_BYTES = 1024 * 1024;

/**
 * Cross-handler state shared between the OSC 7 cwd handler and the OSC 133
 * prompt-marker handler. Tracks whether we are currently inside a running
 * command (between OSC 133 B and the next OSC 133 D / A), so the cwd handler
 * can ignore OSC 7 updates emitted by *command output* (e.g. a remote SSH
 * server, a `cat` of an attacker-controlled file). Only OSC 7 issued by the
 * local shell — which fires between commands — should be honored.
 */
export type ShellIntegrationState = {
  inCommand: boolean;
};

export function createShellIntegrationState(): ShellIntegrationState {
  return { inCommand: false };
}

export function registerCwdHandler(
  term: Terminal,
  onCwd: (cwd: string) => void,
  state?: ShellIntegrationState,
): () => void {
  const d = term.parser.registerOscHandler(7, (data) => {
    // Reject OSC 7 emitted while a command is running: command stdout/stderr
    // is untrusted (it can come from a remote shell, an SSH session, a `cat`
    // of attacker-controlled bytes). The local shell only emits OSC 7
    // between commands via its precmd/PROMPT_COMMAND hook.
    if (state?.inCommand) return true;
    const cwd = parseOsc7(data);
    if (cwd) onCwd(cwd);
    return true;
  });
  return () => d.dispose();
}

export type PromptTracker = {
  getMarker: () => IMarker | null;
  dispose: () => void;
};

export function registerPromptTracker(
  term: Terminal,
  state?: ShellIntegrationState,
  // Fires on C (process executing) and A/D (back at prompt). Distinct from
  // inCommand, which is already true from B while the user merely types.
  onCommandState?: (running: boolean) => void,
): PromptTracker {
  let marker: IMarker | null = null;
  const d = term.parser.registerOscHandler(133, (data) => {
    // OSC 133 A — start of new prompt (between commands).
    if (data.startsWith("A")) {
      if (state) state.inCommand = false;
      onCommandState?.(false);
      marker?.dispose();
      marker = term.registerMarker(0);
    } else if (data.startsWith("B")) {
      // OSC 133 B — command begins. From here on, treat all output as
      // untrusted until we see D (command exit) or the next A (new prompt).
      if (state) state.inCommand = true;
    } else if (data.startsWith("C")) {
      // OSC 133 C — command pre-execution marker; still inside command.
      if (state) state.inCommand = true;
      onCommandState?.(true);
    } else if (data.startsWith("D")) {
      // OSC 133 D — command ends.
      if (state) state.inCommand = false;
      onCommandState?.(false);
    }
    return true;
  });
  return {
    getMarker: () => (marker && !marker.isDisposed ? marker : null),
    dispose: () => {
      d.dispose();
      marker?.dispose();
      marker = null;
    },
  };
}

export type ClipboardWriter = (text: string) => void | Promise<void>;

// Resolved lazily to break the useTerminalSession ↔ osc-handlers import cycle.
let writeToSessionFn: ((leafId: number, data: string) => boolean) | null =
  null;

function leafIdForTerm(term: Terminal): number | null {
  for (const slot of poolSlotStats()) {
    const id = slot.leafId ?? slot.retainedLeafId;
    if (id === null) continue;
    if (getLiveSlotForLeaf(id)?.term === term) return id;
  }
  return null;
}

function writePtyForTerm(term: Terminal, data: string): void {
  const leafId = leafIdForTerm(term);
  if (leafId === null) return;
  if (!writeToSessionFn) {
    void import("./useTerminalSession").then((m) => {
      writeToSessionFn = m.writeToSession;
      writeToSessionFn(leafId, data);
    });
    return;
  }
  writeToSessionFn(leafId, data);
}

export function registerOsc52ClipboardHandler(
  term: Terminal,
  writeClipboard: ClipboardWriter = writeSystemClipboard,
): () => void {
  const d = term.parser.registerOscHandler(52, (data) => {
    const text = parseOsc52Clipboard(data);
    if (text === null) return true;
    queueMicrotask(() => {
      try {
        void Promise.resolve(writeClipboard(text)).catch(() => {});
      } catch {}
    });
    return true;
  });
  // Claude Code / Codex theme=auto prefer OSC 11/10 replies. Wire here so
  // every existing registerOsc52 call site answers without a large
  // useTerminalSession rewrite.
  const colorQuery = registerOscColorQueryHandlers(term, {
    writePty: (data) => writePtyForTerm(term, data),
    getBg: () => parseCssRgb(readTerminalTokens().background),
    getFg: () => parseCssRgb(readTerminalTokens().foreground),
  });
  return () => {
    d.dispose();
    colorQuery();
  };
}

export type OscRgb = { r: number; g: number; b: number };

/**
 * Parse CSS color strings that `getComputedStyle` (and our theme tokens)
 * commonly yield: `rgb()`, `rgba()`, `#rgb`, `#rrggbb`.
 */
export function parseCssRgb(css: string): OscRgb | null {
  const s = css.trim();
  const rgb = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgb) {
    return {
      r: clampByte(Number(rgb[1])),
      g: clampByte(Number(rgb[2])),
      b: clampByte(Number(rgb[3])),
    };
  }
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return null;
  const h = hex[1];
  if (h.length === 3) {
    return {
      r: Number.parseInt(h[0] + h[0], 16),
      g: Number.parseInt(h[1] + h[1], 16),
      b: Number.parseInt(h[2] + h[2], 16),
    };
  }
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

/** Format an 8-bit RGB triple as OSC `rgb:RRRR/GGGG/BBBB` (16-bit hex). */
export function formatOscRgb({ r, g, b }: OscRgb): string {
  const to16 = (n: number) => {
    const hx = clampByte(n).toString(16).padStart(2, "0").toUpperCase();
    return hx + hx;
  };
  return `rgb:${to16(r)}/${to16(g)}/${to16(b)}`;
}

export type OscColorQueryOpts = {
  writePty: (data: string) => void;
  getFg: () => OscRgb | null;
  getBg: () => OscRgb | null;
};

/**
 * Answer OSC 10 (fg) / OSC 11 (bg) color queries so Claude Code / Codex
 * `theme=auto` can match Terax Light/Dark instead of falling through to OS
 * appearance. Non-query payloads are consumed without restyling xterm.
 */
export function registerOscColorQueryHandlers(
  term: Terminal,
  opts: OscColorQueryOpts,
): () => void {
  const makeHandler =
    (osc: 10 | 11, getColor: () => OscRgb | null) =>
    (data: string): boolean => {
      if (data === "?" || data.startsWith("?")) {
        const color = getColor();
        if (color) {
          opts.writePty(`\x1b]${osc};${formatOscRgb(color)}\x07`);
        }
        return true;
      }
      // Apps sometimes SET colors via OSC 10/11; ignore — Terax owns the theme.
      return true;
    };

  const d10 = term.parser.registerOscHandler(10, makeHandler(10, opts.getFg));
  const d11 = term.parser.registerOscHandler(11, makeHandler(11, opts.getBg));
  return () => {
    d10.dispose();
    d11.dispose();
  };
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.trunc(n)));
}

function parseOsc7(data: string): string | null {
  const m = data.match(/^file:\/\/[^/]*(\/.*)$/);
  if (!m) return null;
  let path = m[1];
  try {
    path = decodeURIComponent(path);
  } catch {}
  // /C:/Users/foo -> C:/Users/foo so it's a valid Windows path.
  if (/^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1);
  } else if (IS_WINDOWS) {
    // git-bash (MSYS) reports cwd as /c/Users/foo; map it to C:/Users/foo.
    const drive = path.match(/^\/([A-Za-z])(\/.*)?$/);
    if (drive) path = `${drive[1].toUpperCase()}:${drive[2] ?? "/"}`;
  }
  return path;
}

function parseOsc52Clipboard(data: string): string | null {
  const parts = data.split(";");
  if (parts.length < 2) return null;
  const selection = parts[0] || "c";
  if (!selection.includes("c")) return null;
  const encoded = parts.slice(1).join(";");
  if (!encoded || encoded === "?") return null;
  if (encoded.length > Math.ceil((MAX_OSC52_CLIPBOARD_BYTES * 4) / 3) + 4) {
    return null;
  }
  const compact = encoded.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return null;

  try {
    const bytes = Uint8Array.from(atob(compact), (c) => c.charCodeAt(0));
    if (bytes.byteLength > MAX_OSC52_CLIPBOARD_BYTES) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function writeSystemClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
