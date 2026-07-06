import { setStatusBarVisible } from "@/modules/settings/store";
import { create } from "zustand";

const STATUSBAR_COLLAPSED_STORAGE_KEY = "terax.statusbar.collapsed";
// Shadow of the "start with status bar hidden" pref — read synchronously at
// startup, before the pref store hydrates (mirrored from preferences init).
const STATUSBAR_START_COLLAPSED_SHADOW_KEY =
  "terax-statusbar-start-collapsed-shadow";

const STATUSBAR_DISABLED_SHADOW_KEY = "terax-statusbar-disabled-shadow";

export function mirrorStatusBarStartCollapsedFastPath(
  collapsed: boolean,
): void {
  try {
    window.localStorage.setItem(
      STATUSBAR_START_COLLAPSED_SHADOW_KEY,
      collapsed ? "1" : "0",
    );
  } catch {
    // storage may fail in private mode
  }
}

export function mirrorStatusBarDisabledFastPath(disabled: boolean): void {
  try {
    window.localStorage.setItem(
      STATUSBAR_DISABLED_SHADOW_KEY,
      disabled ? "1" : "0",
    );
  } catch {
    // storage may fail in private mode
  }
}

/** Sync read at startup so a disabled bar never flashes before hydration. */
export function readStatusBarDisabledFastPath(): boolean {
  try {
    return window.localStorage.getItem(STATUSBAR_DISABLED_SHADOW_KEY) === "1";
  } catch {
    return false;
  }
}

function readStatusBarCollapsed(): boolean {
  // "Start with status bar hidden" wins over the remembered state.
  try {
    if (
      window.localStorage.getItem(STATUSBAR_START_COLLAPSED_SHADOW_KEY) === "1"
    ) {
      return true;
    }
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
  /** Transient hide from an active shell tool (nvim etc.) — not persisted. */
  toolHidden: boolean;
  /** Tool mode "disable": also drop the reopen controls and block ⌘⇧J. */
  toolDisabled: boolean;
  toggle: () => void;
  setToolHidden: (hidden: boolean, disabled?: boolean) => void;
};

/** Shared so both the status bar itself and the app shortcut can toggle it. */
export const useStatusBarCollapsed = create<State>((set) => ({
  // localStorage fast path: the bar renders before the pref store hydrates.
  collapsed: readStatusBarCollapsed(),
  // Seed from the disabled shadow — App re-syncs these after hydration.
  toolHidden: readStatusBarDisabledFastPath(),
  toolDisabled: readStatusBarDisabledFastPath(),
  toggle: () =>
    set((s) => {
      // While a shell tool hides the bar, toggling `collapsed` would change
      // nothing visibly — it would only corrupt the state the bar restores
      // to when the tool exits.
      if (s.toolHidden || s.toolDisabled) return s;
      const next = !s.collapsed;
      persistStatusBarCollapsed(next);
      // Keep the Settings switch in sync (fire-and-forget pref write).
      void setStatusBarVisible(!next).catch(() => {});
      return { collapsed: next };
    }),
  setToolHidden: (hidden, disabled = false) =>
    set({ toolHidden: hidden, toolDisabled: hidden && disabled }),
}));

/** Apply the `statusBarVisible` preference (hydration or a Settings change). */
export function applyStatusBarVisiblePref(visible: boolean): void {
  const collapsed = !visible;
  persistStatusBarCollapsed(collapsed);
  if (useStatusBarCollapsed.getState().collapsed !== collapsed) {
    useStatusBarCollapsed.setState({ collapsed });
  }
}
