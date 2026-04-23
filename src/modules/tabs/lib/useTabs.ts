import { useCallback, useRef, useState } from "react";

export type Tab = {
  id: number;
  title: string;
  cwd?: string;
};

export function useTabs(initial?: Partial<Tab>) {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 1, title: initial?.title ?? "shell", ...initial },
  ]);
  const [activeId, setActiveId] = useState(1);
  const nextIdRef = useRef(2);

  const newTab = useCallback((cwd?: string) => {
    const id = nextIdRef.current++;
    setTabs((t) => [...t, { id, title: "shell", cwd }]);
    setActiveId(id);
    return id;
  }, []);

  const closeTab = useCallback((id: number) => {
    setTabs((curr) => {
      if (curr.length <= 1) return curr;
      const idx = curr.findIndex((t) => t.id === id);
      const next = curr.filter((t) => t.id !== id);
      setActiveId((active) =>
        id === active ? next[Math.max(0, idx - 1)].id : active,
      );
      return next;
    });
  }, []);

  const updateTab = useCallback((id: number, patch: Partial<Tab>) => {
    setTabs((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);

  const selectByIndex = useCallback(
    (idx: number) => {
      const t = tabs[idx];
      if (t) setActiveId(t.id);
    },
    [tabs],
  );

  return {
    tabs,
    activeId,
    setActiveId,
    newTab,
    closeTab,
    updateTab,
    selectByIndex,
  };
}
