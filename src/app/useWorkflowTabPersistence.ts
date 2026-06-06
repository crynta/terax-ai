import { useCallback, useEffect, useRef, useState } from "react";
import type { Tab } from "@/modules/tabs";
import {
  readWorkflowTabsRestoreState,
  writeWorkflowTabsRestoreState,
} from "@/modules/tabs";
import {
  readWorkflowRecentFiles,
  rememberRecentWorkflowFile,
  type WorkflowRecentFile,
  writeWorkflowRecentFiles,
} from "@/modules/workflow/lib/filePersistence";
import type { WorkflowDocument } from "@/modules/workflow/lib/schema";

type UseWorkflowTabPersistenceInput = {
  activeId: number;
  openWorkflowDocumentTab: (
    document: WorkflowDocument,
    path?: string,
  ) => number;
  setActiveId: (id: number) => void;
  tabs: Tab[];
  updateWorkflowDocument: (
    id: number,
    document: WorkflowDocument,
    options?: { dirty?: boolean; path?: string },
  ) => void;
};

export function useWorkflowTabPersistence({
  activeId,
  openWorkflowDocumentTab,
  setActiveId,
  tabs,
  updateWorkflowDocument,
}: UseWorkflowTabPersistenceInput) {
  const restoreStartedRef = useRef(false);
  const [restoreReady, setRestoreReady] = useState(false);
  const [recentWorkflowFiles, setRecentWorkflowFiles] = useState<
    WorkflowRecentFile[]
  >(() => readWorkflowRecentFiles());

  const rememberWorkflowFile = useCallback((path: string, title: string) => {
    setRecentWorkflowFiles((current) => {
      const next = rememberRecentWorkflowFile(current, {
        path,
        title,
        updatedAt: Date.now(),
      });
      writeWorkflowRecentFiles(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    const restored = readWorkflowTabsRestoreState();
    const openedIds = restored.tabs.map((entry) => {
      const openedId = openWorkflowDocumentTab(entry.document, entry.path);
      updateWorkflowDocument(openedId, entry.document, {
        dirty: entry.dirty,
        path: entry.path,
      });
      return openedId;
    });
    if (restored.activeIndex !== null) {
      const activeWorkflowId = openedIds[restored.activeIndex];
      if (activeWorkflowId !== undefined) setActiveId(activeWorkflowId);
    }
    setRestoreReady(true);
  }, [openWorkflowDocumentTab, setActiveId, updateWorkflowDocument]);

  useEffect(() => {
    if (!restoreReady) return;
    writeWorkflowTabsRestoreState(tabs, activeId);
  }, [activeId, restoreReady, tabs]);

  return { recentWorkflowFiles, rememberWorkflowFile };
}
