import { subscribeGitChanges } from "@/modules/git";

const REFRESH_DELAY_MS = 200;

export function watchSourceControl(
  repoRoot: string,
  refresh: () => Promise<void>,
  currentRefresh: () => Promise<void> | undefined,
): () => void {
  let disposed = false;
  let pending = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  const schedule = () => {
    if (disposed || running || timer !== undefined || !pending) return;
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, REFRESH_DELAY_MS);
  };

  const run = async () => {
    running = true;
    pending = false;
    try {
      // A request begun before the event may contain the old snapshot.
      await currentRefresh();
      if (!disposed) await refresh();
    } catch {
      // The hook exposes status errors; a later event or focus retries.
    } finally {
      running = false;
      schedule();
    }
  };

  const changed = () => {
    pending = true;
    schedule();
  };

  void subscribeGitChanges(repoRoot, changed)
    .then((release) => {
      if (disposed) {
        release();
        return;
      }
      unsubscribe = release;
      // Cover changes between the initial status and watcher registration.
      changed();
    })
    .catch(() => {});

  return () => {
    if (disposed) return;
    disposed = true;
    pending = false;
    if (timer !== undefined) clearTimeout(timer);
    unsubscribe?.();
  };
}
