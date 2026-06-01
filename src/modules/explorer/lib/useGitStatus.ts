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
  truncated: boolean;
};

const EMPTY_MAP = new Map<string, GitStatusCode>();

function stateFromSnapshot(status: GitStatusSnapshot): GitStatusState {
  const statusMap = buildGitStatusMap(status);
  bubbleUpDirectoryStatuses(statusMap);
  return {
    repoRoot: status.repoRoot,
    statusMap,
    truncated: status.truncated,
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

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
    truncated: false,
  });
  const [canonicalWorkspaceRoot, setCanonicalWorkspaceRoot] = useState<
    string | null
  >(null);

  const pathAliases = useMemo(() => {
    const roots = [workspaceRoot, canonicalWorkspaceRoot];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const root of roots) {
      if (!root) continue;
      const norm = normalizePath(root);
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(root);
    }
    return out;
  }, [workspaceRoot, canonicalWorkspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) {
      setCanonicalWorkspaceRoot(null);
      return;
    }
    let cancelled = false;
    void native
      .canonicalize(workspaceRoot)
      .then((canonical) => {
        if (cancelled) return;
        setCanonicalWorkspaceRoot(canonical);
      })
      .catch(() => {
        if (cancelled) return;
        setCanonicalWorkspaceRoot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, workspaceKey]);

  const sharedCoversRoot =
    !!workspaceRoot &&
    !!sharedStatus &&
    (repoCoversPath(sharedStatus.repoRoot, workspaceRoot, pathAliases) ||
      pathAliases.some(
        (alias) =>
          normalizePath(alias) === normalizePath(sharedStatus.repoRoot),
      ));

  const sharedState = useMemo<GitStatusState | null>(() => {
    if (!sharedCoversRoot || !sharedStatus) return null;
    return stateFromSnapshot(sharedStatus);
  }, [sharedCoversRoot, sharedStatus]);

  useEffect(() => {
    requestIdRef.current++;
    setFetched({ repoRoot: null, statusMap: EMPTY_MAP, truncated: false });
  }, [workspaceKey]);

  useEffect(() => {
    if (!workspaceRoot || sharedCoversRoot) return;

    const requestId = ++requestIdRef.current;

    void native
      .gitPanelSnapshot(workspaceRoot)
      .then((snapshot) => {
        if (requestId !== requestIdRef.current) return;
        if (!snapshot.repo || !snapshot.status) {
          setFetched({ repoRoot: null, statusMap: EMPTY_MAP, truncated: false });
          return;
        }
        setFetched(stateFromSnapshot(snapshot.status));
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setFetched({ repoRoot: null, statusMap: EMPTY_MAP, truncated: false });
      });
  }, [workspaceRoot, sharedCoversRoot, workspaceKey]);

  const { repoRoot, statusMap, truncated } = sharedState ?? fetched;

  const lookup = useCallback(
    (path: string): GitStatusCode | null => {
      if (!repoRoot) return null;
      return lookupGitStatus(statusMap, repoRoot, path, pathAliases);
    },
    [repoRoot, statusMap, pathAliases],
  );

  return { repoRoot, statusMap, truncated, lookup };
}
