import {
  listenFsChanged,
  parentDir,
  watchAdd,
  watchRemove,
} from "@/modules/explorer/lib/watch";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import { createCoalescer, touchesPath } from "./lib/liveReload";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type MarkdownStatus =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "binary" }
  | { kind: "toolarge"; size: number; limit: number }
  | { kind: "error"; message: string };

function toStatus(res: ReadResult): MarkdownStatus {
  if (res.kind === "text") return { kind: "ready", content: res.content };
  if (res.kind === "binary") return { kind: "binary" };
  return { kind: "toolarge", size: res.size, limit: res.limit };
}

/**
 * Reads `path` and keeps it current: an `fs:changed` for the file or an app
 * write to it re-reads after a short coalescing window. A reload never shows
 * the loading state, keeps the last good text when a read fails midway
 * through an agent's atomic rewrite, and returns the same status object when
 * nothing changed so unchanged documents do not re-render. A hidden tab only
 * remembers that it is stale and catches up when shown.
 */
export function useMarkdownDocument(
  path: string,
  visible: boolean,
): MarkdownStatus {
  const [status, setStatus] = useState<MarkdownStatus>({ kind: "loading" });
  const visibleRef = useRef(visible);
  const reloadRef = useRef<(() => void) | null>(null);
  const staleRef = useRef(false);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible && staleRef.current) {
      staleRef.current = false;
      reloadRef.current?.();
    }
  }, [visible]);

  useEffect(() => {
    let alive = true;
    let requestId = 0;
    const workspace = currentWorkspaceEnv();
    // The watcher reports canonical paths; the tab may hold an alias spelling.
    let canonical: string | null = null;
    staleRef.current = false;
    setStatus({ kind: "loading" });

    const read = () => {
      const id = ++requestId;
      invoke<ReadResult>("fs_read_file", {
        path,
        workspace,
      })
        .then((res) => {
          if (!alive || id !== requestId) return;
          const next = toStatus(res);
          setStatus((prev) =>
            prev.kind === "ready" &&
            next.kind === "ready" &&
            prev.content === next.content
              ? prev
              : next,
          );
        })
        .catch((e) => {
          if (!alive || id !== requestId) return;
          setStatus((prev) =>
            prev.kind === "loading"
              ? { kind: "error", message: String(e) }
              : prev,
          );
        });
    };

    const coalescer = createCoalescer(read);
    const onTouched = () => {
      if (visibleRef.current) coalescer.poke();
      else staleRef.current = true;
    };
    reloadRef.current = read;

    const matches = (paths: readonly string[]) =>
      touchesPath(paths, path) ||
      (canonical !== null && touchesPath(paths, canonical));

    const dir = parentDir(path);
    watchAdd([dir], [path], workspace);
    const unlisten: Array<() => void> = [];
    const track = (pending: Promise<() => void>) =>
      void pending.then((un) => (alive ? unlisten.push(un) : un()));
    track(
      listenFsChanged((paths) => {
        if (matches(paths)) onTouched();
      }),
    );
    track(
      getCurrentWebviewWindow().listen<{ path: string }>(
        "fs:file-written",
        (e) => {
          if (matches([e.payload.path])) onTouched();
        },
      ),
    );

    read();
    invoke<string>("fs_canonicalize", { path, workspace })
      .then((c) => {
        if (alive) canonical = c;
      })
      .catch(() => {});

    return () => {
      alive = false;
      coalescer.cancel();
      reloadRef.current = null;
      for (const un of unlisten) un();
      watchRemove([dir], [path], workspace);
    };
  }, [path]);

  return status;
}
