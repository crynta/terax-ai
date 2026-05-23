import { create } from "zustand";

const STORAGE_KEY = "terax.recent-files";
const MAX_ENTRIES = 50;

function readFromStorage(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function writeToStorage(paths: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // localStorage can throw in private mode or when quota is exhausted.
  }
}

type State = {
  paths: string[];
  push: (path: string) => void;
  clear: () => void;
};

export const useRecentFilesStore = create<State>((set) => ({
  paths: typeof window !== "undefined" ? readFromStorage() : [],
  push: (path) =>
    set((s) => {
      const without = s.paths.filter((p) => p !== path);
      const next = [path, ...without].slice(0, MAX_ENTRIES);
      writeToStorage(next);
      return { paths: next };
    }),
  clear: () =>
    set(() => {
      writeToStorage([]);
      return { paths: [] };
    }),
}));
