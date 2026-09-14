import { useEffect, useState } from "react";
import { native } from "@/modules/ai/lib/native";
import type { EditorView } from "@codemirror/view";
import { listenFsChanged } from "@/modules/explorer/lib/watch";
import { setBlame } from "./blame";

const FS_REFETCH_DEBOUNCE_MS = 500;

/** Watcher events and editor tabs can disagree on slash style on Windows. */
export function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/") === b.replace(/\\/g, "/");
}

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
  // The editor already watches this file, so a commit, checkout or external
  // edit refetches without a poll. One coalesced reload per burst.
  const [externalRevision, setExternalRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenFsChanged((paths) => {
      if (!paths.some((changed) => samePath(changed, path))) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = 0;
        setExternalRevision((n) => n + 1);
      }, FS_REFETCH_DEBOUNCE_MS);
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
      if (timer) window.clearTimeout(timer);
    };
  }, [path, enabled]);

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
  }, [path, enabled, revision, externalRevision, getView]);
}
