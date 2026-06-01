import { native, type GitChildRepoSummary } from "@/modules/ai/lib/native";
import { useEffect, useRef, useState } from "react";

export function useChildRepos(contextPath: string | null, enabled = true): {
  repos: GitChildRepoSummary[];
  isLoading: boolean;
  error: string | null;
} {
  const [repos, setRepos] = useState<GitChildRepoSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const reqId = ++reqIdRef.current;
    if (!enabled || !contextPath) {
      setRepos([]);
      setIsLoading(false);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    native
      .gitListChildRepos(contextPath)
      .then((next) => {
        if (reqId !== reqIdRef.current) return;
        setRepos(next);
      })
      .catch((e) => {
        if (reqId !== reqIdRef.current) return;
        setRepos([]);
        setError(typeof e === "string" ? e : String(e));
      })
      .finally(() => {
        if (reqId !== reqIdRef.current) return;
        setIsLoading(false);
      });
  }, [contextPath, enabled]);

  return { repos, isLoading, error };
}
