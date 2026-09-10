import { useEffect } from "react";
import { native } from "@/modules/ai/lib/native";
import type { EditorView } from "@codemirror/view";
import { setBlame } from "./blame";

/**
 * Directory holding `path`. Root-level files keep their filesystem root
 * (`/`, `C:\`) so repo resolution starts somewhere real.
 */
export function parentDir(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (idx < 0) return path;
  if (idx === 0) return path[0];
  // "C:\file" -> "C:\", not the drive-relative "C:".
  if (idx === 2 && /^[A-Za-z]:[/\\]/.test(path)) return path.slice(0, 3);
  return path.slice(0, idx);
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
    // Blame is indexed against the document we requested it for. If an edit
    // lands while git runs, the answer no longer describes these lines.
    const requestedDoc = view?.state.doc;
    void (async () => {
      try {
        const repo = await native.gitResolveRepo(parentDir(path));
        if (cancelled || !repo) return;
        const lines = await native.gitBlame(repo.repoRoot, path);
        if (cancelled) return;
        const current = getView();
        // No view at request time means the editor had not mounted yet, so
        // there is nothing the answer could be stale against.
        if (!current) return;
        if (requestedDoc && current.state.doc !== requestedDoc) return;
        current.dispatch({ effects: setBlame.of(lines) });
      } catch {
        // Not a repo, unreadable file, git missing: annotations stay off.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, enabled, revision, getView]);
}
