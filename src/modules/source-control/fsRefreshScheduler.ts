// Filesystem bursts (a build, a checkout, a formatter) arrive as batches from
// the Rust watcher; collapse them into one status read and never run them
// closer together than this.
export const FS_REFRESH_DEBOUNCE_MS = 500;
export const FS_REFRESH_MIN_INTERVAL_MS = 1500;

type Deps = {
  refresh: () => Promise<void>;
  /** True while a status read from any trigger is already in flight. */
  isRefreshing: () => boolean;
  /** When the last status read completed, in ms since the epoch. */
  lastRefreshAt: () => number;
  isHidden: () => boolean;
  now?: () => number;
};

/**
 * Turns watcher batches into bounded status reads. A change is only
 * forgotten once a read that started after it has completed, so a hidden
 * window, the minimum interval, or a read already in flight can delay the
 * refresh but never drop it.
 */
export function createFsRefreshScheduler(deps: Deps) {
  const now = deps.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let running = false;
  let disposed = false;

  const schedule = (delay: number) => {
    if (disposed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(run, delay);
  };

  const run = async () => {
    timer = undefined;
    // Hidden: stay pending and let resume() pick it up on return.
    if (!pending || running || deps.isHidden()) return;
    const elapsed = now() - deps.lastRefreshAt();
    if (elapsed < FS_REFRESH_MIN_INTERVAL_MS) {
      schedule(FS_REFRESH_MIN_INTERVAL_MS - elapsed);
      return;
    }
    // Joining a read that started before this change cannot cover it, so the
    // change stays pending and gets one fresh read once that one settles.
    if (!deps.isRefreshing()) pending = false;
    running = true;
    try {
      await deps.refresh();
    } catch {
      // The panel surfaces status errors itself; a later change retries.
    } finally {
      running = false;
      if (pending) schedule(FS_REFRESH_DEBOUNCE_MS);
    }
  };

  return {
    notify() {
      pending = true;
      schedule(FS_REFRESH_DEBOUNCE_MS);
    },
    /** The window is visible or focused again. */
    resume() {
      if (pending && !running) schedule(0);
    },
    dispose() {
      disposed = true;
      pending = false;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
