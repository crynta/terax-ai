import { useEffect, useSyncExternalStore } from "react";
import {
  bindDomWindowFocus,
  getWindowInactive,
  installWindowActivity,
  subscribeWindowInactive,
  type WindowActivitySources,
} from "./windowActivity";

type Props = Pick<WindowActivitySources, "bindFocus" | "subscribePresentation">;

/**
 * Mounts the window-activity tracker (sets `data-window-inactive` on <html>).
 * The main window passes the terminal's shared focus + native presentation
 * feeds; Settings has no native feed and uses plain DOM focus.
 */
export function WindowActivityBridge({
  bindFocus = bindDomWindowFocus,
  subscribePresentation,
}: Partial<Props>) {
  useEffect(
    () =>
      installWindowActivity({
        root: document.documentElement,
        doc: document,
        bindFocus,
        subscribePresentation,
      }),
    [bindFocus, subscribePresentation],
  );
  return null;
}

/** True while the window is unfocused, hidden or occluded. */
export function useWindowInactive(): boolean {
  return useSyncExternalStore(
    subscribeWindowInactive,
    getWindowInactive,
    () => false,
  );
}
