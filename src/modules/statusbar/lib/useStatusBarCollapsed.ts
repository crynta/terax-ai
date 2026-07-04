import { setStatusBarVisible } from "@/modules/settings/store";
import { create } from "zustand";

const STATUSBAR_COLLAPSED_STORAGE_KEY = "terax.statusbar.collapsed";

function readStatusBarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STATUSBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistStatusBarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(
      STATUSBAR_COLLAPSED_STORAGE_KEY,
      collapsed ? "1" : "0",
    );
  } catch {
    // storage may fail in private mode
  }
}

type State = {
  collapsed: boolean;
  toggle: () => void;
};

/** Shared so both the status bar itself and the app shortcut can toggle it. */
export const useStatusBarCollapsed = create<State>((set) => ({
  // localStorage fast path: the bar renders before the pref store hydrates.
  collapsed: readStatusBarCollapsed(),
  toggle: () =>
    set((s) => {
      const next = !s.collapsed;
      persistStatusBarCollapsed(next);
      // Keep the Settings switch in sync (fire-and-forget pref write).
      void setStatusBarVisible(!next).catch(() => {});
      return { collapsed: next };
    }),
}));

/** Apply the `statusBarVisible` preference (hydration or a Settings change). */
export function applyStatusBarVisiblePref(visible: boolean): void {
  const collapsed = !visible;
  persistStatusBarCollapsed(collapsed);
  if (useStatusBarCollapsed.getState().collapsed !== collapsed) {
    useStatusBarCollapsed.setState({ collapsed });
  }
}
