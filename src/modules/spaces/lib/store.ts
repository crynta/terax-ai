import { LazyStore } from "@tauri-apps/plugin-store";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { SerializedTab } from "./serialize";

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

export type RawSpaceMeta = Omit<SpaceMeta, "env"> & { env?: unknown };

function isWorkspaceEnv(env: unknown): env is WorkspaceEnv {
  if (!env || typeof env !== "object") return false;
  const candidate = env as { kind?: unknown; distro?: unknown };
  return (
    candidate.kind === "local" ||
    (candidate.kind === "wsl" &&
      typeof candidate.distro === "string" &&
      candidate.distro.trim().length > 0)
  );
}

export function normalizeSpaceEnvs(
  spaces: readonly RawSpaceMeta[],
  fallbackEnv: WorkspaceEnv,
): SpaceMeta[] {
  return spaces.map((space) =>
    isWorkspaceEnv(space.env)
      ? (space as SpaceMeta)
      : { ...space, env: fallbackEnv },
  );
}

export type SpaceState = {
  tabs: SerializedTab[];
  activeTabIndex: number;
};

const STORE_PATH = "terax-spaces.json";
const KEY_SPACES = "spaces";
const KEY_ACTIVE = "activeId";
const KEY_SCHEMA = "schemaVersion";
const STATE_PREFIX = "state:";
const stateKey = (id: string) => `${STATE_PREFIX}${id}`;

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 500 });

export type LoadedSpaces = {
  schemaVersion: number;
  spaces: SpaceMeta[];
  activeId: string | null;
  states: Map<string, SpaceState>;
};

export async function loadAll(): Promise<LoadedSpaces> {
  const entries = await store.entries();
  let schemaVersion = 1;
  let spaces: SpaceMeta[] = [];
  let activeId: string | null = null;
  const states = new Map<string, SpaceState>();
  for (const [k, v] of entries) {
    if (k === KEY_SCHEMA) schemaVersion = (v as number) ?? 1;
    else if (k === KEY_SPACES) spaces = (v as SpaceMeta[]) ?? [];
    else if (k === KEY_ACTIVE) activeId = (v as string | null) ?? null;
    else if (k.startsWith(STATE_PREFIX)) {
      states.set(k.slice(STATE_PREFIX.length), v as SpaceState);
    }
  }
  return { schemaVersion, spaces, activeId, states };
}

export async function saveSpacesList(spaces: SpaceMeta[]): Promise<void> {
  await store.set(KEY_SPACES, spaces);
}

export async function saveActiveId(id: string | null): Promise<void> {
  await store.set(KEY_ACTIVE, id);
}

export async function saveSchemaVersion(version: number): Promise<void> {
  await store.set(KEY_SCHEMA, version);
}

export async function saveState(id: string, state: SpaceState): Promise<void> {
  await store.set(stateKey(id), state);
}

export async function deleteSpaceData(id: string): Promise<void> {
  await store.delete(stateKey(id));
}

export function newSpaceId(): string {
  return `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
