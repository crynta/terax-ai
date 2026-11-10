import type { ReaderFonts } from "../src/protocol";

/** The Reader's design size for Claude's prose (reader.css `.terax-reader-prose`). */
const DESIGN_PROSE_PX = 14;

/**
 * Sizes the Reader like VS Code: the whole Reader is zoomed so its prose
 * lands on `fonts.prose` (VS Code's chat font size), keeping Terax's
 * proportions for chips and labels, and code blocks are then set to the
 * editor font size. Zoom is on <body> so popovers and dialogs scale too;
 * the body is made taller by the inverse so it still fills the panel.
 */
export function applyReaderFonts(fonts: ReaderFonts): void {
  const zoom = clamp(fonts.prose / DESIGN_PROSE_PX, 0.6, 2);
  const body = document.body.style;
  body.zoom = String(zoom);
  body.height = `${100 / zoom}vh`;
  const root = document.documentElement.style;
  // Code blocks render at the editor size after the zoom is applied.
  root.setProperty("--reader-code-size", `${fonts.code / zoom}px`);
  // The file review's editor opts out of the zoom (vscode-theme.css), so it
  // gets the editor size as is.
  root.setProperty("--reader-zoom", String(zoom));
  root.setProperty("--reader-review-size", `${fonts.code}px`);
}

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 1;
}
