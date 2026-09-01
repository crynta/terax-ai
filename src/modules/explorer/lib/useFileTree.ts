import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { listenFsChanged, watchAdd, watchRemove } from "./watch";

export type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
  gitignored: boolean;
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

export type BatchMoveItem = {
  from: string;
  to: string;
  name: string;
  conflict: boolean;
};

// Pure planning step for a batch move: pairs each source with its destination
// path and flags a conflict when the name collides with something already in
// the target dir, or with an earlier item in the same batch (processed in
// selection order, so the earlier item "wins" the name first). Sources
// already directly in the target are no-ops and dropped from the plan.
export function planBatchMove(
  sources: string[],
  toDir: string,
  existingNames: string[],
): BatchMoveItem[] {
  const existing = new Set(existingNames);
  const claimed = new Set<string>();
  const items: BatchMoveItem[] = [];
  for (const from of sources) {
    const name = from.slice(from.lastIndexOf("/") + 1);
    const to = joinPath(toDir, name);
    if (to === from) continue;
    const conflict = existing.has(name) || claimed.has(name);
    claimed.add(name);
    items.push({ from, to, name, conflict });
  }
  return items;
}

// A selection can contain both a directory and one of its own descendants;
// moving both independently (in parallel) can move the child twice or race
// against the parent's own move. Drop any source nested under another
// selected source before planning or running the moves.
export function excludeNestedSources(sources: string[]): string[] {
  return sources.filter(
    (path) =>
      !sources.some(
        (other) => other !== path && path.startsWith(`${other}/`),
      ),
  );
}

const EXPANSION_CACHE_LIMIT = 8;
const expansionCache = new Map<string, string[]>();

function rememberExpansion(root: string, expanded: Set<string>): void {
  expansionCache.delete(root);
  if (expanded.size > 0) expansionCache.set(root, [...expanded]);
  while (expansionCache.size > EXPANSION_CACHE_LIMIT) {
    const oldest = expansionCache.keys().next().value;
    if (oldest === undefined) break;
    expansionCache.delete(oldest);
  }
}

function recallExpansion(root: string): string[] {
  const v = expansionCache.get(root);
  if (!v) return [];
  expansionCache.delete(root);
  expansionCache.set(root, v);
  return v;
}

function isUnder(key: string, root: string): boolean {
  return key === root || key.startsWith(`${root}/`);
}

// mtime/size are ignored on purpose: the tree never renders them, so a watcher
// refetch that only bumps mtime (saving a file) must not count as a change.
function sameDirListing(a: DirEntry[], b: DirEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].name !== b[i].name ||
      a[i].kind !== b[i].kind ||
      a[i].gitignored !== b[i].gitignored
    )
      return false;
  }
  return true;
}

type Options = {
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
};

export function useFileTree(rootPath: string | null, options?: Options) {
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const showHiddenRef = useRef(showHidden);
  const gitDecorations = usePreferencesStore((s) => s.explorerGitDecorations);
  const gitDecorationsRef = useRef(gitDecorations);
  const [nodes, setNodes] = useState<TreeState>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(
    null,
  );
  const [renaming, setRenaming] = useState<string | null>(null);

  const expandedRef = useRef(expanded);
  const nodesRef = useRef(nodes);
  const watchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    showHiddenRef.current = showHidden;
  }, [showHidden]);

  useEffect(() => {
    gitDecorationsRef.current = gitDecorations;
  }, [gitDecorations]);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const addWatch = useCallback((path: string) => {
    if (watchedRef.current.has(path)) return;
    watchedRef.current.add(path);
    watchAdd([path]);
  }, []);

  const removeWatch = useCallback((path: string) => {
    if (!watchedRef.current.delete(path)) return;
    watchRemove([path]);
  }, []);

  const fetchChildren = useCallback(async (path: string) => {
    if (nodesRef.current[path]?.status !== "loaded") {
      setNodes((s) => ({ ...s, [path]: { status: "loading" } }));
    }
    try {
      const entries = await invoke<DirEntry[]>("fs_read_dir", {
        path,
        showHidden: showHiddenRef.current,
        gitDecorations: gitDecorationsRef.current,
        workspace: currentWorkspaceEnv(),
      });

      const prev = nodesRef.current[path];
      if (prev?.status === "loaded" && sameDirListing(prev.entries, entries)) {
        return;
      }

      const liveDirs = new Set(
        entries.filter((e) => e.kind === "dir").map((e) => joinPath(path, e.name)),
      );
      const removedRoots: string[] = [];
      for (const key of Object.keys(nodesRef.current)) {
        if (dirname(key) === path && !liveDirs.has(key)) removedRoots.push(key);
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
        for (const [k, v] of Object.entries(s)) if (!dead.has(k)) next[k] = v;
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
        for (const d of dead) if (watchedRef.current.delete(d)) toUnwatch.push(d);
        watchRemove(toUnwatch);
      }
    } catch (e) {
      setNodes((s) => ({
        ...s,
        [path]: { status: "error", message: String(e) },
      }));
    }
  }, []);

  // Root change → restore the cached expansion for this root, re-scope watches,
  // and persist the outgoing root's expansion on the way out.
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

    const restored = recallExpansion(rootPath);
    setExpanded(new Set(restored));
    setNodes({});
    // Sync the ref synchronously: nodesRef only updates after the next render,
    // so without this a fast (cached) fetchChildren below would read the stale
    // pre-clear "loaded" node, hit the sameDirListing early-return, and skip
    // re-populating — leaving a valid root with an empty tree when rootPath
    // changes rapidly (e.g. switching folders in quick succession).
    nodesRef.current = {};

    const toWatch = [rootPath, ...restored];
    void fetchChildren(rootPath);
    for (const d of restored) void fetchChildren(d);
    for (const p of toWatch) watchedRef.current.add(p);
    watchAdd(toWatch);

    return () => {
      rememberExpansion(rootPath, expandedRef.current);
      if (watchedRef.current.size > 0) {
        watchRemove([...watchedRef.current]);
        watchedRef.current.clear();
      }
    };
  }, [rootPath, fetchChildren]);

  useEffect(() => {
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
  }, [fetchChildren]);

  useEffect(() => {
    if (!rootPath) return;
    const loadedPaths = Object.entries(nodes)
      .filter(([, state]) => state.status === "loaded")
      .map(([path]) => path);
    for (const path of loadedPaths) void fetchChildren(path);
    // Re-list loaded directories when visibility or git-decoration prefs change.
    // `nodes` is intentionally omitted so ordinary tree edits don't refetch
    // every expanded directory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden, gitDecorations, rootPath, fetchChildren]);

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
        await invoke(cmd, { path, workspace: currentWorkspaceEnv() });
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
        await invoke("fs_rename", {
          from: renaming,
          to,
          workspace: currentWorkspaceEnv(),
        });
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
        await invoke("fs_delete", { path, workspace: currentWorkspaceEnv() });
        options?.onPathDeleted?.(path);
        await fetchChildren(dirname(path));
      } catch (e) {
        console.error("fs_delete failed:", e);
      }
    },
    [fetchChildren, options],
  );

  const deletePaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      // fs_delete already recurses into directories, so a selected descendant
      // of a selected directory would race that directory's own deletion and
      // surface as a spurious per-item failure.
      const topLevelPaths = excludeNestedSources(paths);
      const results = await Promise.allSettled(
        topLevelPaths.map((path) =>
          invoke("fs_delete", { path, workspace: currentWorkspaceEnv() }),
        ),
      );
      const parents = new Set<string>();
      let anyFailed = false;
      topLevelPaths.forEach((path, i) => {
        if (results[i].status === "fulfilled") {
          options?.onPathDeleted?.(path);
          parents.add(dirname(path));
        } else {
          anyFailed = true;
          console.error(
            "fs_delete failed:",
            (results[i] as PromiseRejectedResult).reason,
          );
        }
      });
      await Promise.all([...parents].map((p) => fetchChildren(p)));
      if (anyFailed) toast.error("Delete failed for one or more items");
    },
    [fetchChildren, options],
  );

  const movePath = useCallback(
    async (from: string, toDir: string) => {
      const name = from.slice(from.lastIndexOf("/") + 1);
      const to = joinPath(toDir, name);
      if (to === from) return;
      const target = nodesRef.current[toDir];
      if (
        target?.status === "loaded" &&
        target.entries.some((e) => e.name === name)
      ) {
        console.warn(`move skipped: "${name}" already exists in ${toDir}`);
        return;
      }
      try {
        await invoke("fs_rename", {
          from,
          to,
          workspace: currentWorkspaceEnv(),
        });
        options?.onPathRenamed?.(from, to);
        await Promise.all([fetchChildren(dirname(from)), fetchChildren(toDir)]);
      } catch (e) {
        console.error("fs_rename (move) failed:", e);
      }
    },
    [fetchChildren, options],
  );

  // Batch move: non-conflicting items move immediately in parallel; each name
  // collision (against the target dir or another item in the same batch) gets
  // an interactive Replace/Skip toast, mirroring VS Code. Silent on full
  // success, since the conflict toasts already say everything interactive.
  const movePaths = useCallback(
    async (sources: string[], toDir: string) => {
      if (sources.length === 0) return;

      const target = nodesRef.current[toDir];
      let existingNames: string[];
      if (target?.status === "loaded") {
        existingNames = target.entries.map((e) => e.name);
      } else {
        try {
          const entries = await invoke<DirEntry[]>("fs_read_dir", {
            path: toDir,
            showHidden: showHiddenRef.current,
            gitDecorations: gitDecorationsRef.current,
            workspace: currentWorkspaceEnv(),
          });
          existingNames = entries.map((e) => e.name);
        } catch (e) {
          console.error("fs_read_dir (move target) failed:", e);
          existingNames = [];
        }
      }
      const items = planBatchMove(
        excludeNestedSources(sources),
        toDir,
        existingNames,
      );
      if (items.length === 0) return;

      const parents = new Set<string>([toDir]);
      let anySucceeded = false;
      let anyUnexpectedFailure = false;

      const moveOne = async (from: string, to: string) => {
        await invoke("fs_rename", { from, to, workspace: currentWorkspaceEnv() });
        options?.onPathRenamed?.(from, to);
        parents.add(dirname(from));
        anySucceeded = true;
      };

      const nonConflicting = items.filter((i) => !i.conflict);
      const conflicting = items.filter((i) => i.conflict);

      const results = await Promise.allSettled(
        nonConflicting.map((i) => moveOne(i.from, i.to)),
      );
      for (const r of results) {
        if (r.status === "rejected") {
          anyUnexpectedFailure = true;
          console.error("fs_rename (move) failed:", r.reason);
        }
      }

      for (const item of conflicting) {
        const resolution = await new Promise<"replace" | "skip">((resolve) => {
          toast.warning(`"${item.name}" already exists`, {
            duration: Infinity,
            action: { label: "Replace", onClick: () => resolve("replace") },
            cancel: { label: "Skip", onClick: () => resolve("skip") },
            onDismiss: () => resolve("skip"),
          });
        });
        if (resolution === "skip") continue;
        // Replace without ever deleting the existing destination outright: move
        // it aside first, then move the source in. If the second rename fails,
        // move the backup back rather than leaving the destination gone.
        const backupTo = `${item.to}.terax-replace-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;
        try {
          await invoke("fs_rename", {
            from: item.to,
            to: backupTo,
            workspace: currentWorkspaceEnv(),
          });
        } catch (e) {
          anyUnexpectedFailure = true;
          console.error("fs_rename (replace backup) failed:", e);
          continue;
        }
        try {
          await moveOne(item.from, item.to);
          await invoke("fs_delete", {
            path: backupTo,
            workspace: currentWorkspaceEnv(),
          });
        } catch (e) {
          anyUnexpectedFailure = true;
          console.error("fs_rename (replace) failed:", e);
          try {
            await invoke("fs_rename", {
              from: backupTo,
              to: item.to,
              workspace: currentWorkspaceEnv(),
            });
          } catch (restoreErr) {
            console.error(
              `fs_rename (restore after failed replace) failed; original "${item.name}" left at ${backupTo}:`,
              restoreErr,
            );
          }
        }
      }

      await Promise.all([...parents].map((p) => fetchChildren(p)));

      if (anyUnexpectedFailure) {
        toast.error(anySucceeded ? "Some items could not be moved" : "Move failed");
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
    deletePaths,
    movePath,
    movePaths,
    joinPath,
  };
}
