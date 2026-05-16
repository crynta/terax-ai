import { cn } from "@/lib/utils";
import type { EditorTab, Tab } from "@/modules/tabs";
import { useEffect, useRef } from "react";
import { EditorPane, type EditorPaneHandle } from "./EditorPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  onDirtyChange: (id: number, dirty: boolean) => void;
  registerHandle: (id: number, handle: EditorPaneHandle | null) => void;
  onCloseTab: (id: number) => void;
  onNavigateToDefinition: (
    path: string,
    line: number,
    character: number,
    fromPath: string,
    fromLine: number,
    fromCharacter: number,
  ) => void;
};

export function EditorStack({
  tabs,
  activeId,
  onDirtyChange,
  registerHandle,
  onCloseTab,
  onNavigateToDefinition,
}: Props) {
  const editors = tabs.filter((t): t is EditorTab => t.kind === "editor");

  // Stable per-tab callbacks. Inline arrows in `ref` and `onDirtyChange`
  // change identity every render, which makes React detach+reattach the ref
  // callback and re-invoke `onDirtyChange`, triggering setState loops in
  // the parent. Memoizing per id keeps each callback's identity stable.
  const registerRef = useRef(registerHandle);
  const dirtyRef = useRef(onDirtyChange);
  const closeRef = useRef(onCloseTab);
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    dirtyRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    closeRef.current = onCloseTab;
  }, [onCloseTab]);

  const refCallbacks = useRef(
    new Map<number, (h: EditorPaneHandle | null) => void>(),
  );
  const dirtyCallbacks = useRef(new Map<number, (dirty: boolean) => void>());
  const closeCallbacks = useRef(new Map<number, () => void>());

  const getRefCallback = (id: number) => {
    let cb = refCallbacks.current.get(id);
    if (!cb) {
      cb = (h: EditorPaneHandle | null) => registerRef.current(id, h);
      refCallbacks.current.set(id, cb);
    }
    return cb;
  };
  const getDirtyCallback = (id: number) => {
    let cb = dirtyCallbacks.current.get(id);
    if (!cb) {
      cb = (dirty: boolean) => dirtyRef.current(id, dirty);
      dirtyCallbacks.current.set(id, cb);
    }
    return cb;
  };
  const getCloseCallback = (id: number) => {
    let cb = closeCallbacks.current.get(id);
    if (!cb) {
      cb = () => closeRef.current(id);
      closeCallbacks.current.set(id, cb);
    }
    return cb;
  };

  // Drop callback entries for closed tabs to avoid unbounded growth.
  useEffect(() => {
    const live = new Set(editors.map((t) => t.id));
    for (const id of refCallbacks.current.keys()) {
      if (!live.has(id)) refCallbacks.current.delete(id);
    }
    for (const id of dirtyCallbacks.current.keys()) {
      if (!live.has(id)) dirtyCallbacks.current.delete(id);
    }
    for (const id of closeCallbacks.current.keys()) {
      if (!live.has(id)) closeCallbacks.current.delete(id);
    }
  }, [editors]);

  if (editors.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {editors.map((t) => {
        const visible = t.id === activeId;
        return (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <div className="h-full overflow-hidden rounded-md border border-border/60 bg-background">
              <EditorPane
                ref={getRefCallback(t.id)}
                path={t.path}
                onDirtyChange={getDirtyCallback(t.id)}
                onClose={getCloseCallback(t.id)}
                onNavigateToDefinition={onNavigateToDefinition}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
