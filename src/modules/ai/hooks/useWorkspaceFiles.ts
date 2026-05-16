import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { currentWorkspaceEnv } from "@/modules/workspace";

export type WorkspaceFilesState = {
  files: string[];
  indexing: boolean;
  truncated: boolean;
};

type ListFilesResult = { files: string[]; truncated: boolean };

type CacheEntry = {
  files: string[];
  truncated: boolean;
  fetchedAt: number;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

function fetchFiles(root: string): Promise<CacheEntry> {
  const existing = inflight.get(root);
  if (existing) return existing;
  const promise = invoke<ListFilesResult>("fs_list_files", {
    root,
    workspace: currentWorkspaceEnv(),
  })
    .then((res) => {
      const entry: CacheEntry = {
        files: res.files,
        truncated: res.truncated,
        fetchedAt: Date.now(),
      };
      cache.set(root, entry);
      return entry;
    })
    .finally(() => {
      inflight.delete(root);
    });
  inflight.set(root, promise);
  return promise;
}

export function useWorkspaceFiles(
  workspaceRoot: string | null,
  enabled: boolean,
): WorkspaceFilesState {
  const [state, setState] = useState<WorkspaceFilesState>(() => {
    if (!workspaceRoot) {
      return { files: [], indexing: false, truncated: false };
    }
    const cached = cache.get(workspaceRoot);
    return cached
      ? { files: cached.files, truncated: cached.truncated, indexing: false }
      : { files: [], indexing: false, truncated: false };
  });

  useEffect(() => {
    if (!workspaceRoot) {
      setState({ files: [], indexing: false, truncated: false });
      return;
    }

    const cached = cache.get(workspaceRoot);
    if (cached) {
      setState({
        files: cached.files,
        truncated: cached.truncated,
        indexing: false,
      });
      if (isFresh(cached)) return;
    }

    if (!enabled) return;

    let cancelled = false;
    setState((s) => ({ ...s, indexing: true }));
    fetchFiles(workspaceRoot)
      .then((entry) => {
        if (cancelled) return;
        setState({
          files: entry.files,
          truncated: entry.truncated,
          indexing: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState((s) => ({ ...s, indexing: false }));
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, enabled]);

  return state;
}
