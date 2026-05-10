import type { Terminal } from "@xterm/xterm";
import type { ShellIntegrationMarkers } from "../osc-handlers";

/** Strip CSI SGR / cursor sequences and OSC strings for heuristics. */
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[\d;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][\d;?:]*[^\x07]*\x07/g, "")
    .replace(/\x1b[\][()#%][\d@]/g, "")
    .replace(/\x1b./g, "");
}

/**
 * Absolute buffer line index for the cell under the cursor.
 * xterm's `cursorY` is viewport-relative (0..rows-1); `IMarker.line` is an
 * absolute index into the buffer (see xterm `ybase + y`). Comparing the two
 * directly always fails after scrollback grows — autocomplete would only work
 * by luck until `clear`.
 */
export function cursorAbsoluteBufferLine(term: Terminal): number {
  const buf = term.buffer.active;
  return buf.baseY + buf.cursorY;
}

export type PromptLineDiagnostics = {
  ok: boolean;
  cursorAbs: number;
  cursorViewportY: number;
  cursorX: number;
  baseY: number;
  viewportY: number;
  bufferLength: number;
  bLine: number | null;
  bDisposed: boolean;
  aLine: number | null;
  aDisposed: boolean;
};

/** Snapshot of prompt-line detection inputs (used by `isOnPromptLine`). */
export function getPromptLineDiagnostics(
  term: Terminal,
  markers: Pick<ShellIntegrationMarkers, "getPromptMarker" | "getInputStartMarker">,
): PromptLineDiagnostics {
  const buf = term.buffer.active;
  const cursorAbs = cursorAbsoluteBufferLine(term);
  const b = markers.getInputStartMarker();
  const a = markers.getPromptMarker();
  const bLine = b && !b.isDisposed ? b.line : null;
  const aLine = a && !a.isDisposed ? a.line : null;
  const ok =
    (bLine !== null && bLine === cursorAbs) ||
    (aLine !== null && aLine === cursorAbs);
  return {
    ok,
    cursorAbs,
    cursorViewportY: buf.cursorY,
    cursorX: buf.cursorX,
    baseY: buf.baseY,
    viewportY: buf.viewportY,
    bufferLength: buf.length,
    bLine,
    bDisposed: b?.isDisposed ?? true,
    aLine,
    aDisposed: a?.isDisposed ?? true,
  };
}

/**
 * True when the cursor sits on the current shell prompt input line.
 *
 * Prefer OSC 133 **B** (start of PS1); fall back to **A** if B is missing.
 * Always compares **absolute** buffer line indices (`baseY + cursorY` vs marker.line).
 */
export function isOnPromptLine(
  term: Terminal,
  markers: Pick<ShellIntegrationMarkers, "getPromptMarker" | "getInputStartMarker">,
): boolean {
  return getPromptLineDiagnostics(term, markers).ok;
}

export function createThrottle(ms: number): (fn: () => void) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRun = 0;
  return (fn: () => void) => {
    const now = performance.now();
    const elapsed = now - lastRun;
    if (elapsed >= ms) {
      lastRun = now;
      fn();
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      lastRun = performance.now();
      fn();
    }, ms - elapsed);
  };
}
