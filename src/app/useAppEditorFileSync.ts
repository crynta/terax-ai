import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type MutableRefObject, useEffect, useRef } from "react";
import type { EditorPaneHandle } from "@/modules/editor";
import {
  listenFsChanged,
  parentDir,
  watchAdd,
  watchRemove,
} from "@/modules/explorer/lib/watch";
import type { Tab } from "@/modules/tabs";

type UseAppEditorFileSyncInput = {
  editorRefs: MutableRefObject<Map<number, EditorPaneHandle>>;
  tabs: Tab[];
  tabsRef: MutableRefObject<Tab[]>;
};

export function useAppEditorFileSync({
  editorRefs,
  tabs,
  tabsRef,
}: UseAppEditorFileSyncInput) {
  // When an AI diff is approved (write_file applied to disk), reload any
  // open editor tabs for that path so the user sees the new content. We
  // track which approvalIds we've already handled to fire the reload only
  // once per applied diff.
  const appliedDiffsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.kind !== "ai-diff") continue;
      if (tab.status !== "approved") continue;
      if (appliedDiffsRef.current.has(tab.approvalId)) continue;
      appliedDiffsRef.current.add(tab.approvalId);
      for (const editorTab of tabs) {
        if (editorTab.kind !== "editor") continue;
        if (editorTab.path !== tab.path) continue;
        editorRefs.current.get(editorTab.id)?.reload();
      }
    }
  }, [editorRefs, tabs]);

  useEffect(() => {
    type FileWrittenPayload = { path: string; source?: string };
    const unlistenPromise =
      getCurrentWebviewWindow().listen<FileWrittenPayload>(
        "fs:file-written",
        (event) => {
          if (event.payload.source === "editor") return;
          const normalizedPath = event.payload.path.replace(/\\/g, "/");
          for (const tab of tabsRef.current) {
            if (tab.kind !== "editor") continue;
            if (tab.path.replace(/\\/g, "/") === normalizedPath) {
              editorRefs.current.get(tab.id)?.reload();
            }
          }
        },
      );
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [editorRefs, tabsRef]);

  const editorWatchRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const want = new Set<string>();
    for (const tab of tabs)
      if (tab.kind === "editor") want.add(parentDir(tab.path));
    const prev = editorWatchRef.current;
    const toAdd = [...want].filter((dir) => !prev.has(dir));
    const toRemove = [...prev].filter((dir) => !want.has(dir));
    watchAdd(toAdd);
    watchRemove(toRemove);
    editorWatchRef.current = want;
  }, [tabs]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void listenFsChanged((paths) => {
      const changed = new Set(paths.map((path) => path.replace(/\\/g, "/")));
      for (const tab of tabsRef.current) {
        if (tab.kind !== "editor") continue;
        if (changed.has(tab.path.replace(/\\/g, "/"))) {
          editorRefs.current.get(tab.id)?.reload();
        }
      }
    }).then((nextUnlisten) => {
      if (alive) unlisten = nextUnlisten;
      else nextUnlisten();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [editorRefs, tabsRef]);
}
