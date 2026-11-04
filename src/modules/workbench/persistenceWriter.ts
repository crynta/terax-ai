/** Quiet period after the last change before projects are written. */
export const WRITE_DEBOUNCE_MS = 3_000;
/** A stream of changes (a running agent's cwd, a long drag) still writes this often. */
export const WRITE_MAX_WAIT_MS = 10_000;

type Deps = {
  /** Every project id that has state to write. */
  projects: () => readonly string[];
  /** The project's serialized state. */
  serialize: (projectId: string) => unknown;
  save: (projectId: string, state: unknown) => Promise<void>;
  /** Makes the saves durable (the store otherwise writes on its own timer). */
  persist: () => Promise<void>;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};

/**
 * Writes changed projects only, debounced with a maximum wait, and can be
 * flushed (window hide, quit) with a promise that settles once on disk.
 */
export function createPersistenceWriter(deps: Deps) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer =
    deps.clearTimer ??
    ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const written = new Map<string, string>();
  let timer: unknown = null;
  let pendingSince: number | null = null;

  const flush = async (): Promise<void> => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    pendingSince = null;
    const saves: Promise<void>[] = [];
    for (const id of deps.projects()) {
      const state = deps.serialize(id);
      const json = JSON.stringify(state);
      if (written.get(id) === json) continue;
      written.set(id, json);
      saves.push(deps.save(id, state));
    }
    if (saves.length === 0) return;
    await Promise.all(saves);
    await deps.persist();
  };

  return {
    /** Something changed: write after the quiet period, or the max wait. */
    schedule() {
      const at = now();
      pendingSince ??= at;
      if (timer !== null) clearTimer(timer);
      const wait = Math.min(
        WRITE_DEBOUNCE_MS,
        WRITE_MAX_WAIT_MS - (at - pendingSince),
      );
      timer = setTimer(() => void flush(), Math.max(0, wait));
    },
    flush,
  };
}
