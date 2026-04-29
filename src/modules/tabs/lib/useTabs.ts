import { useCallback, useRef, useState } from "react";

export type TerminalTab = {
  id: number;
  kind: "terminal";
  title: string;
  cwd?: string;
};

export type EditorTab = {
  id: number;
  kind: "editor";
  title: string;
  path: string;
  dirty: boolean;
};

export type PreviewTab = {
  id: number;
  kind: "preview";
  title: string;
  url: string;
};

export type Tab = TerminalTab | EditorTab | PreviewTab;

export type TabPatch = Partial<{
  title: string;
  cwd: string;
  path: string;
  dirty: boolean;
  url: string;
}>;

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url || "preview";
  }
}

export function useTabs(initial?: Partial<TerminalTab>) {
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: 1,
      kind: "terminal",
      title: initial?.title ?? "shell",
      cwd: initial?.cwd,
    },
  ]);
  const [activeId, setActiveId] = useState(1);
  const nextIdRef = useRef(2);

  const newTab = useCallback((cwd?: string) => {
    const id = nextIdRef.current++;
    setTabs((t) => [...t, { id, kind: "terminal", title: "shell", cwd }]);
    setActiveId(id);
    return id;
  }, []);

  const openFileTab = useCallback((path: string) => {
    let targetId: number | null = null;
    setTabs((curr) => {
      const existing = curr.find(
        (t) => t.kind === "editor" && t.path === path,
      );
      if (existing) {
        targetId = existing.id;
        return curr;
      }
      const id = nextIdRef.current++;
      targetId = id;
      return [
        ...curr,
        {
          id,
          kind: "editor",
          title: basename(path),
          path,
          dirty: false,
        },
      ];
    });
    if (targetId !== null) setActiveId(targetId);
    return targetId as number | null;
  }, []);

  const newPreviewTab = useCallback((url: string) => {
    const id = nextIdRef.current++;
    setTabs((t) => [
      ...t,
      { id, kind: "preview", title: titleFromUrl(url), url },
    ]);
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

  const updateTab = useCallback((id: number, patch: TabPatch) => {
    setTabs((t) =>
      t.map((x) => {
        if (x.id !== id) return x;
        if (x.kind === "terminal") {
          return {
            ...x,
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.cwd !== undefined && { cwd: patch.cwd }),
          };
        }
        if (x.kind === "preview") {
          return {
            ...x,
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.url !== undefined && {
              url: patch.url,
              title: patch.title ?? titleFromUrl(patch.url),
            }),
          };
        }
        return {
          ...x,
          ...(patch.title !== undefined && { title: patch.title }),
          ...(patch.dirty !== undefined && { dirty: patch.dirty }),
          ...(patch.path !== undefined && { path: patch.path }),
        };
      }),
    );
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
    openFileTab,
    newPreviewTab,
    closeTab,
    updateTab,
    selectByIndex,
  };
}
