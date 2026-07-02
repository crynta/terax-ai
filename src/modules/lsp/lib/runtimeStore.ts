import { create } from "zustand";

export type LspSessionStatus = "starting" | "running" | "error";

export type LspRuntimeSession = {
  key: string;
  presetId: string;
  root: string;
  status: LspSessionStatus;
};

type State = {
  sessions: Record<string, LspRuntimeSession>;
  /** command -> absolute path, null when not found, absent while unknown */
  detected: Record<string, string | null>;
  /** per-preset counter bumped on session teardown so open docs re-acquire */
  generations: Record<string, number>;
  upsertSession: (s: LspRuntimeSession) => void;
  removeSession: (key: string, presetId: string) => void;
  setDetected: (command: string, path: string | null) => void;
  clearDetected: (command: string) => void;
};

export const useLspRuntimeStore = create<State>((set) => ({
  sessions: {},
  detected: {},
  generations: {},
  upsertSession: (s) =>
    set((state) => ({ sessions: { ...state.sessions, [s.key]: s } })),
  removeSession: (key, presetId) =>
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[key];
      return {
        sessions,
        generations: {
          ...state.generations,
          [presetId]: (state.generations[presetId] ?? 0) + 1,
        },
      };
    }),
  setDetected: (command, path) =>
    set((state) => ({ detected: { ...state.detected, [command]: path } })),
  clearDetected: (command) =>
    set((state) => {
      const detected = { ...state.detected };
      delete detected[command];
      return { detected };
    }),
}));
