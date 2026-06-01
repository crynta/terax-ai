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
      return lookupGitStatus(statusMap, repoRoot, path, pathAliases);
    },
    [repoRoot, statusMap, pathAliases],
  );

  return { repoRoot, statusMap, lookup };
}
