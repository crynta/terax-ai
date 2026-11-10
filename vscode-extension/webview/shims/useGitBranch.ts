import { useEffect, useState } from "react";
import { rpc } from "../bridge";

/** Terax's `useGitBranch`, resolved by the extension host. */
export function useGitBranch(cwd: string | null, nonce = 0): string | null {
  const [branch, setBranch] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a manual re-resolve trigger
  useEffect(() => {
    if (!cwd) {
      setBranch(null);
      return;
    }
    let alive = true;
    rpc<{ branch: string } | null>("git_resolve_repo", { cwd })
      .then((repo) => {
        if (alive) setBranch(repo?.branch || null);
      })
      .catch(() => {
        if (alive) setBranch(null);
      });
    return () => {
      alive = false;
    };
  }, [cwd, nonce]);

  return branch;
}
