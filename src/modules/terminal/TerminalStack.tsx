import type { Tab } from "@/modules/tabs";
import type { SearchAddon } from "@xterm/addon-search";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useMemo, useRef, useState } from "react";
import { PaneTreeView } from "./PaneTreeView";
import type { TerminalPaneHandle } from "./TerminalPane";
import { formatDroppedPaths, parsePaneLeafId } from "./lib/fileDrop";
import { leafIds } from "./lib/panes";
import { writeToSession } from "./lib/useTerminalSession";

type Props = {
  tabs: Tab[];
  activeId: number;
  /** Register/unregister handle by leaf id (not tab id). */
  registerHandle: (leafId: number, handle: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
  onFocusLeaf: (tabId: number, leafId: number) => void;
};

type Bundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearch: (addon: SearchAddon) => void;
  onCwd: (cwd: string) => void;
  onExit: (code: number) => void;
};

function leafIdAtPosition(position: { x: number; y: number }): number | null {
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const el = document.elementFromPoint(x, y);
  const leaf = el?.closest("[data-pane-leaf]") as HTMLElement | null;
  return parsePaneLeafId(leaf?.dataset.paneLeaf);
}

export function TerminalStack({
  tabs,
  activeId,
  registerHandle,
  onSearchReady,
  onCwd,
  onExit,
  onFocusLeaf,
}: Props) {
  const terminals = useMemo(
    () => tabs.filter((t) => t.kind === "terminal"),
    [tabs],
  );
  const [dropTargetLeafId, setDropTargetLeafId] = useState<number | null>(null);

  const registerRef = useRef(registerHandle);
  const searchReadyRef = useRef(onSearchReady);
  const cwdRef = useRef(onCwd);
  const exitRef = useRef(onExit);
  const leafToTabRef = useRef(new Map<number, number>());
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    searchReadyRef.current = onSearchReady;
  }, [onSearchReady]);
  useEffect(() => {
    cwdRef.current = onCwd;
  }, [onCwd]);
  useEffect(() => {
    exitRef.current = onExit;
  }, [onExit]);

  const bundles = useRef(new Map<number, Bundle>());
  const getBundle = (leafId: number): Bundle => {
    let b = bundles.current.get(leafId);
    if (!b) {
      b = {
        setRef: (h) => registerRef.current(leafId, h),
        onSearch: (addon) => searchReadyRef.current(leafId, addon),
        onCwd: (cwd) => cwdRef.current(leafId, cwd),
        onExit: (code) => exitRef.current(leafId, code),
      };
      bundles.current.set(leafId, b);
    }
    return b;
  };

  useEffect(() => {
    const live = new Set<number>();
    const leafToTab = new Map<number, number>();
    for (const t of terminals) {
      for (const id of leafIds(t.paneTree)) {
        live.add(id);
        leafToTab.set(id, t.id);
      }
    }
    leafToTabRef.current = leafToTab;
    for (const id of bundles.current.keys()) {
      if (!live.has(id)) bundles.current.delete(id);
    }
  }, [terminals]);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "leave") {
          setDropTargetLeafId(null);
          return;
        }

        const leafId = leafIdAtPosition(payload.position);
        if (payload.type === "enter" || payload.type === "over") {
          setDropTargetLeafId(leafId);
          return;
        }

        setDropTargetLeafId(null);
        if (leafId === null) return;

        const text = formatDroppedPaths(payload.paths);
        if (!text) return;

        const tabId = leafToTabRef.current.get(leafId);
        if (tabId !== undefined) onFocusLeaf(tabId, leafId);
        writeToSession(leafId, text);
      })
      .then((cleanup) => {
        if (mounted) {
          unlisten = cleanup;
        } else {
          cleanup();
        }
      })
      .catch((error: unknown) => {
        console.warn("[terax] failed to register terminal file drop", error);
      });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [onFocusLeaf]);

  return (
    <div className="relative h-full w-full">
      {terminals.map((t) => {
        const tabVisible = t.id === activeId;
        return (
          <div
            key={t.id}
            className="absolute inset-0"
            style={{
              visibility: tabVisible ? "visible" : "hidden",
              pointerEvents: tabVisible ? "auto" : "none",
            }}
            aria-hidden={!tabVisible}
          >
            <PaneTreeView
              node={t.paneTree}
              tabVisible={tabVisible}
              activeLeafId={t.activeLeafId}
              dropTargetLeafId={tabVisible ? dropTargetLeafId : null}
              onFocusLeaf={(leafId) => onFocusLeaf(t.id, leafId)}
              getBundle={getBundle}
            />
          </div>
        );
      })}
    </div>
  );
}
