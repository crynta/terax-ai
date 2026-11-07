import { useCallback, useEffect, useRef, useState } from "react";

type Params<T> = {
  enabled: boolean;
  term: string;
  minLength: number;
  debounceMs: number;
  run: (term: string) => Promise<T[]>;
};

export type AsyncQueryState<T> = {
  results: T[];
  loading: boolean;
  error: string | null;
  retry: () => void;
};

type Snapshot<T> = Omit<AsyncQueryState<T>, "retry"> & {
  run: Params<T>["run"];
  term: string;
};

const EMPTY: never[] = [];

export function useAsyncQuery<T>({
  enabled,
  term,
  minLength,
  debounceMs,
  run,
}: Params<T>): AsyncQueryState<T> {
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null);
  const requestIdRef = useRef(0);
  const active = enabled && term.length >= minLength;

  const execute = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setSnapshot({ run, term, results: [], loading: true, error: null });
    run(term)
      .then((results) => {
        if (requestId !== requestIdRef.current) return;
        setSnapshot({ run, term, results, loading: false, error: null });
      })
      .catch((e) => {
        if (requestId !== requestIdRef.current) return;
        setSnapshot({
          run,
          term,
          results: [],
          loading: false,
          error: String(e),
        });
      });
  }, [run, term]);

  useEffect(() => {
    if (!active) {
      setSnapshot(null);
      return;
    }
    const handle = window.setTimeout(execute, debounceMs);
    return () => {
      window.clearTimeout(handle);
      requestIdRef.current += 1;
    };
  }, [active, debounceMs, execute]);

  const retry = useCallback(() => {
    if (active) execute();
  }, [active, execute]);

  const current =
    active && snapshot?.run === run && snapshot.term === term ? snapshot : null;
  return {
    results: current?.results ?? EMPTY,
    loading: current?.loading ?? active,
    error: current?.error ?? null,
    retry,
  };
}
