import { useMemo } from "react";
import type { Tab } from "@/modules/tabs";
import { findLeafCwd } from "@/modules/terminal";
import {
  type CodePanelContext,
  type CodeSurface,
  resolveCodeContext,
} from "./codeSurface";

function absoluteOrRepoPath(repoRoot: string, path: string): string {
  if (/^([A-Za-z]:|\/|\\)/.test(path)) return path;
  const root = repoRoot.replace(/[\/]+$/, "");
  const rel = path.replace(/^[\/]+/, "");
  return `${root}/${rel}`;
}

export function useAppActiveContext({
  activeTab,
  capturedCodeContext,
  codeSurface,
  explorerRoot,
  home,
  launchCwd,
  launchCwdResolved,
}: {
  activeTab: Tab | undefined;
  capturedCodeContext: CodePanelContext | null;
  codeSurface: CodeSurface;
  explorerRoot: string | null;
  home: string | null;
  launchCwd: string | null;
  launchCwdResolved: boolean;
}) {
  const activeTerminalLeafCwd =
    activeTab?.kind === "terminal"
      ? (findLeafCwd(activeTab.paneTree, activeTab.activeLeafId) ??
        activeTab.cwd ??
        null)
      : null;

  const activeFilePath = (() => {
    if (activeTab?.kind === "editor") return activeTab.path;
    if (activeTab?.kind === "workflow") return activeTab.path ?? null;
    if (activeTab?.kind === "git-diff") {
      return absoluteOrRepoPath(activeTab.repoRoot, activeTab.path);
    }
    if (activeTab?.kind === "git-commit-file") {
      return absoluteOrRepoPath(activeTab.repoRoot, activeTab.path);
    }
    return null;
  })();

  const explorerActiveFilePath =
    activeTab?.kind === "editor" ||
    activeTab?.kind === "markdown" ||
    activeTab?.kind === "workflow"
      ? activeTab.path
      : null;

  const workspaceFallbackPath = launchCwdResolved
    ? (launchCwd ?? home ?? null)
    : null;

  const activeCodeContext = useMemo<CodePanelContext>(
    () => ({
      workspaceRoot: explorerRoot ?? workspaceFallbackPath,
      activeCwd: activeTerminalLeafCwd ?? explorerRoot ?? workspaceFallbackPath,
      activeFile: activeFilePath,
      activeTerminalPrivate:
        activeTab?.kind === "terminal" && activeTab.private === true,
    }),
    [
      activeFilePath,
      activeTab,
      activeTerminalLeafCwd,
      explorerRoot,
      workspaceFallbackPath,
    ],
  );

  const codePanelContext = resolveCodeContext({
    surface: codeSurface,
    activeContext: activeCodeContext,
    capturedContext: capturedCodeContext,
  });

  return {
    activeCodeContext,
    activeFilePath,
    activeTerminalLeafCwd,
    codePanelContext,
    explorerActiveFilePath,
    workspaceFallbackPath,
  };
}
