import type {
  ActiveTerminalLinks,
  LazyTerminalLinksOptions,
} from "./LazyTerminalLinks";
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
    cellAt: options.cellAt,
    blocked: options.blocked,
    hitAt: (cell) => resolver.at(cell.row, cell.column),
    overlay,
    setPointerCursor: options.setPointerCursor,
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
