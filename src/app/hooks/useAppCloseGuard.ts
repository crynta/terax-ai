import type { Tab } from "@/modules/tabs";
import { leafHasForegroundProcess, leafIds } from "@/modules/terminal";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

async function anyTerminalBusy(tabs: Tab[]): Promise<boolean> {
  const leaves = tabs.flatMap((t) =>
    t.kind === "terminal" ? leafIds(t.paneTree) : [],
  );
  if (leaves.length === 0) return false;
  const checks = await Promise.all(leaves.map(leafHasForegroundProcess));
  return checks.some(Boolean);
}

export function useAppCloseGuard(tabsRef: RefObject<Tab[]>) {
  const [pendingAppClose, setPendingAppClose] = useState(false);
  const forceClose = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (forceClose.current) return;
        event.preventDefault();
        if (await anyTerminalBusy(tabsRef.current)) {
          setPendingAppClose(true);
        } else {
          forceClose.current = true;
          void getCurrentWindow().close();
        }
      })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [tabsRef]);

  const confirmAppClose = useCallback(() => {
    setPendingAppClose(false);
    forceClose.current = true;
    void getCurrentWindow().close();
  }, []);

  const cancelAppClose = useCallback(() => setPendingAppClose(false), []);

  return { pendingAppClose, confirmAppClose, cancelAppClose };
}
