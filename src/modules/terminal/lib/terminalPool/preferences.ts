import { detectMonoFontFamily } from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { buildTerminalTheme } from "@/styles/terminalTheme";
import {
  forEachEmulator,
  getEmulator,
  getEmulatorAdapter,
  grantGl,
  revokeGl,
  type Emulator,
} from "./emulator";
import { isViewVisible } from "./view";

// Preference setters — iterate the per-leaf emulator Map (replacing the old
// 5-slot array). Each setter is a pure fan-out over the live emulators.
//
// F2 (bounded memory): every leaf — foreground OR background — keeps the SAME
// scrollback = the user's terminalScrollback pref. We do NOT shrink a
// backgrounded leaf's scrollback. This matches VS Code / iTerm2 / Windows
// Terminal, none of which trim background scrollback, and it is the only
// correct behavior: xterm PERMANENTLY trims an already-populated buffer the
// instant options.scrollback shrinks (proven: scrollback 6000 with 5500 lines,
// set to 1000 -> buffer.length 5501->1024, getLine(0) 'line0'->'line4477', and
// re-growing does NOT restore the lost lines). The old two-tier shrink-on-hide
// therefore destroyed all history beyond the background cap on every tab
// switch, silently undermining the Defect C fix and violating the user's
// scrollback setting (up to 50000). Correctness (no history loss) outweighs the
// aggressive memory reclaim of a background cap; RAM scales linearly with the
// user's scrollback pref x tabs, which is industry-normal and bounded by the
// pref the user explicitly chose.

// Retained for the stable barrel export surface (and as the historical mirror
// of VS Code's terminal.integrated.scrollback default). NO LONGER used to
// shrink a populated background buffer — see effectiveScrollback below.
export const TERMINAL_BG_SCROLLBACK_CAP = 1000;

const MCR_BG_ACTIVE = 4.5;
const MCR_BG_INACTIVE = 1;

export function applyBackgroundActive(active: boolean): void {
  const value = active ? MCR_BG_ACTIVE : MCR_BG_INACTIVE;
  forEachEmulator((e) => {
    if (e.term.options.minimumContrastRatio === value) return;
    e.term.options.minimumContrastRatio = value;
  });
}

export function applyFontSize(size: number): void {
  forEachEmulator((e) => {
    if (e.term.options.fontSize === size) return;
    e.term.options.fontSize = size;
    e.fitAddon.fit();
    if (e.container) {
      e.lastCols = e.term.cols;
      e.lastRows = e.term.rows;
      getEmulatorAdapter()?.resolveLeaf(e.leafId)?.resizePty(e.term.cols, e.term.rows);
    }
  });
}

export function applyLetterSpacing(spacing: number): void {
  forEachEmulator((e) => {
    if (e.term.options.letterSpacing === spacing) return;
    e.term.options.letterSpacing = spacing;
    e.fitAddon.fit();
  });
}

export function applyFontFamily(family: string): void {
  const resolved = family || detectMonoFontFamily();
  forEachEmulator((e) => {
    if (e.term.options.fontFamily === resolved) return;
    e.term.options.fontFamily = resolved;
    e.fitAddon.fit();
    if (e.container) {
      e.lastCols = e.term.cols;
      e.lastRows = e.term.rows;
      getEmulatorAdapter()?.resolveLeaf(e.leafId)?.resizePty(e.term.cols, e.term.rows);
    }
  });
}

/**
 * Resolve the effective scrollback for an emulator: ALWAYS the full user pref,
 * regardless of visibility.
 *
 * WHY no background cap: xterm trims oldest lines PERMANENTLY (and irreversibly)
 * the moment options.scrollback shrinks below the current buffer length. A
 * two-tier shrink-on-hide would therefore delete every line of history beyond
 * the cap on every tab switch — exactly the Defect C history-loss the
 * persistent-buffer model exists to prevent. We never shrink a populated
 * buffer; one scrollback value applies to all leaves.
 *
 * `leafId` is retained in the signature for the stable barrel export surface
 * and possible future per-leaf policy; visibility is intentionally NOT
 * consulted.
 */
export function effectiveScrollback(leafId: number, userPref: number): number {
  void leafId;
  return userPref;
}

/**
 * Apply the user's scrollback pref to ONE emulator. Idempotent. Because the
 * value is the user pref for every leaf (foreground or background), this only
 * ever GROWS a buffer (when the user raises the pref) and never shrinks a
 * populated one on a visibility change.
 */
export function applyScrollbackFor(emu: Emulator): void {
  const target = usePreferencesStore.getState().terminalScrollback;
  if (emu.term.options.scrollback === target) return;
  emu.term.options.scrollback = target;
}

/**
 * Global scrollback-pref change: re-evaluate every emulator. All leaves get the
 * new pref (no per-visibility tier).
 */
export function applyScrollback(_value: number): void {
  forEachEmulator((e) => applyScrollbackFor(e));
}

export function applyTheme(): void {
  const theme = buildTerminalTheme();
  forEachEmulator((e) => {
    e.term.options.theme = theme;
  });
}

export function applyWebglPreference(enabled: boolean): void {
  forEachEmulator((e) => {
    // When enabling, only re-grant to leaves the policy would allow (visible).
    if (enabled) {
      if (isViewVisible(e.leafId)) grantGl(e);
    } else {
      revokeGl(e);
    }
  });
}

export function applyCursorBlinkFor(leafId: number, focused: boolean): void {
  const emu = getEmulator(leafId);
  if (!emu) return;
  if (emu.term.options.cursorBlink === focused) return;
  emu.term.options.cursorBlink = focused;
}
