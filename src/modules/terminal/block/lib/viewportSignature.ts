import type { BlockMode } from "./modeMachine";

/**
 * Everything `GhosttyBlocks.visibleBlocks` depends on. If two reads of the
 * signature are equal, recomputing the visible blocks would produce the same
 * result, so the block chrome neither needs to be recomputed nor committed.
 *
 * Most renderer frames repaint cells without moving any block: in-place TUI
 * redraws, output that does not scroll, cursor movement while idle. Only a
 * scroll (`origin` / `history`), a resize (`rows` / `cols` / `cellHeight`), a
 * mode change, or the block set itself changing (`revision`) moves chrome.
 */
export type BlockViewportSignature = {
  mode: BlockMode;
  /** `GhosttyBlocks.revision`: block set and metadata. */
  revision: number;
  /** First buffer line of the viewport. */
  origin: number;
  /** Scrollback length. */
  history: number;
  rows: number;
  cols: number;
  cellHeight: number;
  /**
   * Buffer line of the cursor while a command runs (the running block's end
   * follows it), otherwise -1 so cursor movement at an idle prompt is ignored.
   */
  cursorLine: number;
};

export function sameBlockViewport(
  a: BlockViewportSignature,
  b: BlockViewportSignature,
): boolean {
  return (
    a.mode === b.mode &&
    a.revision === b.revision &&
    a.origin === b.origin &&
    a.history === b.history &&
    a.rows === b.rows &&
    a.cols === b.cols &&
    a.cellHeight === b.cellHeight &&
    a.cursorLine === b.cursorLine
  );
}
