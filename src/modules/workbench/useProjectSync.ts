import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { useEffect } from "react";
import { selectProject } from "./actions";
import { onCommit } from "./store";

/**
 * Keeps the project list's active entry and the workbench's active project in
 * step, whichever side changed (project switcher, or activating a tab that
 * lives in another project).
 */
export function useProjectSync() {
  useEffect(() => {
    const offSpaces = useSpaces.subscribe((next, prev) => {
      if (next.activeId && next.activeId !== prev.activeId)
        selectProject(next.activeId);
    });
    const offCommit = onCommit((prev, next) => {
      if (next.activeProjectId && next.activeProjectId !== prev.activeProjectId)
        useSpaces.getState().setActive(next.activeProjectId);
    });
    return () => {
      offSpaces();
      offCommit();
    };
  }, []);
}
