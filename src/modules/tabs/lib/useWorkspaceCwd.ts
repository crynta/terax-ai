import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Tab } from "./tabs";

type Result = {
  explorerRoot: string | null;
  inheritedCwdForNewTab: () => string | undefined;
};

export function useWorkspaceCwd(
  activeTab: Tab | undefined,
  /** Some open terminal's cwd, for when no terminal was focused yet. */
  anyTerminalCwd: string | undefined,
  home: string | null,
  projectId: string | null,
): Result {
  const lastTerminalCwd = useRef(new Map<string | null, string>());

  useEffect(() => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) {
      lastTerminalCwd.current.set(projectId, activeTab.cwd);
    }
  }, [activeTab, projectId]);

  const explorerRoot = useMemo<string | null>(() => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
    const remembered = lastTerminalCwd.current.get(projectId);
    if (remembered) return remembered;
    return anyTerminalCwd ?? home;
  }, [activeTab, anyTerminalCwd, home, projectId]);

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
    // Editor tabs inherit the last terminal's cwd (or workspace home), not
    // the file's folder — opening a new terminal from a file shouldn't
    // hijack the user's working directory context.
    return (
      lastTerminalCwd.current.get(projectId) ??
      anyTerminalCwd ??
      home ??
      undefined
    );
  }, [activeTab, anyTerminalCwd, home, projectId]);

  return { explorerRoot, inheritedCwdForNewTab };
}
