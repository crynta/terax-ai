import { type MutableRefObject, useCallback, useState } from "react";
import { toast } from "sonner";
import {
  isWorkflowFilePath,
  readWorkflowDocumentFile,
  writeWorkflowDocumentFile,
} from "@/modules/workflow/lib/filePersistence";
import type { WorkflowDocument } from "@/modules/workflow/lib/schema";
import type { Tab } from "@/modules/tabs";

type UseAppFileTabsInput = {
  disposeTab: (id: number) => void;
  openFileTab: (path: string, pin?: boolean) => number | null;
  openWorkflowDocumentTab: (
    document: WorkflowDocument,
    path?: string,
  ) => number;
  rememberWorkflowFile: (path: string, title: string) => void;
  tabs: Tab[];
  tabsRef: MutableRefObject<Tab[]>;
  updateTab: (id: number, patch: { path?: string; title?: string }) => void;
  updateWorkflowDocument: (
    id: number,
    document: WorkflowDocument,
    options?: { dirty?: boolean; path?: string },
  ) => void;
};

function editorTitleFromPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function useAppFileTabs({
  disposeTab,
  openFileTab,
  openWorkflowDocumentTab,
  rememberWorkflowFile,
  tabs,
  tabsRef,
  updateTab,
  updateWorkflowDocument,
}: UseAppFileTabsInput) {
  const [pendingDeleteTabs, setPendingDeleteTabs] = useState<number[] | null>(
    null,
  );

  const handleOpenFile = useCallback(
    (path: string, pin?: boolean) => {
      if (isWorkflowFilePath(path)) {
        void readWorkflowDocumentFile(path)
          .then((document) => {
            openWorkflowDocumentTab(document, path);
            rememberWorkflowFile(path, document.title);
          })
          .catch((error) => {
            toast.error(`Workflow open failed: ${String(error)}`);
            openFileTab(path, pin ?? false);
          });
        return;
      }

      openFileTab(path, pin ?? false);
    },
    [openFileTab, openWorkflowDocumentTab, rememberWorkflowFile],
  );

  const handleSaveWorkflowDocument = useCallback(
    async (tabId: number, document: WorkflowDocument) => {
      const tab = tabsRef.current.find((x) => x.id === tabId);
      if (!tab || tab.kind !== "workflow" || !tab.path) {
        throw new Error("Workflow tab is not backed by a file");
      }

      await writeWorkflowDocumentFile(tab.path, document);
      rememberWorkflowFile(tab.path, document.title);
      const latest = tabsRef.current.find((x) => x.id === tabId);
      if (latest?.kind === "workflow" && latest.document === document) {
        updateWorkflowDocument(tabId, document, { dirty: false });
      }
    },
    [rememberWorkflowFile, tabsRef, updateWorkflowDocument],
  );

  const handleSaveWorkflowDocumentAs = useCallback(
    async (tabId: number, document: WorkflowDocument, path: string) => {
      const tab = tabsRef.current.find((x) => x.id === tabId);
      if (!tab || tab.kind !== "workflow") {
        throw new Error("Workflow tab is not available");
      }

      await writeWorkflowDocumentFile(path, document);
      rememberWorkflowFile(path, document.title);
      const latest = tabsRef.current.find((x) => x.id === tabId);
      if (latest?.kind === "workflow" && latest.document === document) {
        updateWorkflowDocument(tabId, document, { dirty: false, path });
      }
    },
    [rememberWorkflowFile, tabsRef, updateWorkflowDocument],
  );

  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const tab of tabs) {
        if (tab.kind !== "editor" && tab.kind !== "workflow") continue;
        if (!tab.path) continue;
        if (tab.path === from) {
          updateTab(tab.id, {
            path: to,
            ...(tab.kind === "editor" && { title: editorTitleFromPath(to) }),
          });
        } else if (tab.path.startsWith(`${from}/`)) {
          const newPath = `${to}${tab.path.slice(from.length)}`;
          updateTab(tab.id, {
            path: newPath,
            ...(tab.kind === "editor" && {
              title: editorTitleFromPath(newPath),
            }),
          });
        }
      }
    },
    [tabs, updateTab],
  );

  const confirmDeleteClose = useCallback(() => {
    if (pendingDeleteTabs !== null) {
      for (const id of pendingDeleteTabs) disposeTab(id);
      setPendingDeleteTabs(null);
    }
  }, [pendingDeleteTabs, disposeTab]);

  const cancelDeleteClose = useCallback(() => {
    setPendingDeleteTabs(null);
  }, []);

  const handlePathDeleted = useCallback(
    (path: string) => {
      const dirty: number[] = [];
      for (const tab of tabs) {
        if (tab.kind !== "editor" && tab.kind !== "workflow") continue;
        if (!tab.path) continue;
        if (tab.path !== path && !tab.path.startsWith(`${path}/`)) continue;
        if (tab.dirty) dirty.push(tab.id);
        else disposeTab(tab.id);
      }
      if (dirty.length > 0) setPendingDeleteTabs(dirty);
    },
    [tabs, disposeTab],
  );

  return {
    cancelDeleteClose,
    confirmDeleteClose,
    handleOpenFile,
    handlePathDeleted,
    handlePathRenamed,
    handleSaveWorkflowDocument,
    handleSaveWorkflowDocumentAs,
    pendingDeleteTabs,
  };
}
