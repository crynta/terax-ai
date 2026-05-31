// terminalPool — persistent-buffer / pooled-GPU terminal renderer.
//
// Slim barrel/coordinator. Composes the focused children and re-exports the
// public API consumed by useTerminalSession. No logic lives here.
//
// Model (see README.md): ONE persistent @xterm Terminal per leafId for its
// whole lifetime, always fed PTY bytes. Tab switch = pure view op (attach/detach
// the host). Only the scarce WebGL contexts are pooled (glContextPool, cap
// MAX_GL_CONTEXTS). No serialize, no DormantRing, no clear()+reset() on switch.

export {
  configureEmulatorAdapter,
  disposeEmulator,
  ensureEmulator,
  emulatorCount,
  getEmulator,
  type Emulator,
  type EmulatorAdapter,
  type EmulatorBridge,
} from "./emulator";

export {
  attachView,
  detachView,
  recomputeGl,
  setTopLeaf,
  clearViewState,
  isViewVisible,
} from "./view";

export {
  applyBackgroundActive,
  applyCursorBlinkFor,
  applyFontFamily,
  applyFontSize,
  applyLetterSpacing,
  applyScrollback,
  applyScrollbackFor,
  applyTheme,
  applyWebglPreference,
  effectiveScrollback,
  TERMINAL_BG_SCROLLBACK_CAP,
} from "./preferences";

export {
  grantPolicy,
  MAX_GL_CONTEXTS,
  type GlLeafState,
} from "./glContextPool";

export { WriteScheduler, type WritableEmulator } from "./writeScheduler";

import { getEmulator } from "./emulator";

/** Focus a leaf's terminal (no-op if no emulator yet). */
export function focusLeaf(leafId: number): void {
  getEmulator(leafId)?.term.focus();
}
