import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  parseNotebookDocument,
  serializeNotebookDocument,
  updateNotebookCellSource,
  type NotebookDocument,
} from "./ipynb";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type NotebookDocumentState =
  | { status: "loading" }
  | { status: "ready"; document: NotebookDocument; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

type Options = {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
};

export function useNotebookDocument({ path, onDirtyChange }: Options) {
  const [state, setState] = useState<NotebookDocumentState>({
    status: "loading",
  });
  const [dirty, setDirty] = useState(false);
  const autoSave = usePreferencesStore((s) => s.editorAutoSave);
  const autoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);
  const savedRef = useRef("");
  const documentRef = useRef<NotebookDocument | null>(null);
  const dirtyRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveRef = useRef({ autoSave, autoSaveDelay });
  autoSaveRef.current = { autoSave, autoSaveDelay };

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const clearAutoSaveTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const saveNow = useCallback(async () => {
    const document = documentRef.current;
    if (!document) return;
    const content = serializeNotebookDocument(document);
    await invoke("fs_write_file", {
      path,
      content,
      workspace: currentWorkspaceEnv(),
      source: "editor",
    });
    savedRef.current = content;
    setDirty(false);
  }, [path]);

  const save = useCallback(async () => {
    clearAutoSaveTimer();
    if (!dirtyRef.current) return;
    await saveNow();
  }, [clearAutoSaveTimer, saveNow]);

  const load = useCallback(
    async (skipDirty: boolean): Promise<boolean> => {
      if (skipDirty && dirtyRef.current) return false;
      setState({ status: "loading" });
      const res = await invoke<ReadResult>("fs_read_file", {
        path,
        workspace: currentWorkspaceEnv(),
      });
      if (res.kind === "text") {
        const parsed = parseNotebookDocument(res.content);
        if (!parsed.ok) {
          documentRef.current = null;
          setState({ status: "error", message: parsed.message });
          setDirty(false);
          return true;
        }
        savedRef.current = serializeNotebookDocument(parsed.document);
        documentRef.current = parsed.document;
        setState({
          status: "ready",
          document: parsed.document,
          size: res.size,
        });
        setDirty(false);
        return true;
      }
      documentRef.current = null;
      if (res.kind === "binary") {
        setState({ status: "binary", size: res.size });
      } else {
        setState({ status: "toolarge", size: res.size, limit: res.limit });
      }
      setDirty(false);
      return true;
    },
    [path],
  );

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setDirty(false);
    documentRef.current = null;

    invoke<ReadResult>("fs_read_file", { path, workspace: currentWorkspaceEnv() })
      .then((res) => {
        if (cancelled) return;
        if (res.kind === "text") {
          const parsed = parseNotebookDocument(res.content);
          if (!parsed.ok) {
            setState({ status: "error", message: parsed.message });
            return;
          }
          savedRef.current = serializeNotebookDocument(parsed.document);
          documentRef.current = parsed.document;
          setState({
            status: "ready",
            document: parsed.document,
            size: res.size,
          });
        } else if (res.kind === "binary") {
          setState({ status: "binary", size: res.size });
        } else {
          setState({ status: "toolarge", size: res.size, limit: res.limit });
        }
      })
      .catch((error) => {
        if (!cancelled) setState({ status: "error", message: String(error) });
      });

    return () => {
      cancelled = true;
      clearAutoSaveTimer();
    };
  }, [path, clearAutoSaveTimer]);

  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  const setCellSource = useCallback(
    (cellId: string, source: string) => {
      setState((current) => {
        if (current.status !== "ready") return current;
        const document = updateNotebookCellSource(
          current.document,
          cellId,
          source,
        );
        documentRef.current = document;
        const nextContent = serializeNotebookDocument(document);
        const nextDirty = nextContent !== savedRef.current;
        setDirty(nextDirty);
        clearAutoSaveTimer();
        const { autoSave: active, autoSaveDelay: delay } = autoSaveRef.current;
        if (active && nextDirty) {
          timeoutRef.current = setTimeout(() => {
            saveNow().catch((error) =>
              console.error("[notebook autosave]", error),
            );
          }, delay);
        }
        return { ...current, document };
      });
    },
    [clearAutoSaveTimer, saveNow],
  );

  const reload = useCallback((): boolean => {
    if (dirtyRef.current) return false;
    void load(true).catch((error) =>
      setState({ status: "error", message: String(error) }),
    );
    return true;
  }, [load]);

  return { state, dirty, setCellSource, save, reload };
}
