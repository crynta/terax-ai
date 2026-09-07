/**
 * Drop stale WebGL glyphs then redraw the visible buffer.
 *
 * Terminal.refresh alone can leave atlas ghosts after a slot was parked or
 * hidden behind another tab - the WebGL atlas still holds cells from the prior
 * frame. Clearing it before refresh is the xterm.js-recommended path for that
 * class of baked-in / ghost text (#604).
 */
export function repaintTerminalSlot(slot: {
  webglAddon: { clearTextureAtlas(): void } | null;
  term: { rows: number; refresh(start: number, end: number): void };
}): void {
  try {
    slot.webglAddon?.clearTextureAtlas();
  } catch {
    // Addon may already be disposed during context-loss recovery.
  }
  try {
    slot.term.refresh(0, Math.max(0, slot.term.rows - 1));
  } catch {
    // Terminal may be mid-dispose while a rAF unhide still fires.
  }
}