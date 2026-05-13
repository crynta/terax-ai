import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

type FsChangedPayload = {
  root: string;
  paths: string[];
};

type Options = {
  onInvalidate: (paths: string[]) => void;
};

export function useFileTreeWatcher(rootPath: string | null, { onInvalidate }: Options) {
  const pendingPathsRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onInvalidateRef = useRef(onInvalidate);

  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    if (!rootPath) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    const flush = () => {
      flushTimerRef.current = null;
      const paths = [...pendingPathsRef.current];
      pendingPathsRef.current.clear();
      if (paths.length > 0) onInvalidateRef.current(paths);
    };

    const setup = async () => {
      try {
        const unlistenFn = await listen<FsChangedPayload>("fs://changed", (event) => {
          if (event.payload.root !== rootPath) return;

          for (const path of event.payload.paths) pendingPathsRef.current.add(path);

          if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
          flushTimerRef.current = setTimeout(flush, 100);
        });

        if (disposed) {
          unlistenFn();
          return;
        }

        unlisten = unlistenFn;

        try {
          await invoke("fs_watch_start", { path: rootPath });
          if (disposed) await invoke("fs_watch_stop", { path: rootPath });
        } catch (e) {
          console.error("fs_watch_start failed:", e);
        }
      } catch (e) {
        console.error("fs://changed listen failed:", e);
      }
    };

    void setup();

    return () => {
      disposed = true;
      unlisten?.();
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingPathsRef.current.clear();
      void invoke("fs_watch_stop", { path: rootPath }).catch((e) => {
        console.error("fs_watch_stop failed:", e);
      });
    };
  }, [rootPath]);
}
