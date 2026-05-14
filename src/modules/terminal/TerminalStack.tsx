import type { Tab } from "@/modules/tabs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { SearchAddon } from "@xterm/addon-search";
import { useEffect, useMemo, useRef } from "react";
import { PaneTreeView } from "./PaneTreeView";
import type { TerminalPaneHandle } from "./TerminalPane";
import { pathsToTerminalPaste } from "./lib/dropPaths";
import { leafIds } from "./lib/panes";

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

export function TerminalStack({
  tabs,
  activeId,
  registerHandle,
  onSearchReady,
  onCwd,
  onExit,
  onFocusLeaf,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const terminals = useMemo(
    () => tabs.filter((t) => t.kind === "terminal"),
    [tabs],
  );

  const registerRef = useRef(registerHandle);
  const searchReadyRef = useRef(onSearchReady);
  const cwdRef = useRef(onCwd);
  const exitRef = useRef(onExit);
  const terminalsRef = useRef(terminals);
  const activeIdRef = useRef(activeId);
  const focusLeafRef = useRef(onFocusLeaf);
  const handles = useRef(new Map<number, TerminalPaneHandle>());
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
  useEffect(() => {
    terminalsRef.current = terminals;
  }, [terminals]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    focusLeafRef.current = onFocusLeaf;
  }, [onFocusLeaf]);

  const bundles = useRef(new Map<number, Bundle>());
  const getBundle = (leafId: number): Bundle => {
    let b = bundles.current.get(leafId);
    if (!b) {
      b = {
        setRef: (h) => {
          if (h) handles.current.set(leafId, h);
          else handles.current.delete(leafId);
          registerRef.current(leafId, h);
        },
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
    for (const t of terminals) for (const id of leafIds(t.paneTree)) live.add(id);
    for (const id of bundles.current.keys()) {
      if (!live.has(id)) bundles.current.delete(id);
    }
  }, [terminals]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type !== "drop") return;

        const pasteText = pathsToTerminalPaste(payload.paths);
        if (!pasteText) return;

        const terminalTab = terminalsRef.current.find(
          (t) => t.id === activeIdRef.current,
        );
        if (!terminalTab) return;

        if (!isPositionInTerminalRoot(rootRef.current, payload.position)) {
          return;
        }

        const targetLeafId =
          leafIdAtPosition(rootRef.current, terminalTab.id, payload.position) ??
          terminalTab.activeLeafId;
        const handle = handles.current.get(targetLeafId);
        if (!handle) return;

        focusLeafRef.current(terminalTab.id, targetLeafId);
        handle.focus();
        handle.paste(pasteText);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((error) => {
        console.warn("Terminal file drop listener unavailable:", error);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div ref={rootRef} className="relative h-full w-full">
      {terminals.map((t) => {
        const tabVisible = t.id === activeId;
        return (
          <div
            key={t.id}
            data-terminal-tab-id={t.id}
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
              onFocusLeaf={(leafId) => onFocusLeaf(t.id, leafId)}
              getBundle={getBundle}
            />
          </div>
        );
      })}
    </div>
  );
}

function cssPoint(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: position.x / window.devicePixelRatio,
    y: position.y / window.devicePixelRatio,
  };
}

function isPositionInTerminalRoot(
  root: HTMLDivElement | null,
  position: { x: number; y: number },
): boolean {
  if (!root) return false;

  const point = cssPoint(position);
  const rect = root.getBoundingClientRect();
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function leafIdAtPosition(
  root: HTMLDivElement | null,
  tabId: number,
  position: { x: number; y: number },
): number | null {
  const tab = root?.querySelector<HTMLElement>(
    `[data-terminal-tab-id="${tabId}"]`,
  );
  if (!tab) return null;

  const { x, y } = cssPoint(position);
  const leaves = tab.querySelectorAll<HTMLElement>("[data-pane-leaf]");

  for (const leaf of leaves) {
    const rect = leaf.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      continue;
    }

    const leafId = Number(leaf.dataset.paneLeaf);
    return Number.isFinite(leafId) ? leafId : null;
  }

  return null;
}
