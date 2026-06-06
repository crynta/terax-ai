import { create } from "zustand";
import type {
  AgentNotification,
  AgentNotificationCategory,
  AgentSession,
  AgentStatus,
  LocalAgentState,
  PiAgentSessionState,
} from "../lib/types";

const MAX_NOTIFICATIONS = 50;

let notifSeq = 0;

type AgentStoreState = {
  sessions: Record<number, AgentSession>;
  localAgent: LocalAgentState;
  piSessions: Record<string, PiAgentSessionState>;
  notifications: AgentNotification[];
  start: (leafId: number, tabId: number, agent: string) => void;
  setStatus: (leafId: number, status: AgentStatus) => void;
  finish: (leafId: number) => void;
  setLocalAgent: (state: LocalAgentState) => void;
  setPiSession: (state: PiAgentSessionState) => void;
  removePiSession: (sessionId: string) => void;
  pushNotification: (n: Omit<AgentNotification, "id" | "at" | "read">) => void;
  markAllRead: () => void;
  markNotificationsRead: (ids: readonly string[]) => void;
  markPiNotificationsRead: (category: AgentNotificationCategory) => void;
  markSourceRead: (source: AgentNotification["source"]) => void;
  removeNotification: (id: string) => void;
  clearReadNotifications: () => void;
  clearNotifications: () => void;
};

export const useAgentStore = create<AgentStoreState>((set) => ({
  sessions: {},
  localAgent: null,
  piSessions: {},
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

  setLocalAgent: (state) =>
    set((s) => {
      const a = s.localAgent;
      if (a === state) return s;
      if (a && state && a.status === state.status && a.agent === state.agent) {
        return s;
      }
      if (!state) return { localAgent: null };

      const now = Date.now();
      return {
        localAgent: {
          ...state,
          attentionSince:
            state.attentionSince ?? (state.status === "waiting" ? now : null),
          lastActivityAt: state.lastActivityAt ?? now,
          startedAt: state.startedAt ?? a?.startedAt ?? now,
        },
      };
    }),

  setPiSession: (state) =>
    set((s) => {
      const prev = s.piSessions[state.sessionId];
      if (
        prev &&
        prev.status === state.status &&
        prev.title === state.title &&
        prev.body === state.body &&
        prev.cwd === state.cwd &&
        prev.lastActivityAt === state.lastActivityAt
      ) {
        return s;
      }
      return {
        piSessions: {
          ...s.piSessions,
          [state.sessionId]: state,
        },
      };
    }),

  removePiSession: (sessionId) =>
    set((s) => {
      if (!s.piSessions[sessionId]) return s;
      const next = { ...s.piSessions };
      delete next[sessionId];
      return { piSessions: next };
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
      return {
        notifications: s.notifications.map((n) => ({ ...n, read: true })),
      };
    }),

  markNotificationsRead: (ids) =>
    set((s) => {
      const unreadIds = new Set(ids);
      if (
        unreadIds.size === 0 ||
        !s.notifications.some((n) => unreadIds.has(n.id) && !n.read)
      ) {
        return s;
      }
      return {
        notifications: s.notifications.map((n) =>
          unreadIds.has(n.id) ? { ...n, read: true } : n,
        ),
      };
    }),

  markPiNotificationsRead: (category) =>
    set((s) => {
      if (
        !s.notifications.some(
          (n) => n.source === "pi" && n.category === category && !n.read,
        )
      ) {
        return s;
      }
      return {
        notifications: s.notifications.map((n) =>
          n.source === "pi" && n.category === category
            ? { ...n, read: true }
            : n,
        ),
      };
    }),

  markSourceRead: (source) =>
    set((s) => {
      if (!s.notifications.some((n) => n.source === source && !n.read))
        return s;
      return {
        notifications: s.notifications.map((n) =>
          n.source === source ? { ...n, read: true } : n,
        ),
      };
    }),

  removeNotification: (id) =>
    set((s) => {
      const notifications = s.notifications.filter(
        (notification) => notification.id !== id,
      );
      return notifications.length === s.notifications.length
        ? s
        : { notifications };
    }),

  clearReadNotifications: () =>
    set((s) => {
      const notifications = s.notifications.filter((n) => !n.read);
      return notifications.length === s.notifications.length
        ? s
        : { notifications };
    }),

  clearNotifications: () =>
    set((s) => (s.notifications.length === 0 ? s : { notifications: [] })),
}));
