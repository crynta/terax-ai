import type { WorkspaceEnv } from "@/modules/workspace";
import type { SerializedNode } from "@/modules/spaces/lib/serialize";
import type {
  LoadedSpaces,
  SpaceMeta,
  SpaceState,
} from "@/modules/spaces/lib/store";

export const SPACE_SCHEMA_VERSION = 2;

export type SpaceRootIssue = {
  candidate: string | null;
  message: string;
};

export type SpaceRootIssues = Record<string, SpaceRootIssue>;

export type RootMigrationResult = {
  spaces: SpaceMeta[];
  issues: SpaceRootIssues;
};

type ValidateRoot = (path: string, env: WorkspaceEnv) => Promise<string>;

function rootIssue(candidate: string | null, error?: unknown): SpaceRootIssue {
  return {
    candidate,
    message:
      error === undefined
        ? "No directory is available"
        : error instanceof Error
          ? error.message
          : String(error),
  };
}

export function hasUsableSpaceRoot(
  space: SpaceMeta | undefined,
  issues: SpaceRootIssues,
): space is SpaceMeta & { root: string } {
  if (!space?.root?.trim()) return false;
  return !issues[space.id];
}

export async function validatePersistedSpaceRoots(
  spaces: SpaceMeta[],
  validateRoot: ValidateRoot,
): Promise<SpaceRootIssues> {
  const issues: SpaceRootIssues = {};
  for (const space of spaces) {
    const candidate = space.root?.trim() || null;
    if (!candidate) {
      issues[space.id] = rootIssue(null);
      continue;
    }
    try {
      await validateRoot(candidate, space.env);
    } catch (error) {
      issues[space.id] = rootIssue(candidate, error);
    }
  }
  return issues;
}

function activeLeafCwd(node: SerializedNode): string | null {
  if (node.kind === "leaf") return node.active && node.cwd ? node.cwd : null;
  for (const child of node.children) {
    const cwd = activeLeafCwd(child);
    if (cwd) return cwd;
  }
  return null;
}

function firstLeafCwd(node: SerializedNode): string | null {
  if (node.kind === "leaf") return node.cwd || null;
  for (const child of node.children) {
    const cwd = firstLeafCwd(child);
    if (cwd) return cwd;
  }
  return null;
}

export function legacyRootCandidate(
  space: SpaceMeta,
  state: SpaceState | undefined,
  envHome: string | null,
): string | null {
  if (space.root?.trim()) return space.root;
  const active = state?.tabs[state.activeTabIndex];
  const activeCwd =
    active?.kind === "terminal" ? activeLeafCwd(active.tree) : null;
  if (activeCwd) return activeCwd;
  for (const tab of state?.tabs ?? []) {
    if (tab.kind !== "terminal") continue;
    const cwd = firstLeafCwd(tab.tree);
    if (cwd) return cwd;
  }
  return envHome;
}

export async function migrateSpaceRoots(
  loaded: LoadedSpaces,
  resolveHome: (env: WorkspaceEnv) => Promise<string | null>,
  validateRoot: ValidateRoot,
): Promise<RootMigrationResult> {
  const issues: SpaceRootIssues = {};
  const spaces: SpaceMeta[] = [];
  for (const space of loaded.spaces) {
    const state = loaded.states.get(space.id);
    const candidate =
      legacyRootCandidate(space, state, null) ?? (await resolveHome(space.env));
    if (!candidate) {
      issues[space.id] = rootIssue(null);
      spaces.push(space);
      continue;
    }
    try {
      const root = await validateRoot(candidate, space.env);
      spaces.push(root === space.root ? space : { ...space, root });
    } catch (error) {
      issues[space.id] = rootIssue(candidate, error);
      spaces.push(
        candidate === space.root ? space : { ...space, root: candidate },
      );
    }
  }
  return { spaces, issues };
}
