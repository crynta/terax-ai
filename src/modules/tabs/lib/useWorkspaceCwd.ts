import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Tab } from "./useTabs";

type Result = {
  explorerRoot: string | null;
  inheritedCwdForNewTab: () => string | undefined;
};

export function useWorkspaceCwd(
  activeTab: Tab | undefined,
  tabs: Tab[],
  home: string | null,
): Result {
  const lastTerminalCwd = useRef<string | null>(null);

  useEffect(() => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) {
      lastTerminalCwd.current = activeTab.cwd;
    }
  }, [activeTab]);

  const explorerRoot = useMemo<string | null>(() => {
    const raw =
      (activeTab?.kind === "terminal" && activeTab.cwd
        ? activeTab.cwd
        : null) ??
      lastTerminalCwd.current ??
      (() => {
        const anyTerm = tabs.find((t) => t.kind === "terminal" && t.cwd);
        return anyTerm?.kind === "terminal" ? anyTerm.cwd : null;
      })() ??
      home;
    if (!raw) return null;
    // Normalise trailing slashes so useFileTree's rootPath stays stable.
    return raw === "/" ? "/" : raw.replace(/\/+$/, "") || "/";
  }, [activeTab, tabs, home]);

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
    // Editor tabs inherit the last terminal's cwd (or workspace home), not
    // the file's folder — opening a new terminal from a file shouldn't
    // hijack the user's working directory context.
    return lastTerminalCwd.current ?? home ?? undefined;
  }, [activeTab, home]);

  return { explorerRoot, inheritedCwdForNewTab };
}
