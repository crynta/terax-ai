import { create } from "zustand";
import { uriToPath } from "./protocol";

export type FileDiagnosticCounts = {
  errors: number;
  warnings: number;
};

type DiagnosticItem = { severity?: number };

export function normFilePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function countDiagnostics(items: DiagnosticItem[]): FileDiagnosticCounts {
  let errors = 0;
  let warnings = 0;
  for (const item of items) {
    if (item.severity === 1) errors += 1;
    else if (item.severity === 2) warnings += 1;
  }
  return { errors, warnings };
}

type LspDiagnosticStore = {
  byPath: Record<string, FileDiagnosticCounts>;
  setForPath: (path: string, items: DiagnosticItem[]) => void;
  clearPath: (path: string) => void;
};

export const useLspDiagnosticStore = create<LspDiagnosticStore>((set) => ({
  byPath: {},
  setForPath: (path, items) => {
    const key = normFilePath(path);
    const counts = countDiagnostics(items);
    set((state) => {
      const next = { ...state.byPath };
      if (counts.errors === 0 && counts.warnings === 0) {
        delete next[key];
      } else {
        next[key] = counts;
      }
      return { byPath: next };
    });
  },
  clearPath: (path) => {
    const key = normFilePath(path);
    set((state) => {
      if (!(key in state.byPath)) return state;
      const next = { ...state.byPath };
      delete next[key];
      return { byPath: next };
    });
  },
}));

export function setFileDiagnostics(
  pathOrUri: string,
  items: DiagnosticItem[],
): void {
  const path = pathOrUri.startsWith("file://")
    ? uriToPath(pathOrUri)
    : pathOrUri;
  useLspDiagnosticStore.getState().setForPath(path, items);
}

export function useFileDiagnosticCounts(
  path: string,
): FileDiagnosticCounts | null {
  const key = normFilePath(path);
  return useLspDiagnosticStore((s) => s.byPath[key] ?? null);
}

export function formatDiagnosticCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
