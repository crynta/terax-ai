import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { listenFsChanged, watchAdd, watchRemove } from "./watch";

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

const EXPANSION_CACHE_LIMIT = 8;
const expansionCache = new Map<string, string[]>();
const DIR_CACHE_LIMIT = 256;
const dirCache = new Map<string, DirEntry[]>();

export function expansionCacheKey(workspaceKey: string, root: string): string {
  return `${workspaceKey}\0${root}`;
}

export function directoryCacheKey(
  workspaceKey: string,
  showHidden: boolean,
  path: string,
): string {
  return `${workspaceKey}\0${showHidden ? "1" : "0"}\0${path}`;
}

function rememberExpansion(key: string, expanded: Set<string>): void {
  expansionCache.delete(key);
  if (expanded.size > 0) expansionCache.set(key, [...expanded]);
  while (expansionCache.size > EXPANSION_CACHE_LIMIT) {
    const oldest = expansionCache.keys().next().value;
    if (oldest === undefined) break;
    expansionCache.delete(oldest);
  }
}

function recallExpansion(key: string): string[] {
  const v = expansionCache.get(key);
  if (!v) return [];
  expansionCache.delete(key);
  expansionCache.set(key, v);
  return v;
}

function rememberEntries(key: string, entries: DirEntry[]): void {
  dirCache.delete(key);
  dirCache.set(key, entries);
  while (dirCache.size > DIR_CACHE_LIMIT) {
    const oldest = dirCache.keys().next().value;
    if (oldest === undefined) break;
    dirCache.delete(oldest);
  }
}

function cachedEntries(key: string): DirEntry[] | null {
  const entries = dirCache.get(key);
  if (!entries) return null;
  dirCache.delete(key);
  dirCache.set(key, entries);
  return entries;
}

function isUnder(key: string, root: string): boolean {
  return key === root || key.startsWith(`${root}/`);
}

type Options = {
  workspace: WorkspaceEnv;
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
  enabled?: boolean;
};

export function useFileTree(rootPath: string | null, options: Options) {
  const workspace = options.workspace;
  const workspaceKey = workspaceScopeKey(workspace);
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const enabled = options.enabled ?? true;
  const showHiddenRef = useRef(showHidden);
  const [nodes, setNodes] = useState<TreeState>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(
    null,
  );
  const [renaming, setRenaming] = useState<string | null>(null);

  const expandedRef = useRef(expanded);
  const nodesRef = useRef(nodes);
  const watchedRef = useRef<Set<string>>(new Set());
  const treeScopeRef = useRef("");
  treeScopeRef.current = `${workspaceKey}\0${showHidden ? "1" : "0"}\0${rootPath ?? ""}`;

  useEffect(() => {
    showHiddenRef.current = showHidden;
  }, [showHidden]);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const addWatch = useCallback(
    (path: string) => {
      if (watchedRef.current.has(path)) return;
      watchedRef.current.add(path);
      watchAdd([path], workspace);
    },
    [workspace],
  );

  const removeWatch = useCallback(
    (path: string) => {
      if (!watchedRef.current.delete(path)) return;
      watchRemove([path], workspace);
    },
    [workspace],
  );

  const fetchChildren = useCallback(
    async (path: string, opts?: { showLoading?: boolean }) => {
      const runScope = treeScopeRef.current;
      const key = directoryCacheKey(workspaceKey, showHiddenRef.current, path);
      const cached = cachedEntries(key);
      if (cached && nodesRef.current[path]?.status !== "loaded") {
        setNodes((s) => ({
          ...s,
          [path]: { status: "loaded", entries: cached },
        }));
      } else if (opts?.showLoading ?? !cached) {
        setNodes((s) => ({ ...s, [path]: { status: "loading" } }));
      }
      try {
        const entries = await invoke<DirEntry[]>("fs_read_dir", {
          path,
          showHidden: showHiddenRef.current,
          workspace,
        });
        if (runScope !== treeScopeRef.current) return;
        rememberEntries(key, entries);

        const liveDirs = new Set(
          entries
            .filter((e) => e.kind === "dir")
            .map((e) => joinPath(path, e.name)),
        );
        const removedRoots: string[] = [];
        for (const key of Object.keys(nodesRef.current)) {
          if (dirname(key) === path && !liveDirs.has(key))
            removedRoots.push(key);
        }
        const dead = new Set<string>();
        if (removedRoots.length > 0) {
          const candidates = new Set<string>([
            ...Object.keys(nodesRef.current),
            ...expandedRef.current,
            ...watchedRef.current,
          ]);
          for (const k of candidates) {
            if (removedRoots.some((r) => isUnder(k, r))) dead.add(k);
          }
        }

        setNodes((s) => {
          const next: TreeState = {};
          for (const [k, v] of Object.entries(s)) {
            if (!dead.has(k)) next[k] = v;
          }
          next[path] = { status: "loaded", entries };
          return next;
        });

        if (dead.size > 0) {
          setExpanded((c) => {
            let changed = false;
            const n = new Set(c);
            for (const d of dead) if (n.delete(d)) changed = true;
            return changed ? n : c;
          });
          const toUnwatch: string[] = [];
          for (const d of dead)
            if (watchedRef.current.delete(d)) toUnwatch.push(d);
          watchRemove(toUnwatch, workspace);
        }
      } catch (e) {
        if (runScope !== treeScopeRef.current || cached) return;
        setNodes((s) => ({
          ...s,
          [path]: { status: "error", message: String(e) },
        }));
      }
    },
    [workspace, workspaceKey],
  );

  // Root change: restore cached expansion, re-scope watches, and persist the
  // outgoing root's expansion on cleanup.
  useEffect(() => {
    if (!enabled) return;
    if (!rootPath) {
      setNodes({});
      setExpanded(new Set());
      setPendingCreate(null);
      setRenaming(null);
      return;
    }
    setPendingCreate(null);
    setRenaming(null);

    const expansionKey = expansionCacheKey(workspaceKey, rootPath);
    const restored = recallExpansion(expansionKey);
    setExpanded(new Set(restored));
    const seededNodes: TreeState = {};
    for (const path of [rootPath, ...restored]) {
      const entries = cachedEntries(
        directoryCacheKey(workspaceKey, showHiddenRef.current, path),
      );
      if (entries) seededNodes[path] = { status: "loaded", entries };
    }
    setNodes(seededNodes);

    const toWatch = [rootPath, ...restored];
    void fetchChildren(rootPath, { showLoading: !seededNodes[rootPath] });
    for (const d of restored) {
      void fetchChildren(d, { showLoading: !seededNodes[d] });
    }
    for (const p of toWatch) watchedRef.current.add(p);
    watchAdd(toWatch, workspace);

    return () => {
      rememberExpansion(expansionKey, expandedRef.current);
      if (watchedRef.current.size > 0) {
        watchRemove([...watchedRef.current], workspace);
        watchedRef.current.clear();
      }
    };
  }, [rootPath, enabled, fetchChildren, workspace, workspaceKey]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void listenFsChanged((paths) => {
      const current = nodesRef.current;
      const dirs = new Set<string>();
      for (const p of paths) {
        const parent = dirname(p);
        if (current[parent]?.status === "loaded") dirs.add(parent);
        if (current[p]?.status === "loaded") dirs.add(p);
      }
      for (const d of dirs) void fetchChildren(d);
    }).then((un) => {
      if (alive) unlisten = un;
      else un();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [enabled, fetchChildren]);

  useEffect(() => {
    if (!enabled) return;
    if (!rootPath) return;
    const loadedPaths = Object.entries(nodes)
      .filter(([, state]) => state.status === "loaded")
      .map(([path]) => path);
    for (const path of loadedPaths) void fetchChildren(path);
    // Re-list loaded directories when the visibility preference changes.
    // `nodes` is intentionally omitted so ordinary tree edits don't refetch
    // every expanded directory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, showHidden, rootPath, fetchChildren]);

  const toggle = useCallback(
    (path: string) => {
      if (expandedRef.current.has(path)) {
        setExpanded((curr) => {
          const next = new Set(curr);
          next.delete(path);
          return next;
        });
        removeWatch(path);
      } else {
        setExpanded((curr) => {
          const next = new Set(curr);
          next.add(path);
          return next;
        });
        addWatch(path);
        void fetchChildren(path);
      }
    },
    [fetchChildren, addWatch, removeWatch],
  );

  const expand = useCallback(
    (path: string) => {
      if (expandedRef.current.has(path)) return;
      setExpanded((curr) => {
        const next = new Set(curr);
        next.add(path);
        return next;
      });
      addWatch(path);
      void fetchChildren(path);
    },
    [fetchChildren, addWatch],
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
        addWatch(parentPath);
      }
      setNodes((curr) => {
        if (!curr[parentPath]) void fetchChildren(parentPath);
        return curr;
      });
    },
    [rootPath, fetchChildren, addWatch],
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
        await invoke(cmd, { path, workspace });
        await fetchChildren(pendingCreate.parentPath);
      } catch (e) {
        console.error(`${cmd} failed:`, e);
      } finally {
        setPendingCreate(null);
      }
    },
    [pendingCreate, fetchChildren, workspace],
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
        await invoke("fs_rename", {
          from: renaming,
          to,
          workspace,
        });
        options?.onPathRenamed?.(renaming, to);
        await fetchChildren(parent);
      } catch (e) {
        console.error("fs_rename failed:", e);
      } finally {
        setRenaming(null);
      }
    },
    [renaming, fetchChildren, options, workspace],
  );

  const deletePath = useCallback(
    async (path: string) => {
      try {
        await invoke("fs_delete", { path, workspace });
        options?.onPathDeleted?.(path);
        await fetchChildren(dirname(path));
      } catch (e) {
        console.error("fs_delete failed:", e);
      }
    },
    [fetchChildren, options, workspace],
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
  };
}
