import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tab } from "./useTabs";

type Result = {
  explorerRoot: string | null;
  inheritedCwdForNewTab: () => string | undefined;
  setExplorerOverride: (path: string | null) => void;
  explorerOverride: string | null;
};

export function useWorkspaceCwd(
  activeTab: Tab | undefined,
  tabs: Tab[],
  home: string | null,
): Result {
  const lastTerminalCwd = useRef<string | null>(null);
  const [explorerOverride, setExplorerOverride] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) {
      lastTerminalCwd.current = activeTab.cwd;
    }
  }, [activeTab]);

  const explorerRoot = useMemo<string | null>(() => {
    if (explorerOverride) return explorerOverride;
    if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
    if (lastTerminalCwd.current) return lastTerminalCwd.current;
    const anyTerm = tabs.find((t) => t.kind === "terminal" && t.cwd);
    if (anyTerm?.kind === "terminal" && anyTerm.cwd) return anyTerm.cwd;
    return home;
  }, [explorerOverride, activeTab, tabs, home]);

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
    return lastTerminalCwd.current ?? home ?? undefined;
  }, [activeTab, home]);

  return { explorerRoot, inheritedCwdForNewTab, setExplorerOverride, explorerOverride };
}
