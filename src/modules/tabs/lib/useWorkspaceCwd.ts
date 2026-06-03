import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Tab } from "./useTabs";

type Result = {
  explorerRoot: string | null;
  inheritedCwdForNewTab: () => string | undefined;
};

export function resolveExplorerRoot(
  activeTab: Tab | undefined,
  tabs: Tab[],
  home: string | null,
  workspaceRoot?: string | null,
  lastTerminalCwd?: string | null,
): string | null {
  if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
  if (activeTab?.kind === "terminal" && activeTab.workspace.kind === "ssh") {
    return activeTab.workspace.rootPath;
  }
  if (workspaceRoot) return workspaceRoot;
  if (lastTerminalCwd) return lastTerminalCwd;
  const anyTerm = tabs.find((t) => t.kind === "terminal" && t.cwd);
  if (anyTerm?.kind === "terminal" && anyTerm.cwd) return anyTerm.cwd;
  return home;
}

export function useWorkspaceCwd(
  activeTab: Tab | undefined,
  tabs: Tab[],
  home: string | null,
  workspaceKey: string,
  workspaceRoot?: string | null,
): Result {
  const lastTerminalCwd = useRef<string | null>(null);

  useEffect(() => {
    lastTerminalCwd.current = null;
  }, [workspaceKey]);

  useEffect(() => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) {
      lastTerminalCwd.current = activeTab.cwd;
    }
  }, [activeTab, workspaceKey]);

  const explorerRoot = useMemo<string | null>(() => {
    return resolveExplorerRoot(
      activeTab,
      tabs,
      home,
      workspaceRoot,
      lastTerminalCwd.current,
    );
  }, [activeTab, tabs, home, workspaceRoot]);

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
    // Editor tabs inherit the last terminal's cwd (or workspace home), not
    // the file's folder — opening a new terminal from a file shouldn't
    // hijack the user's working directory context.
    return lastTerminalCwd.current ?? home ?? undefined;
  }, [activeTab, home, workspaceKey]);

  return { explorerRoot, inheritedCwdForNewTab };
}
