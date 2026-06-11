import { native } from "@/modules/ai/lib/native";
import { useEffect, useState } from "react";

// `nonce` forces a re-resolve (e.g. on command finish) so `git checkout` shows.
export function useGitBranch(cwd: string | null, nonce = 0): string | null {
  const [branch, setBranch] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a manual re-resolve trigger
  useEffect(() => {
    if (!cwd) {
      setBranch(null);
      return;
    }
    let alive = true;
    native
      .gitResolveRepo(cwd)
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
