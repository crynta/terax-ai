import { create } from "zustand";
import { useManagedAgentsStore } from "./managedAgentsStore";
import type {
  AgentNotification,
  AgentSession,
  AgentStatus,
  LocalAgentState,
} from "../lib/types";

const MAX_NOTIFICATIONS = 50;

let notifSeq = 0;

type AgentStoreState = {
  sessions: Record<number, AgentSession>;
  localAgent: LocalAgentState;
  notifications: AgentNotification[];
  start: (leafId: number, tabId: number, agent: string) => void;
  setStatus: (leafId: number, status: AgentStatus) => void;
  finish: (leafId: number) => void;
  moveLeafToTab: (leafId: number, tabId: number) => void;
  setLocalAgent: (state: LocalAgentState) => void;
  pushNotification: (
    n: Omit<AgentNotification, "id" | "at" | "read">,
  ) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
};

export const useAgentStore = create<AgentStoreState>((set) => ({
  sessions: {},
  localAgent: null,
  notifications: [],

  start: (leafId, tabId, agent) =>
    set((s) => {
      const now = Date.now();
      return {
        sessions: {
          ...s.sessions,
          [leafId]: {
            leafId,
            tabId,
            agent,
            status: "working",
            startedAt: now,
            lastActivityAt: now,
            attentionSince: null,
          },
        },
      };
    }),

  setStatus: (leafId, status) =>
    set((s) => {
      const prev = s.sessions[leafId];
      if (!prev || prev.status === status) return s;
      const now = Date.now();
      return {
        sessions: {
          ...s.sessions,
          [leafId]: {
            ...prev,
            status,
            lastActivityAt: now,
            attentionSince: status === "waiting" ? now : null,
          },
        },
      };
    }),

  finish: (leafId) =>
    set((s) => {
      if (!s.sessions[leafId]) return s;
      const next = { ...s.sessions };
      delete next[leafId];
      return { sessions: next };
    }),

  moveLeafToTab: (leafId, tabId) =>
    set((s) => {
      const session = s.sessions[leafId];
      const moveSession = session !== undefined && session.tabId !== tabId;
      const moveNotifications = s.notifications.some(
        (n) => n.leafId === leafId && n.tabId !== tabId,
      );
      if (!moveSession && !moveNotifications) return s;
      return {
        ...(moveSession && {
          sessions: { ...s.sessions, [leafId]: { ...session, tabId } },
        }),
        ...(moveNotifications && {
          notifications: s.notifications.map((n) =>
            n.leafId === leafId ? { ...n, tabId } : n,
          ),
        }),
      };
    }),

  setLocalAgent: (state) =>
    set((s) => {
      const a = s.localAgent;
      if (a === state) return s;
      if (a && state && a.status === state.status && a.agent === state.agent) {
        return s;
      }
      return { localAgent: state };
    }),

  pushNotification: (n) =>
    set((s) => ({
      notifications: [
        { ...n, id: `n${++notifSeq}`, at: Date.now(), read: false },
        ...s.notifications,
      ].slice(0, MAX_NOTIFICATIONS),
    })),

  markAllRead: () =>
    set((s) => {
      if (!s.notifications.some((n) => !n.read)) return s;
      return { notifications: s.notifications.map((n) => ({ ...n, read: true })) };
    }),

  clearNotifications: () => set({ notifications: [] }),
}));

/** The tab/leaf of the agent that most recently entered the waiting state, for
 *  the keyboard jump-to-attention shortcut. Null when none is waiting. */
export function nextAttentionTarget(): { tabId: number; leafId: number } | null {
  const waiting = Object.values(useAgentStore.getState().sessions)
    .filter((s) => s.status === "waiting")
    .sort((a, b) => (b.attentionSince ?? 0) - (a.attentionSince ?? 0));
  const t = waiting[0];
  return t ? { tabId: t.tabId, leafId: t.leafId } : null;
}

/** Points every agent record for `leafId` at the tab now hosting that pane. */
export function moveAgentLeafToTab(leafId: number, tabId: number): void {
  useAgentStore.getState().moveLeafToTab(leafId, tabId);
  useManagedAgentsStore.getState().moveLeafToTab(leafId, tabId);
}
