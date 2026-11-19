import type { migrateLegacySpace } from "./legacyMigration";
import {
  fingerprint,
  type HydratedProject,
  hydrateProject,
  projectSource,
} from "./persistence";
import type { Alloc } from "./workbench";

export type RestoredProject = {
  project: HydratedProject;
  /** Keep the stored blob aside before it is rewritten. */
  backup: boolean;
  /** Fingerprint of the legacy entry the restored state is reconciled with. */
  legacy?: string;
};

type LoadMigration = () => Promise<typeof migrateLegacySpace>;

/**
 * Restores one project from what is on disk, loading the legacy migration
 * only for a project that needs it.
 */
export async function restoreProject(
  workbenchRaw: unknown,
  legacyRaw: unknown,
  projectId: string,
  alloc: Alloc,
  loadMigration: LoadMigration,
): Promise<RestoredProject> {
  const source = projectSource(workbenchRaw, legacyRaw);
  const legacy = legacyRaw === undefined ? undefined : fingerprint(legacyRaw);
  if (source.from === "workbench") {
    const project = hydrateProject(workbenchRaw, projectId, alloc);
    return { project, backup: project.dropped > 0, legacy };
  }
  if (source.from === "legacy") {
    const migrate = await loadMigration();
    const project = migrate(legacyRaw, projectId, alloc);
    // A corrupt legacy entry must not replace a readable workbench layout.
    if (project.tasks.length === 0 && project.dropped > 0) {
      const saved = hydrateProject(workbenchRaw, projectId, alloc);
      if (saved.tasks.length > 0)
        return { project: saved, backup: saved.dropped > 0, legacy };
    }
    return { project, backup: source.backup, legacy };
  }
  return {
    project: { tabs: [], tasks: [], activeTaskId: null, dropped: 0 },
    backup: source.backup,
  };
}
