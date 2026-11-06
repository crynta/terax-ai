import {
  flushSpacesStore,
  saveWorkbenchState,
} from "@/modules/spaces/lib/store";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { useEffect } from "react";
import { serializeProject } from "./model/persistence";
import { createPersistenceWriter } from "./persistenceWriter";
import { snapshot, useWorkbench } from "./store";

/** Legacy entry each project was last reconciled with (set at boot). */
const legacyFingerprints = new Map<string, string>();
const failedRestores = new Set<string>();

export function preventProjectOverwrite(projectId: string) {
  failedRestores.add(projectId);
}

export function rememberLegacyFingerprint(projectId: string, value?: string) {
  if (value) legacyFingerprints.set(projectId, value);
  else legacyFingerprints.delete(projectId);
}

const writer = createPersistenceWriter({
  projects: () => {
    const state = snapshot();
    return useSpaces
      .getState()
      .spaces.map((s) => s.id)
      .filter(
        (id) =>
          !failedRestores.has(id) &&
          state.tasks.some((t) => t.projectId === id),
      );
  },
  serialize: (id) =>
    serializeProject(snapshot(), id, legacyFingerprints.get(id)),
  save: saveWorkbenchState,
  persist: flushSpacesStore,
});

let enabled = false;

/** Writes pending project state to disk now; settles once it is durable. */
export function flushWorkbench(): Promise<void> {
  return enabled ? writer.flush() : Promise.resolve();
}

/**
 * Writes each project's tasks a few seconds after they change (at most ten
 * seconds into a stream of changes), and at once when the window hides or
 * closes. Unchanged projects are never rewritten.
 */
export function useWorkbenchPersistence(active: boolean) {
  useEffect(() => {
    if (!active) return;
    enabled = true;
    const unsubscribe = useWorkbench.subscribe((next, prev) => {
      if (
        next.tasks === prev.tasks &&
        next.tabs === prev.tabs &&
        next.activeTaskByProject === prev.activeTaskByProject
      )
        return;
      writer.schedule();
    });
    const flush = () =>
      void writer
        .flush()
        .catch((e) => console.error("[terax] workbench save failed:", e));
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", flush);
    window.addEventListener("beforeunload", flush);
    // Persists migrated projects in the new format right away.
    flush();
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
      enabled = false;
    };
  }, [active]);
}
