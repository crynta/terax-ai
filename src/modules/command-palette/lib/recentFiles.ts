// Files opened through the palette, newest first, kept per workspace and root.
// localStorage keeps it off the preferences store and its IPC broadcast path.

const KEY = "terax-palette-recent-files";
export const MAX_RECENT_FILES = 12;
const MAX_RECENT_ROOTS = 24;

export type RecentStore = Record<string, string[]>;

/** `list` with `path` moved to the front, capped at `max`. Does not mutate. */
export function touchRecent(
  list: readonly string[],
  path: string,
  max = MAX_RECENT_FILES,
): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, max);
}

/**
 * Returns the store with `path` recorded for `root`. The touched root moves to
 * the end of key order, and the oldest roots are dropped beyond the cap.
 */
export function recordInStore(
  store: RecentStore,
  root: string,
  path: string,
  maxRoots = MAX_RECENT_ROOTS,
): RecentStore {
  const { [root]: previous = [], ...rest } = store;
  const next: RecentStore = { ...rest, [root]: touchRecent(previous, path) };
  const roots = Object.keys(next);
  for (const old of roots.slice(0, Math.max(roots.length - maxRoots, 0))) {
    delete next[old];
  }
  return next;
}

function sanitize(raw: unknown): RecentStore {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: RecentStore = {};
  for (const [root, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    out[root] = list
      .filter((p): p is string => typeof p === "string")
      .slice(0, MAX_RECENT_FILES);
  }
  return out;
}

function read(): RecentStore {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function recentKey(root: string, workspace: string): string {
  return workspace === "local" ? root : `${workspace}\0${root}`;
}

export function recentFiles(root: string, workspace = "local"): string[] {
  return read()[recentKey(root, workspace)] ?? [];
}

export function recordRecentFile(
  root: string,
  path: string,
  workspace = "local",
): void {
  try {
    const key = recentKey(root, workspace);
    localStorage.setItem(KEY, JSON.stringify(recordInStore(read(), key, path)));
  } catch {
    /* ignore */
  }
}
