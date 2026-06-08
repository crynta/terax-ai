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

let initialized = false;

const FAST_BG_KIND_KEY = "terax-ui-bg-kind-shadow";
const FAST_BG_IMAGE_ID_KEY = "terax-ui-bg-image-shadow";

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
  hydrated: false,
  init: async () => {
    if (initialized) return;
    initialized = true;
    const prefs = await loadPreferences();
    set({ ...prefs, hydrated: true });
    mirrorBgFastPath(prefs.backgroundKind, prefs.backgroundImageId);
    void onPreferencesChange((key, value) => {
      set({ [key]: value } as Partial<State>);
      if (key === "backgroundKind" || key === "backgroundImageId") {
        const s = usePreferencesStore.getState();
        mirrorBgFastPath(s.backgroundKind, s.backgroundImageId);
      }
      if (key === "lspEnabled" && value === false) {
        void import("@/modules/editor/lib/lsp/shutdown").then(({ disableLsp }) =>
          disableLsp(),
        );
      }
    });
  },
}));
