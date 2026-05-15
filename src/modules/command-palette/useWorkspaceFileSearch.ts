import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

export const COMMAND_PALETTE_FILE_SEARCH_MIN_QUERY_LENGTH = 2;
const COMMAND_PALETTE_FILE_SEARCH_LIMIT = 50;
const COMMAND_PALETTE_FILE_SEARCH_DEBOUNCE_MS = 120;

export type CommandPaletteFileHit = {
  path: string;
  rel: string;
  name: string;
  is_dir: boolean;
};

type Params = {
  root: string | null;
  query: string;
  enabled: boolean;
};

export function useWorkspaceFileSearch({ root, query, enabled }: Params) {
  const [results, setResults] = useState<CommandPaletteFileHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const applyHits = useCallback((hits: CommandPaletteFileHit[]) => {
    setResults(
      hits.filter((hit) => !hit.is_dir).slice(0, COMMAND_PALETTE_FILE_SEARCH_LIMIT),
    );
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setResults([]);
    setSearching(false);
    setError(null);
  }, []);

  const retry = useCallback(() => {
    const rootPath = root;
    const q = query.trim();
    if (!enabled || !rootPath || q.length < COMMAND_PALETTE_FILE_SEARCH_MIN_QUERY_LENGTH) {
      return;
    }

    const requestId = ++requestIdRef.current;
    setSearching(true);
    setError(null);
    void invoke<CommandPaletteFileHit[]>("fs_search", {
      root: rootPath,
      query: q,
      limit: COMMAND_PALETTE_FILE_SEARCH_LIMIT,
    })
      .then((hits) => {
        if (requestId !== requestIdRef.current) return;
        applyHits(hits);
      })
      .catch((e) => {
        if (requestId !== requestIdRef.current) return;
        setResults([]);
        setError(String(e));
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setSearching(false);
      });
  }, [applyHits, enabled, query, root]);

  useEffect(() => {
    const q = query.trim();
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (!enabled || !root || q.length < COMMAND_PALETTE_FILE_SEARCH_MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }

    setSearching(true);
    setError(null);
    setResults([]);

    const handle = window.setTimeout(() => {
      void invoke<CommandPaletteFileHit[]>("fs_search", {
        root,
        query: q,
        limit: COMMAND_PALETTE_FILE_SEARCH_LIMIT,
      })
        .then((hits) => {
          if (requestId !== requestIdRef.current) return;
          applyHits(hits);
        })
        .catch((e) => {
          if (requestId !== requestIdRef.current) return;
          setResults([]);
          setError(String(e));
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setSearching(false);
        });
    }, COMMAND_PALETTE_FILE_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(handle);
    };
  }, [applyHits, enabled, query, root]);

  return { results, searching, error, reset, retry };
}
