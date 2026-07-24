import { useCallback, useEffect, useRef, useState } from "react";
import { discoverRepositories, type GitRepo } from "./discover";

type RepoDiscoveryState = {
  detectedRepos: GitRepo[];
  currentRepoRoot: string | undefined;
  loading: boolean;
};

/**
 * Discovers git repositories in the workspace root and tracks which one
 * is currently selected. When the workspace root changes, repos are
 * re-discovered automatically.
 */
export function useRepoDiscovery(workspaceRoot: string | null) {
  const [state, setState] = useState<RepoDiscoveryState>({
    detectedRepos: [],
    currentRepoRoot: undefined,
    loading: false,
  });

  // Avoid race conditions from overlapping async calls
  const seqRef = useRef(0);

  useEffect(() => {
    if (!workspaceRoot) {
      setState({ detectedRepos: [], currentRepoRoot: undefined, loading: false });
      return;
    }

    const seq = ++seqRef.current;
    let cancelled = false;

    setState((prev) => ({ ...prev, loading: true }));

    discoverRepositories(workspaceRoot)
      .then((repos) => {
        if (cancelled || seq !== seqRef.current) return;
        setState((prev) => {
          // Keep current selection if it's still in the new list
          const stillExists =
            prev.currentRepoRoot &&
            repos.some((r) => r.repoRoot === prev.currentRepoRoot);
          return {
            detectedRepos: repos,
            currentRepoRoot: stillExists
              ? prev.currentRepoRoot
              : repos[0]?.repoRoot,
            loading: false,
          };
        });
      })
      .catch(() => {
        if (cancelled || seq !== seqRef.current) return;
        setState({ detectedRepos: [], currentRepoRoot: undefined, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  const onRepoChange = useCallback((repoRoot: string) => {
    setState((prev) => ({ ...prev, currentRepoRoot: repoRoot }));
  }, []);

  return {
    detectedRepos: state.detectedRepos,
    currentRepoRoot: state.currentRepoRoot,
    onRepoChange,
    loading: state.loading,
  };
}
