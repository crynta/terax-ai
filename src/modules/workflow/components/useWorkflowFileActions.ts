import { type ChangeEvent, type RefObject, useCallback } from "react";
import {
  chooseWorkflowOpenPath,
  chooseWorkflowSavePath,
  suggestWorkflowSaveAsPath,
} from "../lib/filePersistence";
import {
  parseWorkflowDocumentJson,
  serializeWorkflowDocumentForPersistence,
  type WorkflowDocument,
} from "../lib/schema";
import { pathBasename, workflowJsonFilename } from "./WorkflowCanvasParts";

type UseWorkflowFileActionsInput = {
  document: WorkflowDocument;
  filePath?: string;
  importInputRef: RefObject<HTMLInputElement | null>;
  onDocumentChange?: (document: WorkflowDocument) => void;
  onOpenWorkflowPath?: (path: string) => void;
  onSaveAsDocument?: (
    document: WorkflowDocument,
    path: string,
  ) => Promise<void>;
  onSaveDocument?: (document: WorkflowDocument) => Promise<void>;
  setSavingFile: (saving: boolean) => void;
  setWorkflowIoMessage: (message: string) => void;
};

export function useWorkflowFileActions({
  document,
  filePath,
  importInputRef,
  onDocumentChange,
  onOpenWorkflowPath,
  onSaveAsDocument,
  onSaveDocument,
  setSavingFile,
  setWorkflowIoMessage,
}: UseWorkflowFileActionsInput) {
  const handleCopyJson = useCallback(async () => {
    if (!navigator.clipboard) {
      setWorkflowIoMessage("Clipboard unavailable");
      return;
    }

    await navigator.clipboard.writeText(
      serializeWorkflowDocumentForPersistence(document),
    );
    setWorkflowIoMessage("Workflow JSON copied");
  }, [document, setWorkflowIoMessage]);

  const handleDownloadJson = useCallback(() => {
    const blob = new Blob([serializeWorkflowDocumentForPersistence(document)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = workflowJsonFilename(document);
    anchor.click();
    URL.revokeObjectURL(url);
    setWorkflowIoMessage("Workflow JSON downloaded");
  }, [document, setWorkflowIoMessage]);

  const handleSaveFile = useCallback(async () => {
    if (!filePath || !onSaveDocument) {
      setWorkflowIoMessage("Open a workflow file before saving");
      return;
    }

    setSavingFile(true);
    try {
      await onSaveDocument(document);
      setWorkflowIoMessage(`Saved ${pathBasename(filePath)}`);
    } catch (error) {
      setWorkflowIoMessage(`Save failed: ${String(error)}`);
    } finally {
      setSavingFile(false);
    }
  }, [document, filePath, onSaveDocument, setSavingFile, setWorkflowIoMessage]);

  const handleSaveAsFile = useCallback(async () => {
    if (!onSaveAsDocument) {
      setWorkflowIoMessage("Save As is unavailable");
      return;
    }

    let path: string | null = null;
    try {
      path = await chooseWorkflowSavePath(document, { currentPath: filePath });
    } catch {
      const suggestedPath = suggestWorkflowSaveAsPath(document, {
        currentPath: filePath,
      });
      path = window.prompt("Save workflow as", suggestedPath)?.trim() || null;
    }
    if (!path) return;

    setSavingFile(true);
    try {
      await onSaveAsDocument(document, path);
      setWorkflowIoMessage(`Saved ${pathBasename(path)}`);
    } catch (error) {
      setWorkflowIoMessage(`Save As failed: ${String(error)}`);
    } finally {
      setSavingFile(false);
    }
  }, [
    document,
    filePath,
    onSaveAsDocument,
    setSavingFile,
    setWorkflowIoMessage,
  ]);

  const handleOpenWorkflowFile = useCallback(async () => {
    if (!onOpenWorkflowPath) {
      importInputRef.current?.click();
      return;
    }

    try {
      const path = await chooseWorkflowOpenPath();
      if (path) onOpenWorkflowPath(path);
    } catch (error) {
      setWorkflowIoMessage(`Open dialog failed: ${String(error)}`);
      importInputRef.current?.click();
    }
  }, [importInputRef, onOpenWorkflowPath, setWorkflowIoMessage]);

  const handleImportJsonChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;

      const parsed = parseWorkflowDocumentJson(await file.text());
      if (!parsed.ok) {
        setWorkflowIoMessage(`Import failed: ${parsed.errors[0]}`);
        return;
      }

      onDocumentChange?.(parsed.document);
      setWorkflowIoMessage(`Imported ${parsed.document.title}`);
    },
    [onDocumentChange, setWorkflowIoMessage],
  );

  return {
    handleCopyJson,
    handleDownloadJson,
    handleImportJsonChange,
    handleOpenWorkflowFile,
    handleSaveAsFile,
    handleSaveFile,
  };
}
