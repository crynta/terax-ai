import { fingerprint } from "@/modules/workbench/model/persistence";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { WorkspaceEnv } from "@/modules/workspace";

export type SpaceMeta = {
  id: string;
  name: string;
  root: string | null;
  env: WorkspaceEnv;
  /** Opt-in accent, index into SPACE_COLORS. Undefined = theme primary. */
  color?: number;
  createdAt: number;
  updatedAt: number;
};

const STORE_PATH = "terax-spaces.json";
const KEY_SPACES = "spaces";
const KEY_ACTIVE = "activeId";
/**
 * Pre-workbench per-space tabs, still written by older builds. This build
 * only reads them (to migrate) and removes them with a deleted project.
 */
const LEGACY_PREFIX = "state:";
const WORKBENCH_PREFIX = "workbench:";
/** A project state this build could not read in full, kept before rewriting. */
const BACKUP_PREFIX = "workbench-backup:";
const legacyKey = (id: string) => `${LEGACY_PREFIX}${id}`;
const workbenchKey = (id: string) => `${WORKBENCH_PREFIX}${id}`;
const backupKey = (id: string) => `${BACKUP_PREFIX}${id}`;

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 500 });

export type LoadedSpaces = {
  spaces: SpaceMeta[];
  activeId: string | null;
  /** Per-project workbench state (versioned, see workbench/model/persistence). */
  workbench: Map<string, unknown>;
  legacy: Map<string, unknown>;
};

export async function loadAll(): Promise<LoadedSpaces> {
  const entries = await store.entries();
  let spaces: SpaceMeta[] = [];
  let activeId: string | null = null;
  const workbench = new Map<string, unknown>();
  const legacy = new Map<string, unknown>();
  for (const [k, v] of entries) {
    if (k === KEY_SPACES) spaces = (v as SpaceMeta[]) ?? [];
    else if (k === KEY_ACTIVE) activeId = (v as string | null) ?? null;
    else if (k.startsWith(BACKUP_PREFIX)) continue;
    else if (k.startsWith(WORKBENCH_PREFIX))
      workbench.set(k.slice(WORKBENCH_PREFIX.length), v);
    else if (k.startsWith(LEGACY_PREFIX))
      legacy.set(k.slice(LEGACY_PREFIX.length), v);
  }
  return { spaces, activeId, workbench, legacy };
}

export async function saveSpacesList(spaces: SpaceMeta[]): Promise<void> {
  await store.set(KEY_SPACES, spaces);
}

export async function saveActiveId(id: string | null): Promise<void> {
  await store.set(KEY_ACTIVE, id);
}

export async function saveWorkbenchState(
  id: string,
  state: unknown,
): Promise<void> {
  await store.set(workbenchKey(id), state);
}

/** Keeps an unreadable or partly readable project state aside. */
export async function saveWorkbenchBackup(
  id: string,
  state: unknown,
): Promise<void> {
  const key = backupKey(id);
  const existing = await store.get(key);
  if (existing === undefined || existing === null) await store.set(key, state);
  else if (fingerprint(existing) !== fingerprint(state))
    await store.set(`${key}:${fingerprint(state)}`, state);
}

/** Writes pending changes to disk now (the store otherwise saves on a timer). */
export async function flushSpacesStore(): Promise<void> {
  await store.save();
}

/**
 * Removes everything stored for a project the user deleted: its state, any
 * backup and its legacy entry (the shared project list no longer names it,
 * so no build would read it again).
 */
export async function deleteSpaceData(id: string): Promise<void> {
  await store.delete(workbenchKey(id));
  const backup = backupKey(id);
  for (const key of await store.keys())
    if (key === backup || key.startsWith(`${backup}:`)) await store.delete(key);
  await store.delete(legacyKey(id));
}

export function newSpaceId(): string {
  return `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
