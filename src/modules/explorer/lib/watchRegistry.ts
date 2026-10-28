// Tracks which directories the explorer *wants* watched and which of them are
// actually registered with the native watcher.
//
// Native watchers are the cost: each one is an OS handle in the Rust process and
// every change under it wakes the webview with an `fs:changed` event. While the
// explorer is not on screen (collapsed sidebar) nobody can see the result, so
// the registry can be disarmed: the native side is released but the desired set
// is remembered, edits made meanwhile only touch the set, and arming registers
// exactly the current set again.

export type WatchIo = {
  add: (paths: string[]) => void;
  remove: (paths: string[]) => void;
};

export type WatchRegistry = {
  /** Adds a directory to the desired set; native only while armed. */
  add: (path: string) => void;
  /** Adds several at once, in a single native call while armed. */
  addMany: (paths: readonly string[]) => void;
  remove: (path: string) => void;
  removeMany: (paths: readonly string[]) => void;
  has: (path: string) => boolean;
  /** Snapshot of the desired set. */
  paths: () => string[];
  /** Registers the whole desired set natively. Idempotent. */
  arm: () => void;
  /** Releases everything natively but keeps the desired set. Idempotent. */
  disarm: () => void;
  /** Releases everything and forgets the desired set. */
  clear: () => void;
  readonly armed: boolean;
};

export function createWatchRegistry(io: WatchIo, armed = true): WatchRegistry {
  const desired = new Set<string>();
  let isArmed = armed;

  return {
    add(path) {
      if (desired.has(path)) return;
      desired.add(path);
      if (isArmed) io.add([path]);
    },
    addMany(paths) {
      const fresh = paths.filter((p) => !desired.has(p));
      for (const p of fresh) desired.add(p);
      if (isArmed && fresh.length > 0) io.add(fresh);
    },
    remove(path) {
      if (!desired.delete(path)) return;
      if (isArmed) io.remove([path]);
    },
    removeMany(paths) {
      const gone = paths.filter((p) => desired.delete(p));
      if (isArmed && gone.length > 0) io.remove(gone);
    },
    has: (path) => desired.has(path),
    paths: () => [...desired],
    arm() {
      if (isArmed) return;
      isArmed = true;
      if (desired.size > 0) io.add([...desired]);
    },
    disarm() {
      if (!isArmed) return;
      isArmed = false;
      if (desired.size > 0) io.remove([...desired]);
    },
    clear() {
      if (isArmed && desired.size > 0) io.remove([...desired]);
      desired.clear();
    },
    get armed() {
      return isArmed;
    },
  };
}

export type VisibilityEdgePlan = {
  /** Native watchers should be registered. */
  arm: boolean;
  /** Reload every loaded directory once. */
  resync: boolean;
  /** Value to store for "loaded data may be out of date". */
  stale: boolean;
};

/**
 * What to do when the explorer's visibility effect runs.
 *
 * Hidden: release the native watchers and mark the data stale, since changes
 * are no longer observed. Shown: re-register, and reload once if anything could
 * have changed meanwhile (including the root changing while hidden, which
 * leaves nothing loaded). A shown explorer with fresh data does nothing.
 */
export function planVisibilityEdge(input: {
  active: boolean;
  stale: boolean;
  hasRoot: boolean;
}): VisibilityEdgePlan {
  if (!input.active) return { arm: false, resync: false, stale: true };
  return {
    arm: true,
    resync: input.stale && input.hasRoot,
    stale: false,
  };
}
