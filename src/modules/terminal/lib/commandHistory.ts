import { LazyStore } from "@tauri-apps/plugin-store";

/**
 * History-based command suggestions. The pure `CommandRing` is the functional
 * core: a bounded, most-recent-first list with prefix matching. The module
 * singleton below adds persistence and is the imperative shell.
 *
 * Suggestions are derived purely from the user's own shell history captured via
 * OSC 133;C markers (see osc-handlers.ts). No network, no model, zero cost when
 * the feature is disabled because nothing registers in that case.
 */

const DEFAULT_MAX = 1000;

export class CommandRing {
  private items: string[] = [];

  constructor(
    private readonly max: number = DEFAULT_MAX,
    initial: readonly string[] = [],
  ) {
    // initial is oldest-first; replay through add() so dedup + cap apply and
    // the result ends up most-recent-first.
    for (const cmd of initial) this.add(cmd);
  }

  /** Record an executed command. Most-recent-first, deduped, bounded. */
  add(command: string): void {
    const cmd = command.trim();
    if (!cmd) return;
    const existing = this.items.indexOf(cmd);
    if (existing !== -1) this.items.splice(existing, 1);
    this.items.unshift(cmd);
    if (this.items.length > this.max) this.items.length = this.max;
  }

  /**
   * Most-recent command that starts with `prefix` and is strictly longer.
   * Returns null for an empty prefix or when nothing extends it, so the caller
   * never shows a no-op ghost equal to what is already typed.
   */
  suggest(prefix: string): string | null {
    if (!prefix) return null;
    for (const cmd of this.items) {
      if (cmd.length > prefix.length && cmd.startsWith(prefix)) return cmd;
    }
    return null;
  }

  /** Oldest-first snapshot, suitable for persistence. */
  toArray(): string[] {
    return this.items.slice().reverse();
  }

  get size(): number {
    return this.items.length;
  }
}

const STORE_PATH = "terax-command-history.json";
const STORE_KEY = "commands";

let ring = new CommandRing();
let hydrated = false;
let store: LazyStore | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function getStore(): LazyStore {
  if (!store) store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: false });
  return store;
}

/** Load persisted history once. Safe to call from multiple mounts. */
export async function initCommandHistory(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const saved = await getStore().get<string[]>(STORE_KEY);
    if (Array.isArray(saved)) ring = new CommandRing(DEFAULT_MAX, saved);
  } catch (e) {
    console.warn("[terax] command history load failed:", e);
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const s = getStore();
    s.set(STORE_KEY, ring.toArray())
      .then(() => s.save())
      .catch((e) => console.warn("[terax] command history save failed:", e));
  }, 1000);
}

export function recordCommand(command: string): void {
  const before = ring.size;
  ring.add(command);
  // Re-adding an existing command reorders without changing size; persist
  // either way so most-recent ordering survives a restart.
  if (ring.size !== before || command.trim()) scheduleSave();
}

export function suggestCommand(prefix: string): string | null {
  return ring.suggest(prefix);
}
