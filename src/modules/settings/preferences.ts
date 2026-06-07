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
const FAST_BG_VIDEO_ID_KEY = "terax-ui-bg-video-shadow";

function mirrorBgFastPath(
  kind: Preferences["backgroundKind"],
  imageId: Preferences["backgroundImageId"],
  videoId: Preferences["backgroundVideoId"],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FAST_BG_KIND_KEY, kind);
    if (imageId) window.localStorage.setItem(FAST_BG_IMAGE_ID_KEY, imageId);
    else window.localStorage.removeItem(FAST_BG_IMAGE_ID_KEY);
    if (videoId) window.localStorage.setItem(FAST_BG_VIDEO_ID_KEY, videoId);
    else window.localStorage.removeItem(FAST_BG_VIDEO_ID_KEY);
  } catch {
    /* ignore */
  }
}

export function readBgFastPath(): {
  active: boolean;
  imageId: string | null;
  videoId: string | null;
} {
  if (typeof window === "undefined") return { active: false, imageId: null, videoId: null };
  try {
    const kind = window.localStorage.getItem(FAST_BG_KIND_KEY);
    const imageId = window.localStorage.getItem(FAST_BG_IMAGE_ID_KEY);
    const videoId = window.localStorage.getItem(FAST_BG_VIDEO_ID_KEY);
    return { 
      active: (kind === "image" && !!imageId) || (kind === "video" && !!videoId), 
      imageId, 
      videoId 
    };
  } catch {
    return { active: false, imageId: null, videoId: null };
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
    mirrorBgFastPath(prefs.backgroundKind, prefs.backgroundImageId, prefs.backgroundVideoId);
    void onPreferencesChange((key, value) => {
      set({ [key]: value } as Partial<State>);
      if (key === "backgroundKind" || key === "backgroundImageId" || key === "backgroundVideoId") {
        const s = usePreferencesStore.getState();
        mirrorBgFastPath(s.backgroundKind, s.backgroundImageId, s.backgroundVideoId);
      }
    });
  },
}));
