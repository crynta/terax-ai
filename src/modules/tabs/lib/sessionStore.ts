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

let saveQueue = Promise.resolve();

export function saveSession(tabs: Tab[], activeId: number): Promise<void> {
  const op = async () => {
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
      if (t.kind === "editor") {
        return { ...t, dirty: false };
      }
      return t;
    });

    const state: SessionState = {
      tabs: sessionTabs,
      activeId: savedActiveId,
    };

    await store.set(KEY_SESSION, state);
    await store.save();
  };

  saveQueue = saveQueue.then(op).catch(console.error);
  return saveQueue;
}

function isSessionState(state: any): state is SessionState {
  if (!state || typeof state !== "object") return false;
  if (!Array.isArray(state.tabs) || state.tabs.length === 0) return false;
  
  const supportedKinds = ["terminal", "editor", "preview", "ai-diff", "git-diff", "git-history", "git-commit-file"];
  
  for (const t of state.tabs) {
    if (!t || typeof t !== "object") return false;
    if (typeof t.id !== "number") return false;
    if (!supportedKinds.includes(t.kind)) return false;
    
    if (t.kind === "terminal") {
      if (!t.paneTree || typeof t.paneTree !== "object") return false;
      if (typeof t.activeLeafId !== "number") return false;
    }
  }
  
  if (typeof state.activeId !== "number") return false;
  if (!state.tabs.some((t: any) => t.id === state.activeId)) return false;
  
  return true;
}

export async function loadSession(): Promise<SessionState | null> {
  const state = await store.get<any>(KEY_SESSION);
  if (!isSessionState(state)) return null;
  return state;
}
