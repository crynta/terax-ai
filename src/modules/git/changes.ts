import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { git } from "./api";
import type { GitChangedEvent, GitChangeKind } from "./types";

export const GIT_CHANGED_EVENT = "terax:git-changed";

export type GitChangeHandler = (kinds: readonly GitChangeKind[]) => void;

export type GitChangeFilter = {
  /** Only call back when one of these kinds changed (default: all kinds). */
  kinds?: readonly GitChangeKind[];
};

type Entry = { handler: GitChangeHandler; kinds: ReadonlySet<GitChangeKind> | null };

/**
 * Fans backend events out to per-repository handlers. Pure and synchronous so
 * the routing and filtering are testable without Tauri.
 */
export function createChangeDispatcher() {
  const byRepo = new Map<string, Set<Entry>>();
  return {
    add(repo: string, handler: GitChangeHandler, filter?: GitChangeFilter) {
      const entry: Entry = {
        handler,
        kinds: filter?.kinds ? new Set(filter.kinds) : null,
      };
      let set = byRepo.get(repo);
      if (!set) {
        set = new Set();
        byRepo.set(repo, set);
      }
      set.add(entry);
      return () => {
        const current = byRepo.get(repo);
        if (!current) return;
        current.delete(entry);
        if (current.size === 0) byRepo.delete(repo);
      };
    },
    dispatch(event: GitChangedEvent) {
      const set = byRepo.get(event.repo);
      if (!set) return;
      for (const entry of [...set]) {
        const kinds = entry.kinds
          ? event.kinds.filter((kind) => entry.kinds?.has(kind))
          : event.kinds;
        if (kinds.length > 0) entry.handler(kinds);
      }
    },
    get size() {
      return byRepo.size;
    },
  };
}

const dispatcher = createChangeDispatcher();
let listener: Promise<UnlistenFn> | null = null;
let listeners = 0;

function acquireListener() {
  listeners += 1;
  if (!listener) {
    listener = listen<GitChangedEvent>(GIT_CHANGED_EVENT, (event) =>
      dispatcher.dispatch(event.payload),
    );
  }
}

function releaseListener() {
  listeners -= 1;
  if (listeners > 0 || !listener) return;
  const pending = listener;
  listener = null;
  void pending.then((unlisten) => unlisten()).catch(() => {});
}

/**
 * Calls `handler` when HEAD, the index, the refs or the working tree of
 * `repoRoot` change. Nothing runs in the backend until the first subscriber
 * and everything is released with the last. Resolves to the unsubscribe
 * function; if the backend cannot watch this repository (`watching: false`)
 * the handler is simply never called, so callers should keep a fallback
 * refresh (for example on window focus).
 */
export async function subscribeGitChanges(
  repoRoot: string,
  handler: GitChangeHandler,
  filter?: GitChangeFilter,
): Promise<() => void> {
  acquireListener();
  let info: Awaited<ReturnType<typeof git.watch>>;
  try {
    info = await git.watch(repoRoot);
  } catch (error) {
    releaseListener();
    throw error;
  }
  const remove = dispatcher.add(info.repo, handler, filter);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    remove();
    releaseListener();
    // By the key the backend returned: the worktree may be gone by now.
    void git.unwatch(info.repo).catch(() => {});
  };
}
