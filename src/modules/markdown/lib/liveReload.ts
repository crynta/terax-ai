// Pure pieces of the preview's live reload: which file-system events concern
// the previewed file, and how a burst of them collapses into one reload.

function normalize(path: string): string {
  return path.replace(/\\/g, "/");
}

export function touchesPath(
  changed: readonly string[],
  target: string,
): boolean {
  const want = normalize(target);
  return changed.some((p) => normalize(p) === want);
}

export type Timers = {
  now: () => number;
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimers: Timers = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const RELOAD_DELAY_MS = 150;
const RELOAD_MAX_WAIT_MS = 1000;

/**
 * Trailing debounce with a ceiling: an agent that keeps writing still sees the
 * preview refresh every `maxWaitMs` instead of only once it stops.
 */
export function createCoalescer(
  fire: () => void,
  delayMs = RELOAD_DELAY_MS,
  maxWaitMs = RELOAD_MAX_WAIT_MS,
  timers: Timers = realTimers,
) {
  let handle: unknown = null;
  let firstAt = 0;

  const run = () => {
    handle = null;
    fire();
  };

  return {
    poke() {
      const now = timers.now();
      if (handle === null) firstAt = now;
      else timers.clear(handle);
      handle = timers.set(run, Math.max(0, Math.min(delayMs, firstAt + maxWaitMs - now)));
    },
    cancel() {
      if (handle !== null) timers.clear(handle);
      handle = null;
    },
    get pending() {
      return handle !== null;
    },
  };
}
