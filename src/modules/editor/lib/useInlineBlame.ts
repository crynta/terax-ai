import { useEffect } from "react";
import { native } from "@/modules/ai/lib/native";
import type { EditorView } from "@codemirror/view";
import { setBlame } from "./blame";

function parentDir(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx > 0 ? path.slice(0, idx) : path;
}

/**
 * Loads git blame for `path` and pushes it into the editor state. Refetches
 * when `revision` changes (a save) so annotations follow the file on disk.
 */
export function useInlineBlame(
  path: string,
  enabled: boolean,
  getView: () => EditorView | null | undefined,
  revision: number,
): void {
  useEffect(() => {
    const view = getView();
    if (!enabled) {
      view?.dispatch({ effects: setBlame.of(null) });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const repo = await native.gitResolveRepo(parentDir(path));
        if (cancelled || !repo) return;
        const lines = await native.gitBlame(repo.repoRoot, path);
        if (cancelled) return;
        getView()?.dispatch({ effects: setBlame.of(lines) });
      } catch {
        // Not a repo, unreadable file, git missing: annotations stay off.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, enabled, revision, getView]);
}
