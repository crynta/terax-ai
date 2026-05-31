import { usePreferencesStore } from "@/modules/settings/preferences";
import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

// The ONLY pooled scarce resource.
//
// WHY: A browser/WKWebView allows only ~16 live WebGL contexts before it starts
// silently dropping the oldest. Under the persistent-buffer model there is one
// emulator per leaf for life (could be 10/30/50), so we CANNOT give every
// emulator its own GL context. We pool the GPU: only the visible + top leaves
// get a WebglAddon; everyone else falls back to xterm's DOM renderer (still
// correct — it reads the same live buffer). This is the VS Code / iTerm2 /
// Windows Terminal model: buffer is persistent, GPU acceleration is a view
// concern granted to what's on screen.
//
// WHEN: grantPolicy() is recomputed whenever the set of visible/top leaves
// changes (attach/detach/focus). attachWebgl/disposeWebgl move a single
// emulator in/out of GPU acceleration. WebglAddon.dispose() never leaves a
// Terminal renderer-less — it swaps in the DOM renderer (verified in installed
// addon-webgl.js: setRenderer + _createRenderer). releaseCanvasContext() is
// called on every revoke to free the GL context under the ~16 ceiling.
//
// HOW: grantPolicy is a PURE function (no canvas, no DOM) so the cap + priority
// invariant is unit-tested in node. The WebglAddon attach/dispose itself is
// the UI-exempt side and is moved verbatim from the old rendererPool.

// Repurposed POOL_MAX_SIZE: the hard cap on live WebGL contexts. Visible +
// top leaves beyond this fall back to the DOM renderer.
export const MAX_GL_CONTEXTS = 5;

const WEBGL_RECOVERY_DELAY_MS = 250;

export type GlLeafState = {
  leafId: number;
  /** Leaf is on screen (its tab is active and its host is attached). */
  visible: boolean;
  /** Leaf is the focused/top pane within its visible tab. */
  isTop: boolean;
};

/**
 * Pure GL-grant policy: given the current leaf states, return the set of
 * leafIds that should hold a live WebGL context.
 *
 * Rules (in priority order, never exceeding MAX_GL_CONTEXTS):
 *   1. Only VISIBLE leaves are eligible (a hidden leaf renders nothing).
 *   2. Among visible leaves, TOP (focused) leaves are granted first.
 *   3. Remaining slots go to the other visible leaves by leafId order
 *      (stable, deterministic — avoids grant/revoke churn).
 *
 * Over-cap or non-visible leaves are NOT in the returned set and fall back to
 * the DOM renderer.
 */
export function grantPolicy(
  leaves: readonly GlLeafState[],
  cap = MAX_GL_CONTEXTS,
): Set<number> {
  const granted = new Set<number>();
  if (cap <= 0) return granted;
  const visible = leaves.filter((l) => l.visible);
  const top = visible
    .filter((l) => l.isTop)
    .sort((a, b) => a.leafId - b.leafId);
  const rest = visible
    .filter((l) => !l.isTop)
    .sort((a, b) => a.leafId - b.leafId);
  for (const l of [...top, ...rest]) {
    if (granted.size >= cap) break;
    granted.add(l.leafId);
  }
  return granted;
}

export type GlAttachment = {
  addon: WebglAddon;
  canvases: HTMLCanvasElement[];
};

/**
 * Attach a WebGL renderer to a Terminal. Returns the attachment so the caller
 * can later dispose it. No-op (returns null) if WebGL is disabled in prefs, the
 * term has no element yet, or attach throws (falls back to DOM renderer).
 *
 * Moved verbatim from rendererPool.attachWebgl, generalized to take a Terminal
 * + an onContextLoss recovery callback instead of a Slot.
 */
export function attachWebgl(
  term: Terminal,
  onLost: () => void,
): GlAttachment | null {
  if (!term.element) return null;
  if (!usePreferencesStore.getState().terminalWebglEnabled) return null;
  const elem = term.element;
  const before = new Set<HTMLCanvasElement>(
    elem.querySelectorAll<HTMLCanvasElement>("canvas"),
  );
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      try {
        webgl.dispose();
      } catch {}
      // Recovery: WebKit may transiently lose contexts on sleep/wake or GPU
      // reset; without re-attach the leaf would silently stay on the DOM
      // renderer forever. Defer past WebKit's reset window before retrying.
      setTimeout(() => {
        if (!usePreferencesStore.getState().terminalWebglEnabled) return;
        onLost();
      }, WEBGL_RECOVERY_DELAY_MS);
    });
    term.loadAddon(webgl);
    const after = elem.querySelectorAll<HTMLCanvasElement>("canvas");
    const added: HTMLCanvasElement[] = [];
    for (const c of after) if (!before.has(c)) added.push(c);
    return { addon: webgl, canvases: added };
  } catch (e) {
    console.warn("[terax-webgl] unavailable:", e);
    return null;
  }
}

/**
 * Dispose a WebGL attachment, freeing its GL context. The Terminal falls back
 * to the DOM renderer automatically (WebglAddon.dispose -> setRenderer). Moved
 * verbatim from rendererPool.disposeSlotWebgl.
 */
export function disposeWebgl(attachment: GlAttachment | null): void {
  if (!attachment) return;
  const { addon, canvases } = attachment;
  for (const canvas of canvases) releaseCanvasContext(canvas);
  try {
    addon.dispose();
  } catch (e) {
    console.warn("[terax-webgl] dispose failed:", e);
  }
  try {
    const r = (
      addon as unknown as { _renderer?: Record<string, unknown> | null }
    )._renderer;
    if (r) {
      r._canvas = null;
      r._gl = null;
      r._charAtlas = null;
      r._atlas = null;
    }
    (
      addon as unknown as { _renderer?: unknown; _renderService?: unknown }
    )._renderer = null;
    (
      addon as unknown as { _renderer?: unknown; _renderService?: unknown }
    )._renderService = null;
  } catch {}
}

/**
 * Injectable GL backend — the seam emulator.grantGl/revokeGl route through.
 *
 * WHY: a real WebGL context can only be allocated when the Terminal has a live
 * DOM element (attachWebgl early-returns null otherwise), so the strict-cap
 * invariant cannot be observed in a headless (node) test against real
 * emulators. This seam lets a test substitute a counting backend that records
 * concurrent live contexts WITHOUT a DOM/GPU, exercising the real
 * ensureEmulator/attachView/recomputeGl grant path. Production uses the default
 * backend (attachWebgl/disposeWebgl) verbatim — behavior is unchanged.
 */
export type GlBackend = {
  attach(term: Terminal, onLost: () => void): GlAttachment | null;
  dispose(attachment: GlAttachment | null): void;
};

const defaultGlBackend: GlBackend = {
  attach: attachWebgl,
  dispose: disposeWebgl,
};

let glBackend: GlBackend = defaultGlBackend;

export function getGlBackend(): GlBackend {
  return glBackend;
}

/** TEST-ONLY: swap the GL backend. Pass null to restore the production default. */
export function __setGlBackendForTest(backend: GlBackend | null): void {
  glBackend = backend ?? defaultGlBackend;
}

/**
 * Force-free a canvas's WebGL context via WEBGL_lose_context so the browser
 * reclaims it immediately rather than at GC time — critical for staying under
 * the ~16-context ceiling. Moved verbatim from rendererPool.releaseCanvasContext.
 */
export function releaseCanvasContext(canvas: HTMLCanvasElement): void {
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
      if (ext && !gl.isContextLost()) ext.loseContext();
    } catch {}
  }
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {}
}
