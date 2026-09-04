/** Shared notify path so Source Control can force-reload open editors
 * after a successful git discard without threading editorRefs. */

export const EDITOR_FORCE_RELOAD_EVENT = "editor:force-reload";

export type EditorForceReloadDetail = {
  paths: string[];
};

export function normalizeEditorPath(path: string): string {
  return path.replace(/\\/g, "/");
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
  window.dispatchEvent(
    new CustomEvent<EditorForceReloadDetail>(EDITOR_FORCE_RELOAD_EVENT, {
      detail: { paths: normalized },
    }),
  );
}

/** Editor tab ids whose path is in the discarded set. */
export function editorTabIdsForPaths(
  tabs: ReadonlyArray<{ id: number; kind: string; path: string }>,
  paths: readonly string[],
): number[] {
  const want = new Set(paths.map(normalizeEditorPath));
  if (want.size === 0) return [];
  const ids: number[] = [];
  for (const tab of tabs) {
    if (tab.kind !== "editor") continue;
    if (want.has(normalizeEditorPath(tab.path))) ids.push(tab.id);
  }
  return ids;
}
