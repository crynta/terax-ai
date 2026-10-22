import { notifyDocumentSaved } from "@/modules/lsp";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { detectEol, type Eol, normalizeToLf, restoreEol } from "./eol";
import { decideSave } from "./saveConflict";

type ReadResult =
  | { kind: "text"; content: string; size: number; mtime: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type FileStat = { size: number; mtime: number; kind: string };

/// Mirrors FORCE_MAX_READ_BYTES in src-tauri fs/file.rs.
export const FORCE_READ_LIMIT = 50 * 1024 * 1024;

export type DocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

type Options = {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
};

function reportSaveError(path: string, e: unknown) {
  console.error("[save]", path, e);
  const name = path.split(/[\\/]/).pop() ?? path;
  toast.error(`Could not save ${name}`, {
    id: `save-error:${path}`,
    description: String(e),
  });
}

export function useDocument({ path, onDirtyChange }: Options) {
  const [doc, setDoc] = useState<DocumentState>({ status: "loading" });
  const [dirty, setDirty] = useState(false);

  const autoSave = usePreferencesStore((s) => s.editorAutoSave);
  const autoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);

  // Track the saved buffer so we can detect changes cheaply.
  const savedRef = useRef<string>("");
  const bufferRef = useRef<string>("");
  const eolRef = useRef<Eol>("\n");
  const dirtyRef = useRef(false);
  // Updates the ref synchronously: reload() can run before the next render.
  const markDirty = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirty(next);
  }, []);

  const autoSaveRef = useRef({ autoSave, autoSaveDelay });
  autoSaveRef.current = { autoSave, autoSaveDelay };

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoSaveTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const readFromDisk = useCallback(
    (force: boolean) =>
      invoke<ReadResult>("fs_read_file", {
        path,
        workspace: currentWorkspaceEnv(),
        force,
      }),
    [path],
  );

  const diskMtimeRef = useRef<number | null>(null);

  const writeToDisk = useCallback(async () => {
    const content = bufferRef.current;
    const mtime = await invoke<number>("fs_write_file", {
      path,
      content: restoreEol(content, eolRef.current),
      workspace: currentWorkspaceEnv(),
      source: "editor",
    });
    diskMtimeRef.current = mtime;
    savedRef.current = content;
    // Edits typed while the write was in flight must stay dirty.
    markDirty(bufferRef.current !== content);
    // A successful write supersedes any earlier failure or conflict notice.
    toast.dismiss(`save-error:${path}`);
    toast.dismiss(`save-conflict:${path}`);
    notifyDocumentSaved(path);
  }, [path, markDirty]);

  // False when the write was withheld because the file changed on disk
  // since load; overwriting is an explicit user action from the toast.
  const saveNow = useCallback(async (): Promise<boolean> => {
    const known = diskMtimeRef.current;
    if (known !== null) {
      const stat = await invoke<FileStat>("fs_stat", {
        path,
        workspace: currentWorkspaceEnv(),
      }).catch(() => null);
      if (stat && stat.mtime !== known) {
        const res = await readFromDisk(false).catch(() => null);
        const decision = decideSave({
          knownMtime: known,
          statMtime: stat.mtime,
          diskText: res?.kind === "text" ? normalizeToLf(res.content) : null,
          savedText: savedRef.current,
        });
        if (decision === "conflict") {
          const name = path.split(/[\\/]/).pop() ?? path;
          toast.warning("File changed on disk", {
            id: `save-conflict:${path}`,
            description: `${name} was modified by another program while you had unsaved changes. Overwrite to keep your version.`,
            duration: Number.POSITIVE_INFINITY,
            action: {
              label: "Overwrite",
              onClick: () =>
                void writeToDisk().catch((e) => reportSaveError(path, e)),
            },
          });
          return false;
        }
      }
    }
    await writeToDisk();
    return true;
  }, [path, writeToDisk, readFromDisk]);

  // Notify parent of dirty transitions.
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  const forceRef = useRef(false);

  // Adopts a read result as the new saved baseline. `skipIfUnchanged` avoids
  // the re-render when disk already matches the buffer (self-save / duplicate
  // watcher event); initial loads must always publish a state.
  const adoptRead = useCallback(
    (res: ReadResult, skipIfUnchanged = false) => {
      if (res.kind === "text") {
        eolRef.current = detectEol(res.content);
        diskMtimeRef.current = res.mtime;
        const content = normalizeToLf(res.content);
        if (skipIfUnchanged && content === savedRef.current) return;
        savedRef.current = content;
        bufferRef.current = content;
        markDirty(false);
        setDoc({ status: "ready", content, size: res.size });
      } else if (res.kind === "binary") {
        setDoc({ status: "binary", size: res.size });
      } else if (res.kind === "toolarge") {
        setDoc({ status: "toolarge", size: res.size, limit: res.limit });
      }
    },
    [markDirty],
  );

  // Load on path change.
  useEffect(() => {
    let cancelled = false;
    // "Open anyway" is a per-file decision; a new path starts unforced.
    forceRef.current = false;
    setDoc({ status: "loading" });
    markDirty(false);

    readFromDisk(forceRef.current)
      .then((res) => {
        if (!cancelled) adoptRead(res);
      })
      .catch((e) => {
        if (!cancelled) setDoc({ status: "error", message: String(e) });
      });

    return () => {
      cancelled = true;
    };
  }, [readFromDisk, adoptRead, markDirty]);

  const openAnyway = useCallback(() => {
    forceRef.current = true;
    setDoc({ status: "loading" });
    readFromDisk(true)
      .then(adoptRead)
      .catch((e) => setDoc({ status: "error", message: String(e) }));
  }, [readFromDisk, adoptRead]);

  // Skipped while dirty: never clobber unsaved edits. Re-checked when the
  // read resolves, since typing can start while it is in flight.
  const reload = useCallback((): boolean => {
    if (dirtyRef.current) return false;
    void readFromDisk(forceRef.current)
      .then((res) => {
        if (!dirtyRef.current) adoptRead(res, true);
      })
      // Transient failures (e.g. ENOENT mid atomic-rename) must not replace
      // a healthy buffer with an error screen.
      .catch((e) => console.warn("[editor] reload failed", path, e));
    return true;
  }, [readFromDisk, adoptRead, path]);

  const save = useCallback(async (): Promise<boolean> => {
    clearAutoSaveTimer();
    if (bufferRef.current === savedRef.current) return true;
    return saveNow();
  }, [clearAutoSaveTimer, saveNow]);

  // Adopt externally formatted disk content as the saved baseline before the
  // matching editor dispatch lands, so the buffer never flashes dirty. The
  // formatter's own write must also become the known mtime, or the next save
  // would report it as an external conflict.
  // Returns the LF-normalized text the caller should dispatch.
  const adoptDiskText = useCallback(
    (diskText: string, mtime: number): string => {
      eolRef.current = detectEol(diskText);
      diskMtimeRef.current = mtime;
      const content = normalizeToLf(diskText);
      savedRef.current = content;
      markDirty(bufferRef.current !== content);
      return content;
    },
    [markDirty],
  );

  const onChange = useCallback(
    (next: string) => {
      bufferRef.current = next;
      const isDirty = next !== savedRef.current;
      markDirty(isDirty);

      clearAutoSaveTimer();

      const { autoSave: active, autoSaveDelay: delay } = autoSaveRef.current;
      if (active && isDirty) {
        timeoutRef.current = setTimeout(() => {
          saveNow().catch((e) => reportSaveError(path, e));
        }, delay);
      }
    },
    [clearAutoSaveTimer, saveNow, markDirty, path],
  );

  useEffect(() => clearAutoSaveTimer, [path, clearAutoSaveTimer]);

  // The conflict toast never times out; its Overwrite action is bound to this
  // path and must not outlive the tab or a rename.
  useEffect(
    () => () => {
      toast.dismiss(`save-conflict:${path}`);
    },
    [path],
  );

  return { doc, dirty, onChange, save, reload, adoptDiskText, openAnyway };
}
