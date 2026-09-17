/** Shared notify path so Source Control can force-reload open editors
 * after a successful git discard without threading editorRefs. */

export const EDITOR_FORCE_RELOAD_EVENT = "editor:force-reload";

export type EditorForceReloadDetail = {
  paths: string[];
};

/** Paths that must force-reload on the next reload() call (even if dirty). */
const pendingForcePaths = new Set<string>();

export function normalizeEditorPath(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Join repo-relative discard paths onto repoRoot for editor tab matching. */
export function absoluteEditorPaths(
  repoRoot: string,
  paths: readonly string[],
): string[] {
  const normalizedRoot = normalizeEditorPath(repoRoot);
  const root =
    normalizedRoot === "/" ? "/" : normalizedRoot.replace(/\/$/, "");
  const out: string[] = [];
  for (const raw of paths) {
    const path = normalizeEditorPath(raw);
    if (!path) continue;
    if (path.startsWith("/") || /^[A-Za-z]:\//.test(path)) {
      out.push(path);
    } else if (root === "/") {
      out.push(`/${path}`);
    } else if (root) {
      out.push(`${root}/${path}`);
    } else {
      out.push(path);
    }
  }
  return out;
}

/** True once: marks this path for a dirty-bypassing reload (used by useDocument). */
export function takeForceReload(path: string): boolean {
  const normalized = normalizeEditorPath(path);
  if (!pendingForcePaths.has(normalized)) return false;
  pendingForcePaths.delete(normalized);
  return true;
}

/** Re-arm force markers so each matching tab can consume one (sibling tabs). */
export function armForceReload(paths: readonly string[]): void {
  for (const path of paths.map(normalizeEditorPath).filter((p) => p.length > 0)) {
    pendingForcePaths.add(path);
  }
}

/** Dispatch a window event listing paths that must reload from disk
 * even when the open buffer is still dirty (intentional discard). */
export function notifyEditorForceReload(paths: readonly string[]): void {
  const normalized = [
    ...new Set(
      paths.map(normalizeEditorPath).filter((path) => path.length > 0),
    ),
  ];
  if (normalized.length === 0) return;
  armForceReload(normalized);
  window.dispatchEvent(
    new CustomEvent<EditorForceReloadDetail>(EDITOR_FORCE_RELOAD_EVENT, {
      detail: { paths: normalized },
    }),
  );
}

/** Editor tab ids whose path is in the discarded set.
 * `path` is optional so callers can pass the full Tab union. */
export function editorTabIdsForPaths(
  tabs: ReadonlyArray<{ id: number; kind: string; path?: string }>,
  paths: readonly string[],
): number[] {
  const want = new Set(paths.map(normalizeEditorPath));
  if (want.size === 0) return [];
  const ids: number[] = [];
  for (const tab of tabs) {
    if (tab.kind !== "editor" || tab.path == null) continue;
    if (want.has(normalizeEditorPath(tab.path))) ids.push(tab.id);
  }
  return ids;
}

/** Test helper: clear pending force paths between cases. */
export function clearPendingForceReloads(): void {
  pendingForcePaths.clear();
}
