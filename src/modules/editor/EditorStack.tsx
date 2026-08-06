import { cn } from "@/lib/utils";
import type { EditorTab, Tab } from "@/modules/tabs";
import { leafIds } from "@/modules/terminal";
import { useEffect, useRef } from "react";
import { EditorPaneTreeView, type EditorLeafBundle } from "./EditorPaneTreeView";
import type { EditorPaneHandle } from "./EditorPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  onDirtyChange: (leafId: number, dirty: boolean) => void;
  registerHandle: (leafId: number, handle: EditorPaneHandle | null) => void;
  onCloseTab: (id: number) => void;
  onClosePaneLeaf: (leafId: number) => void;
  onFocusLeaf: (tabId: number, leafId: number) => void;
  onSetMarkdownView: (id: number, mode: "rendered" | "raw") => void;
};

export function EditorStack({
  tabs,
  activeId,
  onDirtyChange,
  registerHandle,
  onCloseTab,
  onClosePaneLeaf,
  onFocusLeaf,
  onSetMarkdownView,
}: Props) {
  const editors = tabs.filter(
    (t): t is EditorTab => t.kind === "editor" && !t.cold,
  );

  // Stable per-leaf callbacks. Same pattern as the original per-tab callbacks —
  // memoizing by id keeps identity stable so EditorPane (memo-wrapped) skips
  // re-renders on unrelated state changes.
  const tabsRef = useRef(tabs);
  const registerRef = useRef(registerHandle);
  const dirtyRef = useRef(onDirtyChange);
  const closeTabRef = useRef(onCloseTab);
  const closePaneLeafRef = useRef(onClosePaneLeaf);
  const markdownViewRef = useRef(onSetMarkdownView);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    dirtyRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    closeTabRef.current = onCloseTab;
  }, [onCloseTab]);
  useEffect(() => {
    closePaneLeafRef.current = onClosePaneLeaf;
  }, [onClosePaneLeaf]);
  useEffect(() => {
    markdownViewRef.current = onSetMarkdownView;
  }, [onSetMarkdownView]);

  const refCallbacks = useRef(
    new Map<number, (h: EditorPaneHandle | null) => void>(),
  );
  const dirtyCallbacks = useRef(new Map<number, (dirty: boolean) => void>());
  const closeCallbacks = useRef(new Map<number, () => void>());
  const markdownViewCallbacks = useRef(
    new Map<number, (mode: "rendered" | "raw") => void>(),
  );

  const getRefCallback = (leafId: number) => {
    let cb = refCallbacks.current.get(leafId);
    if (!cb) {
      cb = (h: EditorPaneHandle | null) => registerRef.current(leafId, h);
      refCallbacks.current.set(leafId, cb);
    }
    return cb;
  };
  const getDirtyCallback = (leafId: number) => {
    let cb = dirtyCallbacks.current.get(leafId);
    if (!cb) {
      cb = (dirty: boolean) => dirtyRef.current(leafId, dirty);
      dirtyCallbacks.current.set(leafId, cb);
    }
    return cb;
  };
  const getCloseCallback = (tabId: number, leafId: number) => {
    let cb = closeCallbacks.current.get(leafId);
    if (!cb) {
      cb = () => {
        const tab = tabsRef.current.find((x) => x.id === tabId);
        if (tab?.kind === "editor" && leafIds(tab.paneTree).length > 1) {
          closePaneLeafRef.current(leafId);
        } else {
          closeTabRef.current(tabId);
        }
      };
      closeCallbacks.current.set(leafId, cb);
    }
    return cb;
  };
  const getMarkdownViewCallback = (tabId: number) => {
    let cb = markdownViewCallbacks.current.get(tabId);
    if (!cb) {
      cb = (mode: "rendered" | "raw") => markdownViewRef.current(tabId, mode);
      markdownViewCallbacks.current.set(tabId, cb);
    }
    return cb;
  };

  // Drop callback entries for closed leaves/tabs to avoid unbounded growth.
  useEffect(() => {
    const liveLeaves = new Set<number>();
    const liveTabs = new Set<number>();
    for (const t of editors) {
      liveTabs.add(t.id);
      for (const id of leafIds(t.paneTree)) liveLeaves.add(id);
    }
    for (const id of refCallbacks.current.keys()) {
      if (!liveLeaves.has(id)) refCallbacks.current.delete(id);
    }
    for (const id of dirtyCallbacks.current.keys()) {
      if (!liveLeaves.has(id)) dirtyCallbacks.current.delete(id);
    }
    for (const id of closeCallbacks.current.keys()) {
      if (!liveLeaves.has(id)) closeCallbacks.current.delete(id);
    }
    for (const id of markdownViewCallbacks.current.keys()) {
      if (!liveTabs.has(id)) markdownViewCallbacks.current.delete(id);
    }
  }, [editors]);

  if (editors.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {editors.map((t) => {
        const visible = t.id === activeId;
        const getBundle = (leafId: number): EditorLeafBundle => ({
          setRef: getRefCallback(leafId),
          onDirtyChange: getDirtyCallback(leafId),
          onClose: getCloseCallback(t.id, leafId),
          tabId: t.id,
          tabDirty: t.dirty,
          onSetMarkdownView: getMarkdownViewCallback(t.id),
        });
        return (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <EditorPaneTreeView
              node={t.paneTree}
              activeLeafId={t.activeLeafId}
              overrideLanguage={t.overrideLanguage}
              onFocusLeaf={(leafId) => onFocusLeaf(t.id, leafId)}
              getBundle={getBundle}
            />
          </div>
        );
      })}
    </div>
  );
}

