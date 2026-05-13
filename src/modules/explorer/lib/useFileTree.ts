import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";

export type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
};

type ChildrenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; entries: DirEntry[] }
  | { status: "error"; message: string };

type TreeState = Record<string, ChildrenState>;

export type PendingCreate = {
  parentPath: string;
  kind: "file" | "dir";
};

export function joinPath(parent: string, name: string): string {
  if (parent.endsWith("/")) return `${parent}${name}`;
  return `${parent}/${name}`;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  if (i <= 0) return "/";
  return path.slice(0, i);
}

export function affectedDirsForPath(path: string, rootPath: string): string[] {
  if (rootPath !== "/" && path !== rootPath && !path.startsWith(joinPath(rootPath, ""))) return [];
  if (rootPath === "/" && !path.startsWith("/")) return [];

  const dirs = new Set<string>();
  let current = path;

  dirs.add(dirname(current));

  while (current && current !== rootPath && current !== "/") {
    dirs.add(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  dirs.add(rootPath);
  return [...dirs];
}

type Options = {
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
};

type FsChangedPayload = {
  root: string;
  paths: string[];
};

export function useFileTree(rawRootPath: string | null, options?: Options) {
  // Normalize: strip trailing slash (except for root "/") to prevent
  // watcher restart + root mismatch when terminal CWD has trailing slash.
  const rootPath = rawRootPath
    ? rawRootPath === "/"
      ? "/"
      : rawRootPath.replace(/\/+$/, "")
    : null;
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const showHiddenRef = useRef(showHidden);
  const [nodes, setNodes] = useState<TreeState>({});
  const nodesRef = useRef<TreeState>({});
  const pendingWatcherPathsRef = useRef<Set<string>>(new Set());
  const watcherFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(
    null,
  );
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    showHiddenRef.current = showHidden;
  }, [showHidden]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const fetchChildren = useCallback(async (path: string) => {
    setNodes((s) =>
      s[path]?.status === "loaded"
        ? s // already loaded — keep showing entries during refresh
        : { ...s, [path]: { status: "loading" } },
    );
    try {
      const entries = await invoke<DirEntry[]>("fs_read_dir", {
        path,
        showHidden: showHiddenRef.current,
      });
      setNodes((s) => ({ ...s, [path]: { status: "loaded", entries } }));
      // Add this directory to the watcher so changes are detected.
      void invoke("fs_watch_add", { path }).catch(() => {});
    } catch (e) {
      setNodes((s) => ({
        ...s,
        [path]: { status: "error", message: String(e) },
      }));
    }
  }, []);

  const flushWatcherRefresh = useCallback(() => {
    if (!rootPath) return;
    const paths = [...pendingWatcherPathsRef.current];
    pendingWatcherPathsRef.current.clear();
    if (paths.length === 0) return;

    const affectedDirs = new Set<string>();
    for (const path of paths) {
      for (const dir of affectedDirsForPath(path, rootPath)) {
        const node = nodesRef.current[dir];
        if (dir === rootPath || node?.status === "loaded") {
          affectedDirs.add(dir);
        }
      }
    }

    for (const dir of affectedDirs) {
      void fetchChildren(dir);
    }
  }, [fetchChildren, rootPath]);

  // Root change → reset state and fetch.
  useEffect(() => {
    if (!rootPath) {
      setNodes({});
      setExpanded(new Set());
      setPendingCreate(null);
      setRenaming(null);
      return;
    }
    setPendingCreate(null);
    setRenaming(null);
    setExpanded(new Set());
    setNodes({});
    void fetchChildren(rootPath);
  }, [rootPath, fetchChildren]);

  useEffect(() => {
    if (!rootPath) return;
    const loadedPaths = Object.entries(nodes)
      .filter(([, state]) => state.status === "loaded")
      .map(([path]) => path);
    for (const path of loadedPaths) void fetchChildren(path);
    // Re-list loaded directories when the visibility preference changes.
    // `nodes` is intentionally omitted so ordinary tree edits don't refetch
    // every expanded directory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden, rootPath, fetchChildren]);

  useEffect(() => {
    if (!rootPath) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      try {
        const unlistenFn = await listen<FsChangedPayload>("fs://changed", (event) => {
          if (event.payload.root !== rootPath) return;

          for (const path of event.payload.paths) {
            pendingWatcherPathsRef.current.add(path);
          }

          if (watcherFlushTimerRef.current) {
            clearTimeout(watcherFlushTimerRef.current);
          }
          watcherFlushTimerRef.current = setTimeout(() => {
            watcherFlushTimerRef.current = null;
            flushWatcherRefresh();
          }, 100);
        });

        if (disposed) {
          unlistenFn();
          return;
        }

        unlisten = unlistenFn;

        try {
          await invoke("fs_watch_start", { path: rootPath });
          if (disposed) {
            await invoke("fs_watch_stop", { path: rootPath });
          }
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
      if (watcherFlushTimerRef.current) {
        clearTimeout(watcherFlushTimerRef.current);
        watcherFlushTimerRef.current = null;
      }
      pendingWatcherPathsRef.current.clear();
      void invoke("fs_watch_stop", { path: rootPath }).catch((e) => {
        console.error("fs_watch_stop failed:", e);
      });
    };
  }, [rootPath, flushWatcherRefresh]);

  const toggle = useCallback(
    (path: string) => {
      let isCollapsing = false;
      setExpanded((curr) => {
        const next = new Set(curr);
        if (next.has(path)) {
          next.delete(path);
          isCollapsing = true;
        } else {
          next.add(path);
        }
        return next;
      });
      if (isCollapsing) {
        // Remove watcher for collapsed directory
        void invoke("fs_watch_remove", { path }).catch(() => {});
      } else {
        setNodes((curr) => {
          if (!curr[path] || curr[path].status === "error") {
            void fetchChildren(path);
          }
          return curr;
        });
      }
    },
    [fetchChildren],
  );

  const expand = useCallback(
    (path: string) => {
      setExpanded((curr) => {
        if (curr.has(path)) return curr;
        const next = new Set(curr);
        next.add(path);
        return next;
      });
      setNodes((curr) => {
        if (!curr[path]) void fetchChildren(path);
        return curr;
      });
    },
    [fetchChildren],
  );

  const refresh = useCallback(
    (path: string) => {
      void fetchChildren(path);
    },
    [fetchChildren],
  );

  // --- mutations ---

  const beginCreate = useCallback(
    (parentPath: string, kind: "file" | "dir") => {
      setRenaming(null);
      setPendingCreate({ parentPath, kind });
      // Ensure the parent is expanded so the input row is visible.
      if (rootPath && parentPath !== rootPath) {
        setExpanded((curr) => {
          if (curr.has(parentPath)) return curr;
          const next = new Set(curr);
          next.add(parentPath);
          return next;
        });
      }
      setNodes((curr) => {
        if (!curr[parentPath]) void fetchChildren(parentPath);
        return curr;
      });
    },
    [rootPath, fetchChildren],
  );

  const cancelCreate = useCallback(() => setPendingCreate(null), []);

  const commitCreate = useCallback(
    async (name: string) => {
      if (!pendingCreate) return;
      const trimmed = name.trim();
      if (!trimmed) {
        setPendingCreate(null);
        return;
      }
      const path = joinPath(pendingCreate.parentPath, trimmed);
      const cmd =
        pendingCreate.kind === "dir" ? "fs_create_dir" : "fs_create_file";
      try {
        await invoke(cmd, { path });
        await fetchChildren(pendingCreate.parentPath);
      } catch (e) {
        console.error(`${cmd} failed:`, e);
      } finally {
        setPendingCreate(null);
      }
    },
    [pendingCreate, fetchChildren],
  );

  const beginRename = useCallback((path: string) => {
    setPendingCreate(null);
    setRenaming(path);
  }, []);

  const cancelRename = useCallback(() => setRenaming(null), []);

  const commitRename = useCallback(
    async (newName: string) => {
      if (!renaming) return;
      const trimmed = newName.trim();
      const parent = dirname(renaming);
      const oldName = renaming.slice(parent === "/" ? 1 : parent.length + 1);
      if (!trimmed || trimmed === oldName) {
        setRenaming(null);
        return;
      }
      const to = joinPath(parent, trimmed);
      try {
        await invoke("fs_rename", { from: renaming, to });
        options?.onPathRenamed?.(renaming, to);
        await fetchChildren(parent);
      } catch (e) {
        console.error("fs_rename failed:", e);
      } finally {
        setRenaming(null);
      }
    },
    [renaming, fetchChildren, options],
  );

  const deletePath = useCallback(
    async (path: string) => {
      try {
        await invoke("fs_delete", { path });
        options?.onPathDeleted?.(path);
        await fetchChildren(dirname(path));
      } catch (e) {
        console.error("fs_delete failed:", e);
      }
    },
    [fetchChildren, options],
  );

  return {
    nodes,
    expanded,
    pendingCreate,
    renaming,
    toggle,
    expand,
    refresh,
    beginCreate,
    cancelCreate,
    commitCreate,
    beginRename,
    cancelRename,
    commitRename,
    deletePath,
    joinPath,
    rootPath,
  };
}
