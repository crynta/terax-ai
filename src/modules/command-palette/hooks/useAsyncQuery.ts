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
  const timerRef = useRef<number | null>(null);
  const active = enabled && term.length >= minLength;

  const cancelPending = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const execute = useCallback(() => {
    cancelPending();
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
  }, [cancelPending, run, term]);

  useEffect(() => {
    if (!active) {
      setSnapshot(null);
      return;
    }
    timerRef.current = window.setTimeout(execute, debounceMs);
    return () => {
      cancelPending();
      requestIdRef.current += 1;
    };
  }, [active, cancelPending, debounceMs, execute]);

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
