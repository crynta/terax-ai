import { cn } from "@/lib/utils";
import type { NotebookTab, Tab } from "@/modules/tabs";
import { useEffect, useRef } from "react";
import { NotebookPane, type NotebookPaneHandle } from "./NotebookPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  onDirtyChange: (id: number, dirty: boolean) => void;
  registerHandle: (id: number, handle: NotebookPaneHandle | null) => void;
};

export function NotebookStack({
  tabs,
  activeId,
  onDirtyChange,
  registerHandle,
}: Props) {
  const notebooks = tabs.filter((t): t is NotebookTab => t.kind === "notebook");
  const registerRef = useRef(registerHandle);
  const dirtyRef = useRef(onDirtyChange);
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    dirtyRef.current = onDirtyChange;
  }, [onDirtyChange]);

  const refCallbacks = useRef(
    new Map<number, (handle: NotebookPaneHandle | null) => void>(),
  );
  const dirtyCallbacks = useRef(new Map<number, (dirty: boolean) => void>());

  const getRefCallback = (id: number) => {
    let callback = refCallbacks.current.get(id);
    if (!callback) {
      callback = (handle: NotebookPaneHandle | null) =>
        registerRef.current(id, handle);
      refCallbacks.current.set(id, callback);
    }
    return callback;
  };

  const getDirtyCallback = (id: number) => {
    let callback = dirtyCallbacks.current.get(id);
    if (!callback) {
      callback = (dirty: boolean) => dirtyRef.current(id, dirty);
      dirtyCallbacks.current.set(id, callback);
    }
    return callback;
  };

  useEffect(() => {
    const live = new Set(notebooks.map((tab) => tab.id));
    for (const id of refCallbacks.current.keys()) {
      if (!live.has(id)) refCallbacks.current.delete(id);
    }
    for (const id of dirtyCallbacks.current.keys()) {
      if (!live.has(id)) dirtyCallbacks.current.delete(id);
    }
  }, [notebooks]);

  if (notebooks.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {notebooks.map((tab) => {
        const visible = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <NotebookPane
              ref={getRefCallback(tab.id)}
              path={tab.path}
              onDirtyChange={getDirtyCallback(tab.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
