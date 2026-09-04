import { native } from "@/modules/ai/lib/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  clearRepositoryTargetForSpace,
  repositoryTargetForSpace,
  setRepositoryTargetForSpace,
  type SourceControlRepositoryTargets,
} from "./repositoryTarget";

type RequestCounter = { current: number };

type Params = {
  spaceId: string;
  workspaceKey: string;
  isContextCurrent: (spaceId: string, workspaceKey: string) => boolean;
  openSourceControl: () => void;
  openCommitHistoryTab: (input: {
    repoRoot: string;
    branch: string | null;
  }) => void;
};

export function useRepositoryTargeting({
  spaceId,
  workspaceKey,
  isContextCurrent,
  openSourceControl,
  openCommitHistoryTab,
}: Params) {
  const [targets, setTargets] = useState<SourceControlRepositoryTargets>({});
  const sourceControlRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const requestScope = `${spaceId}\0${workspaceKey}`;
  const requestScopeRef = useRef(requestScope);
  const repositoryTarget = useMemo(
    () => repositoryTargetForSpace(targets, spaceId, workspaceKey),
    [spaceId, targets, workspaceKey],
  );

  useEffect(() => {
    if (requestScopeRef.current === requestScope) return;
    requestScopeRef.current = requestScope;
    sourceControlRequestRef.current += 1;
    historyRequestRef.current += 1;
  }, [requestScope]);

  const resolveRepository = useCallback(
    async (path: string, requestRef: RequestCounter) => {
      const requestId = ++requestRef.current;
      try {
        const repo = await native.gitResolveRepo(path);
        if (
          requestId !== requestRef.current ||
          !isContextCurrent(spaceId, workspaceKey)
        ) {
          return null;
        }
        if (!repo) {
          toast.info("No Git repository contains this folder.");
        }
        return repo;
      } catch (error) {
        if (
          requestId === requestRef.current &&
          isContextCurrent(spaceId, workspaceKey)
        ) {
          toast.error("Could not resolve Git repository", {
            description: String(error),
          });
        }
        return null;
      }
    },
    [isContextCurrent, spaceId, workspaceKey],
  );

  const openInSourceControl = useCallback(
    async (path: string) => {
      const repo = await resolveRepository(path, sourceControlRequestRef);
      if (!repo) return;
      setTargets((current) =>
        setRepositoryTargetForSpace(
          current,
          spaceId,
          workspaceKey,
          repo.repoRoot,
        ),
      );
      openSourceControl();
    },
    [openSourceControl, resolveRepository, spaceId, workspaceKey],
  );

  const openGitHistory = useCallback(
    async (path: string) => {
      const repo = await resolveRepository(path, historyRequestRef);
      if (!repo) return;
      openCommitHistoryTab({ repoRoot: repo.repoRoot, branch: repo.branch });
    },
    [openCommitHistoryTab, resolveRepository],
  );

  const followActiveContext = useCallback(() => {
    sourceControlRequestRef.current += 1;
    setTargets((current) =>
      clearRepositoryTargetForSpace(current, spaceId, workspaceKey),
    );
  }, [spaceId, workspaceKey]);

  return {
    repositoryTarget,
    openInSourceControl,
    openGitHistory,
    followActiveContext,
  };
}
