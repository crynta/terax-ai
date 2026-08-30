import { native } from "@/modules/ai/lib/native";
import type { SidebarViewId } from "@/modules/sidebar";
import type { SpaceRootIssue } from "@/modules/spaces/lib/spaceRoot";
import { useCallback, useRef } from "react";
import { createGitHistoryRequestGate } from "./gitHistoryRequest";
import { sourceControlPathForSpace } from "./spaceRepository";
import {
  type SourceControlSummary,
  useSourceControl,
} from "./useSourceControl";

type Params = {
  spaceId: string;
  workspaceScope: string;
  spaceRoot: string | null;
  rootIssue: SpaceRootIssue | undefined;
  cycleSidebarView: (view: SidebarViewId) => void;
  openCommitHistoryTab: (args: {
    repoRoot: string;
    branch: string | null;
  }) => void;
};

export function maskSourceControlSummaryForContext(
  summary: SourceControlSummary,
  requestedContextPath: string | null,
): SourceControlSummary {
  if (summary.contextPath === requestedContextPath) return summary;
  return {
    ...summary,
    contextPath: requestedContextPath,
    repo: null,
    status: null,
    changedCount: 0,
    upstream: null,
    ahead: 0,
    behind: 0,
    hasRepo: false,
    isLoading: requestedContextPath !== null,
    localError: null,
    busyAction: null,
    lastRemoteError: null,
    applyStatus: () => {},
    runRemoteAction: async () => ({
      ok: false,
      action: null,
      blocked: "no-repo",
    }),
  };
}

export function useSourceControlContext({
  spaceId,
  workspaceScope,
  spaceRoot,
  rootIssue,
  cycleSidebarView,
  openCommitHistoryTab,
}: Params) {
  const sourceControlPath = sourceControlPathForSpace(spaceRoot, rootIssue);
  const gitHistoryRequestGate = useRef(createGitHistoryRequestGate()).current;
  const gitHistoryOwnerRef = useRef({
    spaceId,
    workspaceScope,
    spaceRoot: sourceControlPath,
  });
  const gitHistoryOwner = gitHistoryOwnerRef.current;
  if (
    gitHistoryOwner.spaceId !== spaceId ||
    gitHistoryOwner.workspaceScope !== workspaceScope ||
    gitHistoryOwner.spaceRoot !== sourceControlPath
  ) {
    gitHistoryRequestGate.invalidate();
    gitHistoryOwnerRef.current = {
      spaceId,
      workspaceScope,
      spaceRoot: sourceControlPath,
    };
  }
  const loadedSourceControl = useSourceControl(sourceControlPath, true);
  const sourceControl = maskSourceControlSummaryForContext(
    loadedSourceControl,
    sourceControlPath,
  );

  const toggleSourceControl = useCallback(() => {
    cycleSidebarView("source-control");
  }, [cycleSidebarView]);

  const openGitGraphFromContext = useCallback(async () => {
    const contextPath = sourceControlPath;
    if (!contextPath) return;
    const request = gitHistoryRequestGate.begin(
      spaceId,
      workspaceScope,
      contextPath,
    );
    const requestIsCurrent = () => {
      const owner = gitHistoryOwnerRef.current;
      return gitHistoryRequestGate.isCurrent(
        request,
        owner.spaceId,
        owner.workspaceScope,
        owner.spaceRoot,
      );
    };
    const known =
      sourceControl.hasRepo && sourceControl.contextPath === contextPath
        ? sourceControl.repo
        : null;
    if (known) {
      if (!requestIsCurrent()) return;
      openCommitHistoryTab({
        repoRoot: known.repoRoot,
        branch: sourceControl.status?.branch ?? null,
      });
      return;
    }
    try {
      const repo = await native.gitResolveRepo(contextPath);
      if (!repo || !requestIsCurrent()) return;
      openCommitHistoryTab({ repoRoot: repo.repoRoot, branch: repo.branch });
    } catch {
      /* noop */
    }
  }, [
    gitHistoryRequestGate,
    openCommitHistoryTab,
    sourceControl,
    sourceControlPath,
    spaceId,
    workspaceScope,
  ]);

  return { sourceControl, toggleSourceControl, openGitGraphFromContext };
}
