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
  /** presetId -> reason the server was given up on (crash loop, budget) */
  failed: Record<string, string>;
  upsertSession: (s: LspRuntimeSession) => void;
  removeSession: (key: string, presetId: string) => void;
  removeSessionQuiet: (key: string) => void;
  bumpGeneration: (presetId: string) => void;
  setFailed: (presetId: string, reason: string) => void;
  clearFailed: (presetId: string) => void;
  setDetected: (command: string, path: string | null) => void;
  clearDetected: (command: string) => void;
};

export const useLspRuntimeStore = create<State>((set) => ({
  sessions: {},
  detected: {},
  generations: {},
  failed: {},
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
  removeSessionQuiet: (key) =>
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[key];
      return { sessions };
    }),
  bumpGeneration: (presetId) =>
    set((state) => ({
      generations: {
        ...state.generations,
        [presetId]: (state.generations[presetId] ?? 0) + 1,
      },
    })),
  setFailed: (presetId, reason) =>
    set((state) => ({ failed: { ...state.failed, [presetId]: reason } })),
  clearFailed: (presetId) =>
    set((state) => {
      if (!(presetId in state.failed)) return state;
      const failed = { ...state.failed };
      delete failed[presetId];
      return { failed };
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
