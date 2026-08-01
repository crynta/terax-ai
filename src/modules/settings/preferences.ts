import {
  applyStatusBarVisiblePref,
  mirrorStatusBarDisabledFastPath,
  mirrorStatusBarStartCollapsedFastPath,
  readStatusBarDisabledFastPath,
} from "@/modules/statusbar/lib/useStatusBarCollapsed";
import { create } from "zustand";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  onPreferencesChange,
  type Preferences,
} from "./store";

type State = Preferences & {
  hydrated: boolean;
  /** Subscribe & hydrate. Idempotent — safe to call from multiple windows. */
  init: () => Promise<void>;
};

let initPromise: Promise<void> | null = null;

const FAST_BG_KIND_KEY = "terax-ui-bg-kind-shadow";
const FAST_BG_IMAGE_ID_KEY = "terax-ui-bg-image-shadow";
const FAST_SIDEBAR_START_COLLAPSED_KEY = "terax-sidebar-start-collapsed-shadow";

function mirrorBgFastPath(
  kind: Preferences["backgroundKind"],
  imageId: Preferences["backgroundImageId"],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FAST_BG_KIND_KEY, kind);
    if (imageId) window.localStorage.setItem(FAST_BG_IMAGE_ID_KEY, imageId);
    else window.localStorage.removeItem(FAST_BG_IMAGE_ID_KEY);
  } catch {
    /* ignore */
  }
}

function mirrorSidebarStartCollapsedFastPath(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FAST_SIDEBAR_START_COLLAPSED_KEY,
      collapsed ? "1" : "0",
    );
  } catch {
    /* ignore */
  }
}

/** Sync read for first render — the panel mounts before prefs hydrate. */
export function readSidebarStartCollapsedFastPath(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(FAST_SIDEBAR_START_COLLAPSED_KEY) === "1"
    );
  } catch {
    return false;
  }
}

const FAST_SIDEBAR_DISABLED_KEY = "terax-sidebar-disabled-shadow";

function mirrorSidebarDisabledFastPath(disabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FAST_SIDEBAR_DISABLED_KEY,
      disabled ? "1" : "0",
    );
  } catch {
    /* ignore */
  }
}

/** Sync read at startup so a disabled sidebar never opens before hydration. */
export function readSidebarDisabledFastPath(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FAST_SIDEBAR_DISABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function readBgFastPath(): {
  active: boolean;
  imageId: string | null;
} {
  if (typeof window === "undefined") return { active: false, imageId: null };
  try {
    const kind = window.localStorage.getItem(FAST_BG_KIND_KEY);
    const imageId = window.localStorage.getItem(FAST_BG_IMAGE_ID_KEY);
    return { active: kind === "image" && !!imageId, imageId };
  } catch {
    return { active: false, imageId: null };
  }
}

export const usePreferencesStore = create<State>((set) => ({
  ...DEFAULT_PREFERENCES,
  // Shadow fast-paths: App wires these into effects on first render, so the
  // pre-hydration values must already reflect the stored prefs.
  sidebarDisabled: readSidebarDisabledFastPath(),
  statusBarDisabled: readStatusBarDisabledFastPath(),
  hydrated: false,
  init: () => {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const prefs = await loadPreferences();
        set({ ...prefs, hydrated: true });
        mirrorBgFastPath(prefs.backgroundKind, prefs.backgroundImageId);
        mirrorSidebarStartCollapsedFastPath(prefs.sidebarStartCollapsed);
        mirrorStatusBarStartCollapsedFastPath(prefs.statusBarStartCollapsed);
        mirrorSidebarDisabledFastPath(prefs.sidebarDisabled);
        mirrorStatusBarDisabledFastPath(prefs.statusBarDisabled);
        // With "start hidden" on, keep the launch state collapsed instead of
        // re-expanding to the last remembered visibility.
        if (!prefs.statusBarStartCollapsed) {
          applyStatusBarVisiblePref(prefs.statusBarVisible);
        }
        void onPreferencesChange((key, value) => {
          set({ [key]: value } as Partial<State>);
          if (key === "backgroundKind" || key === "backgroundImageId") {
            const s = usePreferencesStore.getState();
            mirrorBgFastPath(s.backgroundKind, s.backgroundImageId);
          }
          if (key === "sidebarStartCollapsed") {
            mirrorSidebarStartCollapsedFastPath(value === true);
          }
          if (key === "statusBarStartCollapsed") {
            mirrorStatusBarStartCollapsedFastPath(value === true);
          }
          if (key === "sidebarDisabled") {
            mirrorSidebarDisabledFastPath(value === true);
          }
          if (key === "statusBarDisabled") {
            mirrorStatusBarDisabledFastPath(value === true);
          }
          if (key === "statusBarVisible") {
            applyStatusBarVisiblePref(value !== false);
          }
        });
      } catch (e) {
        initPromise = null;
        throw e;
      }
    })();
    return initPromise;
  },
}));
