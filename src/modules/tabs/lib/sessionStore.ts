import { LazyStore } from "@tauri-apps/plugin-store";
import type { Tab } from "./useTabs";

export type SessionState = {
  tabs: Tab[];
  activeId: number;
};

const STORE_PATH = "terax-session.json";
const KEY_SESSION = "session";

// Use autoSave to automatically debounce and flush writes.
const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 500 });

export async function saveSession(tabs: Tab[], activeId: number): Promise<void> {
  // Filter out volatile tabs that shouldn't be restored
  const persistentTabs = tabs.filter((t) => {
    if (t.kind === "preview" || t.kind === "ai-diff" || t.kind === "git-diff" || t.kind === "git-history" || t.kind === "git-commit-file") {
      return false;
    }
    // For editor tabs, only save if they are not in preview mode.
    if (t.kind === "editor" && t.preview) {
      return false;
    }
    return true;
  });

  // Ensure activeId points to a tab that is actually saved. If not, fallback to the last saved tab or 1.
  let savedActiveId = activeId;
  if (!persistentTabs.find(t => t.id === savedActiveId)) {
    savedActiveId = persistentTabs.length > 0 ? persistentTabs[persistentTabs.length - 1].id : 1;
  }

  // Force cold state on all terminal tabs so they don't immediately spawn PTYs upon restore
  const sessionTabs = persistentTabs.map(t => {
    if (t.kind === "terminal") {
      return { ...t, cold: true };
    }
    return t;
  });

  const state: SessionState = {
    tabs: sessionTabs,
    activeId: savedActiveId,
  };

  await store.set(KEY_SESSION, state);
  await store.save();
}

export async function loadSession(): Promise<SessionState | null> {
  const state = await store.get<SessionState>(KEY_SESSION);
  if (!state || !state.tabs || state.tabs.length === 0) return null;
  return state;
}
