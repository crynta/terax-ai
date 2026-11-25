import { create } from "zustand";

export type CursorPosition = { line: number; col: number };

type State = {
  byPath: Record<string, CursorPosition>;
  report: (path: string, position: CursorPosition | null) => void;
};

export const useCursorStore = create<State>((set) => ({
  byPath: {},
  report: (path, position) =>
    set((s) => {
      const prev = s.byPath[path];
      if (
        position &&
        prev &&
        prev.line === position.line &&
        prev.col === position.col
      ) {
        return s;
      }
      if (!position && !prev) return s;
      const byPath = { ...s.byPath };
      if (position) byPath[path] = position;
      else delete byPath[path];
      return { byPath };
    }),
}));
