import { create } from "zustand";

export const DEFAULT_MAX_ROUNDS = 3;

export type ManagedPhase = "spawning" | "working" | "reviewing" | "done";

export type ManagedAgent = {
  leafId: number;
  tabId: number;
  sessionId: string;
  task: string;
  cwd: string | null;
  rounds: number;
  maxRounds: number;
  phase: ManagedPhase;
  reviewedAtRound: number;
  pendingReview: boolean;
};

type ManagedAgentsState = {
  agents: Record<number, ManagedAgent>;
  register: (a: {
    leafId: number;
    tabId: number;
    sessionId: string;
    task: string;
    cwd: string | null;
    maxRounds?: number;
  }) => void;
  setPhase: (leafId: number, phase: ManagedPhase) => void;
  markReviewed: (leafId: number) => void;
  setPendingReview: (leafId: number, pending: boolean) => void;
  bumpRound: (leafId: number) => void;
  remove: (leafId: number) => void;
  get: (leafId: number) => ManagedAgent | undefined;
  getBySessionId: (sessionId: string) => ManagedAgent | undefined;
};

export const useManagedAgentsStore = create<ManagedAgentsState>((set, get) => ({
  agents: {},

  register: ({ leafId, tabId, sessionId, task, cwd, maxRounds }) =>
    set((s) => ({
      agents: {
        ...s.agents,
        [leafId]: {
          leafId,
          tabId,
          sessionId,
          task,
          cwd,
          rounds: 0,
          maxRounds: maxRounds ?? DEFAULT_MAX_ROUNDS,
          phase: "spawning",
          reviewedAtRound: -1,
          pendingReview: false,
        },
      },
    })),

  setPhase: (leafId, phase) =>
    set((s) => {
      const a = s.agents[leafId];
      if (!a || a.phase === phase) return s;
      return { agents: { ...s.agents, [leafId]: { ...a, phase } } };
    }),

  markReviewed: (leafId) =>
    set((s) => {
      const a = s.agents[leafId];
      if (!a) return s;
      return {
        agents: {
          ...s.agents,
          [leafId]: { ...a, reviewedAtRound: a.rounds, pendingReview: false },
        },
      };
    }),

  setPendingReview: (leafId, pending) =>
    set((s) => {
      const a = s.agents[leafId];
      if (!a || a.pendingReview === pending) return s;
      return {
        agents: { ...s.agents, [leafId]: { ...a, pendingReview: pending } },
      };
    }),

  bumpRound: (leafId) =>
    set((s) => {
      const a = s.agents[leafId];
      if (!a) return s;
      return {
        agents: {
          ...s.agents,
          [leafId]: { ...a, rounds: a.rounds + 1, phase: "working" },
        },
      };
    }),

  remove: (leafId) =>
    set((s) => {
      if (!s.agents[leafId]) return s;
      const next = { ...s.agents };
      delete next[leafId];
      return { agents: next };
    }),

  get: (leafId) => get().agents[leafId],

  getBySessionId: (sessionId) =>
    Object.values(get().agents).find((a) => a.sessionId === sessionId),
}));
