import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileHit } from "../lib/quickOpen";

const LIMIT = 100;
const REQUEST_KEY = "palette-files";

type SearchResponse = {
  hits: FileHit[];
  truncated: boolean;
  cancelled: boolean;
};

export type FileSearchState = {
  hits: FileHit[];
  loading: boolean;
  error: string | null;
  retry: () => void;
};

type Snapshot = Omit<FileSearchState, "retry">;

const IDLE: Snapshot = { hits: [], loading: false, error: null };

/**
 * Fuzzy file search over the Rust-side cached index. No debounce: every
 * keystroke asks, the backend drops the superseded query, and a reply for an
 * older query is ignored here as well. The previous hits stay on screen until
 * the new ones land so the list never blanks between keystrokes.
 */
export function useFileSearch(
  root: string | null,
  query: string,
  enabled: boolean,
  showHidden: boolean,
): FileSearchState {
  const [state, setState] = useState<Snapshot>(IDLE);
  const requestIdRef = useRef(0);

  const execute = useCallback(
    (q: string) => {
      if (!root) return;
      const requestId = ++requestIdRef.current;
      setState((s) => ({ ...s, loading: true, error: null }));
      invoke<SearchResponse>("fs_search", {
        root,
        query: q,
        limit: LIMIT,
        showHidden,
        filesOnly: true,
        withIndices: true,
        requestKey: REQUEST_KEY,
        workspace: currentWorkspaceEnv(),
      })
        .then((res) => {
          if (requestId !== requestIdRef.current) return;
          if (res.cancelled) setState((s) => ({ ...s, loading: false }));
          else setState({ hits: res.hits, loading: false, error: null });
        })
        .catch((e) => {
          if (requestId !== requestIdRef.current) return;
          setState({ hits: [], loading: false, error: String(e) });
        });
    },
    [root, showHidden],
  );

  useEffect(() => {
    requestIdRef.current += 1;
    if (!enabled || !root || !query) {
      setState(IDLE);
      return;
    }
    execute(query);
  }, [enabled, root, query, execute]);

  // Building the index is the slow part of the first search in a project; do
  // it while the user is still typing the first character.
  useEffect(() => {
    if (!enabled || !root) return;
    void invoke("fs_warm_index", {
      root,
      showHidden,
      workspace: currentWorkspaceEnv(),
    }).catch(() => {});
  }, [enabled, root, showHidden]);

  const retry = useCallback(() => {
    if (enabled && root && query) execute(query);
  }, [enabled, root, query, execute]);

  return { ...state, retry };
}
