import type { SidebarViewId } from "@/modules/sidebar";
import type { Tab } from "@/modules/tabs";

export type SourceControlRepositoryTarget =
  | { mode: "follow-context" }
  | { mode: "fixed"; repoRoot: string };

export type SourceControlRepositoryTargets = Readonly<
  Record<string, string>
>;

const FOLLOW_CONTEXT: SourceControlRepositoryTarget = {
  mode: "follow-context",
};

function targetScopeKey(spaceId: string, workspaceKey: string): string {
  return `${spaceId}\0${workspaceKey}`;
}

function dirname(path: string | null): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index < 0) return normalized;
  if (index === 0) return "/";
  if (index === 2 && /^[A-Za-z]:\//.test(normalized)) {
    return normalized.slice(0, 3);
  }
  return normalized.slice(0, index);
}

export function repositoryTargetForSpace(
  targets: SourceControlRepositoryTargets,
  spaceId: string,
  workspaceKey: string,
): SourceControlRepositoryTarget {
  const repoRoot = targets[targetScopeKey(spaceId, workspaceKey)];
  return repoRoot
    ? { mode: "fixed", repoRoot }
    : FOLLOW_CONTEXT;
}

export function setRepositoryTargetForSpace(
  targets: SourceControlRepositoryTargets,
  spaceId: string,
  workspaceKey: string,
  repoRoot: string,
): SourceControlRepositoryTargets {
  const key = targetScopeKey(spaceId, workspaceKey);
  if (targets[key] === repoRoot) return targets;
  return { ...targets, [key]: repoRoot };
}

export function clearRepositoryTargetForSpace(
  targets: SourceControlRepositoryTargets,
  spaceId: string,
  workspaceKey: string,
): SourceControlRepositoryTargets {
  const key = targetScopeKey(spaceId, workspaceKey);
  if (!(key in targets)) return targets;
  const next = { ...targets };
  delete next[key];
  return next;
}

export function activeRepositoryContextPath({
  activeTab,
  activeTerminalLeafCwd,
  explorerRoot,
  workspaceFallbackPath,
}: {
  activeTab: Tab | undefined;
  activeTerminalLeafCwd: string | null;
  explorerRoot: string | null;
  workspaceFallbackPath: string | null;
}): string | null {
  if (activeTab?.kind === "terminal") {
    return activeTerminalLeafCwd ?? explorerRoot ?? workspaceFallbackPath;
  }
  if (activeTab?.kind === "editor") return dirname(activeTab.path);
  if (activeTab?.kind === "git-diff") return activeTab.repoRoot;
  if (activeTab?.kind === "git-commit-file") return activeTab.repoRoot;
  if (activeTab?.kind === "git-history") return activeTab.repoRoot;
  return explorerRoot ?? workspaceFallbackPath;
}

export function sourceControlRepositoryPath({
  contextPath,
  badgeContextPath,
  sidebarView,
  hasOpenGitTab,
  target,
}: {
  contextPath: string | null;
  badgeContextPath: string | null;
  sidebarView: SidebarViewId;
  hasOpenGitTab: boolean;
  target: SourceControlRepositoryTarget;
}): string | null {
  if (sidebarView === "source-control" && target.mode === "fixed") {
    return target.repoRoot;
  }
  return hasOpenGitTab || sidebarView === "source-control"
    ? contextPath
    : badgeContextPath;
}

export function gitGraphRepositoryPath({
  contextPath,
  sidebarView,
  target,
}: {
  contextPath: string | null;
  sidebarView: SidebarViewId;
  target: SourceControlRepositoryTarget;
}): string | null {
  return sidebarView === "source-control" && target.mode === "fixed"
    ? target.repoRoot
    : contextPath;
}

export function repositoryTargetIsPending({
  target,
  loadedContextPath,
  loadedRepoRoot,
  isLoading,
}: {
  target: SourceControlRepositoryTarget;
  loadedContextPath: string | null;
  loadedRepoRoot: string | null;
  isLoading: boolean;
}): boolean {
  if (target.mode !== "fixed") return false;
  if (loadedContextPath !== target.repoRoot) return true;
  return isLoading && loadedRepoRoot !== target.repoRoot;
}
