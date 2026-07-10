import { create } from "zustand";

export type DiagnosticCounts = { errors: number; warnings: number };

type State = {
  byPath: Record<string, DiagnosticCounts>;
  report: (path: string, counts: DiagnosticCounts | null) => void;
};

export const useDiagnosticsStore = create<State>((set) => ({
  byPath: {},
  report: (path, counts) =>
    set((s) => {
      const prev = s.byPath[path];
      if (
        counts &&
        prev &&
        prev.errors === counts.errors &&
        prev.warnings === counts.warnings
      ) {
        return s;
      }
      if (!counts && !prev) return s;
      const byPath = { ...s.byPath };
      if (counts) byPath[path] = counts;
      else delete byPath[path];
      return { byPath };
    }),
}));
