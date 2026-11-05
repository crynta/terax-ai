import type {
  ActiveTerminalLinks,
  LazyTerminalLinksOptions,
} from "./LazyTerminalLinks";
import { cellAtPoint } from "./linkCells";
import { LinkUnderlineOverlay } from "./LinkUnderlineOverlay";
import { TerminalLinkInteraction } from "./TerminalLinkInteraction";
import { ViewportLinkResolver } from "./ViewportLinkResolver";

/** The link machinery behind `LazyTerminalLinks`; imported on first use. */
export function createTerminalLinks(
  options: LazyTerminalLinksOptions,
): ActiveTerminalLinks {
  const overlay = new LinkUnderlineOverlay(options.target, options.geometry);
  const resolver = new ViewportLinkResolver(options.model);
  const interaction = new TerminalLinkInteraction({
    target: options.target,
    keyTarget: options.keyTarget,
    isModifier: options.isModifier,
    cellAt: (clientX, clientY) => {
      const { cellWidth, cellHeight, shiftY } = options.geometry();
      const rect = options.target.getBoundingClientRect();
      return cellAtPoint(
        (clientX - rect.left) / cellWidth,
        (clientY - rect.top + shiftY) / cellHeight,
        options.model.cols,
        options.model.rows,
      );
    },
    // The scrollbar owns its pointer, and so does an application that tracks
    // the mouse unless Shift is held.
    blocked: (shift, target) =>
      (target instanceof Node && options.scrollbar.contains(target)) ||
      (options.model.modes().mouseTracking && !shift),
    hitAt: (cell) => resolver.at(cell.row, cell.column),
    overlay,
    setPointerCursor: (pointer) => {
      options.target.style.cursor = pointer ? "pointer" : "text";
    },
    onActivate: options.onActivate,
  });
  return {
    ingest: (event) => interaction.ingest(event),
    invalidate: () => interaction.invalidate(),
    dispose: () => {
      interaction.dispose();
      overlay.dispose();
    },
  };
}
