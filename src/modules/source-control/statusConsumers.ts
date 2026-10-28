import type { SidebarViewId } from "@/modules/sidebar";

/**
 * Who is currently displaying the repository status, and therefore whether the
 * app should keep it fresh with `git status` calls.
 *
 * Status is cheap to hold and expensive to compute (a full `git status` per
 * window focus or context change). It feeds four things:
 *   - the Source Control panel,
 *   - git tabs (diff / history / commit file),
 *   - explorer git decorations,
 *   - the rail badge.
 * The first three are "live" consumers: stale data is visibly wrong, so the
 * status is refreshed on focus and context changes while they are on screen.
 * The badge alone is not: it is refreshed lazily, the next time a live
 * consumer appears.
 */
export type StatusConsumers = {
  /** Source Control is the sidebar view and the sidebar is expanded. */
  panel: boolean;
  /** The active tab is a git diff / history / commit-file tab. */
  gitTab: boolean;
  /** The explorer is on screen and draws git decorations. */
  explorerDecorations: boolean;
};

const GIT_TAB_KINDS: ReadonlySet<string> = new Set([
  "git-diff",
  "git-history",
  "git-commit-file",
]);

export function isGitTabKind(kind: string | undefined): boolean {
  return kind !== undefined && GIT_TAB_KINDS.has(kind);
}

export function statusConsumers(input: {
  sidebarCollapsed: boolean;
  sidebarView: SidebarViewId;
  activeTabKind: string | undefined;
  explorerGitDecorations: boolean;
}): StatusConsumers {
  const sidebarShown = !input.sidebarCollapsed;
  return {
    panel: sidebarShown && input.sidebarView === "source-control",
    gitTab: isGitTabKind(input.activeTabKind),
    explorerDecorations:
      sidebarShown &&
      input.sidebarView === "explorer" &&
      input.explorerGitDecorations,
  };
}

/** True while any live consumer is on screen. */
export function isStatusLive(consumers: StatusConsumers): boolean {
  return consumers.panel || consumers.gitTab || consumers.explorerDecorations;
}
