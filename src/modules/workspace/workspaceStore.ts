import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "./env";

export type WorkspaceInfo = {
  path: string;
  name: string;
  lastOpened: number;
  env: WorkspaceEnv;
};

export type WorkspaceLayout = {
  tabs: Tab[];
  activeId: number;
};

type WorkspaceState = {
  activeWorkspacePath: string | null;
  recentWorkspaces: WorkspaceInfo[];
  layouts: Record<string, WorkspaceLayout>;
  hydrated: boolean;
  init: (defaultPath: string, defaultEnv: WorkspaceEnv) => Promise<void>;
  openWorkspace: (path: string, env: WorkspaceEnv) => Promise<void>;
  saveLayout: (path: string, layout: WorkspaceLayout) => Promise<void>;
  removeRecentWorkspace: (path: string) => Promise<void>;
  clearHistory: () => Promise<void>;
};

const STORE_PATH = "terax-workspaces.json";
const KEY_ACTIVE = "activeWorkspacePath";
const KEY_RECENTS = "recentWorkspaces";
const KEY_LAYOUTS = "layouts";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

function getFolderBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeWorkspacePath: null,
  recentWorkspaces: [],
  layouts: {},
  hydrated: false,

  init: async (defaultPath, defaultEnv) => {
    if (get().hydrated) return;

    const entries = await store.entries();
    let activePath: string | null = null;
    let recents: WorkspaceInfo[] = [];
    let layouts: Record<string, WorkspaceLayout> = {};

    for (const [k, v] of entries) {
      if (k === KEY_ACTIVE) activePath = v as string | null;
      else if (k === KEY_RECENTS) recents = v as WorkspaceInfo[];
      else if (k === KEY_LAYOUTS) layouts = v as Record<string, WorkspaceLayout>;
    }

    if (!activePath) {
      activePath = defaultPath;
    }

    // Add initial/default path to recent list if not already present
    const cleanPath = defaultPath.replace(/\\/g, "/");
    const exists = recents.some((w) => w.path.replace(/\\/g, "/") === cleanPath);
    if (!exists && defaultPath) {
      const info: WorkspaceInfo = {
        path: defaultPath,
        name: getFolderBasename(defaultPath),
        lastOpened: Date.now(),
        env: defaultEnv,
      };
      recents = [info, ...recents];
      void store.set(KEY_RECENTS, recents);
    }

    set({
      activeWorkspacePath: activePath,
      recentWorkspaces: recents,
      layouts: layouts || {},
      hydrated: true,
    });
    void store.set(KEY_ACTIVE, activePath);
  },

  openWorkspace: async (path, env) => {
    const cleanPath = path.replace(/\\/g, "/");
    const name = getFolderBasename(path);

    // Update active workspace
    set({ activeWorkspacePath: cleanPath });
    void store.set(KEY_ACTIVE, cleanPath);

    // Update recents list
    let recents = get().recentWorkspaces.filter(
      (w) => w.path.replace(/\\/g, "/") !== cleanPath,
    );
    const newWorkspace: WorkspaceInfo = {
      path: cleanPath,
      name,
      lastOpened: Date.now(),
      env,
    };
    recents = [newWorkspace, ...recents];
    set({ recentWorkspaces: recents });
    void store.set(KEY_RECENTS, recents);
  },

  saveLayout: async (path, layout) => {
    const cleanPath = path.replace(/\\/g, "/");
    const currentLayouts = { ...get().layouts, [cleanPath]: layout };
    set({ layouts: currentLayouts });
    void store.set(KEY_LAYOUTS, currentLayouts);
  },

  removeRecentWorkspace: async (path) => {
    const cleanPath = path.replace(/\\/g, "/");
    const recents = get().recentWorkspaces.filter(
      (w) => w.path.replace(/\\/g, "/") !== cleanPath,
    );
    set({ recentWorkspaces: recents });
    void store.set(KEY_RECENTS, recents);
  },

  clearHistory: async () => {
    const active = get().activeWorkspacePath;
    const recents = get().recentWorkspaces.filter(
      (w) => w.path.replace(/\\/g, "/") === active,
    );
    set({ recentWorkspaces: recents });
    void store.set(KEY_RECENTS, recents);
  },
}));
