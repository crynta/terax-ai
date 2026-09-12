import { useSpaces } from "@/modules/spaces";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { DEFAULT_SPACE_ID, type Tab } from "./useTabs";

type Result = {
  explorerRoot: string | null;
  inheritedCwdForNewTab: () => string | undefined;
};

/**
 * Explorer / source-control root for the *active space* only.
 * Filtering the global tab list here stops lastTerminalCwd + tabs.find
 * from leaking across spaces (#1159). Optional spaceId/spaceRoot args
 * remain for tests / explicit overrides.
 */
export function useWorkspaceCwd(
  activeTab: Tab | undefined,
  tabs: Tab[],
  home: string | null,
  spaceId?: string | null,
  spaceRoot?: string | null,
): Result {
  const storeSpaceId = useSpaces((s) => s.activeId);
  const spaces = useSpaces((s) => s.spaces);
  const resolvedSpaceId = spaceId ?? storeSpaceId ?? DEFAULT_SPACE_ID;
  const resolvedSpaceRoot =
    spaceRoot ??
    spaces.find((s) => s.id === resolvedSpaceId)?.root ??
    null;

  const spaceTabs = useMemo(
    () => tabs.filter((t) => t.spaceId === resolvedSpaceId),
    [tabs, resolvedSpaceId],
  );

  const spaceActiveTab = useMemo(() => {
    if (!activeTab) return undefined;
    return activeTab.spaceId === resolvedSpaceId
      ? activeTab
      : spaceTabs.find((t) => t.id === activeTab.id);
  }, [activeTab, resolvedSpaceId, spaceTabs]);

  // Space-keyed cache — never mutate refs during render (React may discard).
  const cwdBySpaceRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (spaceActiveTab?.kind === "terminal" && spaceActiveTab.cwd) {
      cwdBySpaceRef.current.set(resolvedSpaceId, spaceActiveTab.cwd);
    }
  }, [spaceActiveTab, resolvedSpaceId]);

  const explorerRoot = useMemo<string | null>(() => {
    if (spaceActiveTab?.kind === "terminal" && spaceActiveTab.cwd) {
      return spaceActiveTab.cwd;
    }
    const cached = cwdBySpaceRef.current.get(resolvedSpaceId);
    if (cached) return cached;
    const anyTerm = spaceTabs.find((t) => t.kind === "terminal" && t.cwd);
    if (anyTerm?.kind === "terminal" && anyTerm.cwd) return anyTerm.cwd;
    return resolvedSpaceRoot ?? home;
  }, [spaceActiveTab, spaceTabs, home, resolvedSpaceRoot, resolvedSpaceId]);

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    if (spaceActiveTab?.kind === "terminal" && spaceActiveTab.cwd) {
      return spaceActiveTab.cwd;
    }
    const cached = cwdBySpaceRef.current.get(resolvedSpaceId);
    return cached ?? resolvedSpaceRoot ?? home ?? undefined;
  }, [spaceActiveTab, home, resolvedSpaceRoot, resolvedSpaceId]);

  return { explorerRoot, inheritedCwdForNewTab };
}
