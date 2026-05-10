import type { Tab } from "@/modules/tabs";
import type { SearchAddon } from "@xterm/addon-search";
import { useEffect, useRef } from "react";
import { PaneTreeView } from "./PaneTreeView";
import type { TerminalPaneHandle } from "./TerminalPane";
import { leafIds } from "./lib/panes";
import { type TeraxOpenInput } from "./lib/useTerminalSession";

type Props = {
  tabs: Tab[];
  activeId: number;
  /** Register/unregister handle by leaf id (not tab id). */
  registerHandle: (leafId: number, handle: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onDetectedLocalUrl: (leafId: number, url: string) => void;
  onExit: (leafId: number, code: number) => void;
  onTeraxOpen?: (leafId: number, input: TeraxOpenInput) => void;
  onFocusLeaf: (tabId: number, leafId: number) => void;
};

type Bundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearch: (addon: SearchAddon) => void;
  onCwd: (cwd: string) => void;
  onDetectedUrl: (url: string) => void;
  onExit: (code: number) => void;
  onTeraxOpen: (input: TeraxOpenInput) => void;
};

export function TerminalStack({
  tabs,
  activeId,
  registerHandle,
  onSearchReady,
  onCwd,
  onDetectedLocalUrl,
  onExit,
  onTeraxOpen,
  onFocusLeaf,
}: Props) {
  const terminals = tabs.filter((t) => t.kind === "terminal");

  const registerRef = useRef(registerHandle);
  const searchReadyRef = useRef(onSearchReady);
  const cwdRef = useRef(onCwd);
  const detectedUrlRef = useRef(onDetectedLocalUrl);
  const exitRef = useRef(onExit);
  const teraxOpenRef = useRef(onTeraxOpen);
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
    detectedUrlRef.current = onDetectedLocalUrl;
  }, [onDetectedLocalUrl]);
  useEffect(() => {
    exitRef.current = onExit;
  }, [onExit]);
  useEffect(() => {
    teraxOpenRef.current = onTeraxOpen;
  }, [onTeraxOpen]);

  const bundles = useRef(new Map<number, Bundle>());
  const getBundle = (leafId: number): Bundle => {
    let b = bundles.current.get(leafId);
    if (!b) {
      b = {
        setRef: (h) => registerRef.current(leafId, h),
        onSearch: (addon) => searchReadyRef.current(leafId, addon),
        onCwd: (cwd) => cwdRef.current(leafId, cwd),
        onDetectedUrl: (url) => detectedUrlRef.current(leafId, url),
        onExit: (code) => exitRef.current(leafId, code),
        onTeraxOpen: (input) => teraxOpenRef.current?.(leafId, input),
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

  return (
    <div className="relative h-full w-full">
      {terminals.map((t) => {
        const tabVisible = t.id === activeId;
        return (
          <div key={t.id} className="absolute inset-0">
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
