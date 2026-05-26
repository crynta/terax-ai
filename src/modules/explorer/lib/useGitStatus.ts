import { native, type GitStatusSnapshot } from "@/modules/ai/lib/native";
import { useWorkspaceEnvStore, workspaceScopeKey } from "@/modules/workspace";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildGitStatusMap,
  bubbleUpDirectoryStatuses,
  lookupGitStatus,
  repoCoversPath,
  type GitStatusCode,
} from "./gitStatusUtils";

type GitStatusState = {
  repoRoot: string | null;
  statusMap: Map<string, GitStatusCode>;
};

const EMPTY_MAP = new Map<string, GitStatusCode>();

export function useGitStatus(
  workspaceRoot: string | null,
  sharedStatus?: GitStatusSnapshot | null,
) {
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const workspaceKey = workspaceScopeKey(workspaceEnv);
  const requestIdRef = useRef(0);
  const [fetched, setFetched] = useState<GitStatusState>({
    repoRoot: null,
    statusMap: EMPTY_MAP,
  });

  const sharedCoversRoot =
    !!workspaceRoot &&
    !!sharedStatus &&
    repoCoversPath(sharedStatus.repoRoot, workspaceRoot);

  const sharedState = useMemo<GitStatusState | null>(() => {
    if (!sharedCoversRoot || !sharedStatus) return null;
    const statusMap = buildGitStatusMap(sharedStatus);
    bubbleUpDirectoryStatuses(statusMap);
    return {
      repoRoot: sharedStatus.repoRoot,
      statusMap,
    };
  }, [sharedCoversRoot, sharedStatus]);

  useEffect(() => {
    requestIdRef.current++;
    setFetched({ repoRoot: null, statusMap: EMPTY_MAP });
  }, [workspaceKey]);

  useEffect(() => {
    if (!workspaceRoot || sharedCoversRoot) return;

    const requestId = ++requestIdRef.current;

    void native
      .gitPanelSnapshot(workspaceRoot)
      .then((snapshot) => {
        if (requestId !== requestIdRef.current) return;
        if (!snapshot.repo || !snapshot.status) {
          setFetched({ repoRoot: null, statusMap: EMPTY_MAP });
          return;
        }
        const statusMap = buildGitStatusMap(snapshot.status);
        bubbleUpDirectoryStatuses(statusMap);
        setFetched({
          repoRoot: snapshot.repo.repoRoot,
          statusMap,
        });
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setFetched({ repoRoot: null, statusMap: EMPTY_MAP });
      });
  }, [workspaceRoot, sharedCoversRoot, workspaceKey]);

  const { repoRoot, statusMap } = sharedState ?? fetched;

  const lookup = useCallback(
    (path: string): GitStatusCode | null => {
      if (!repoRoot) return null;
      return lookupGitStatus(statusMap, repoRoot, path);
    },
    [repoRoot, statusMap],
  );

  return { repoRoot, statusMap, lookup };
}
