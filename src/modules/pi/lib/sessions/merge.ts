import {
  chronologicalEvents,
  comparePiSessionEventsAscending,
  DEFAULT_EVENT_LIMIT,
  eventSessionSnapshot,
  isPiSessionStatus,
} from "./events";
import {
  PI_SESSION_EVENT,
  type PiSession,
  type PiSessionEvent,
  type PiSessionStatus,
} from "./types";

export function mergePiSessionEvents(
  current: PiSessionEvent[],
  incoming: PiSessionEvent[],
  limit = DEFAULT_EVENT_LIMIT,
): PiSessionEvent[] {
  if (limit <= 0) {
    return [];
  }

  const byId = new Map<string, PiSessionEvent>();
  for (const event of current) {
    byId.set(event.id, event);
  }
  for (const event of incoming) {
    byId.set(event.id, event);
  }

  return Array.from(byId.values())
    .sort((a, b) => comparePiSessionEventsAscending(b, a))
    .slice(0, limit);
}

export function isPiSessionSendable(
  session: PiSession | null | undefined,
): boolean {
  return session?.status === "idle" || session?.status === "error";
}

export function markPiSessionsStopped(sessions: PiSession[]): PiSession[] {
  return sessions.map((session) =>
    session.status === "stopped" ? session : { ...session, status: "stopped" },
  );
}

export function mergePiSessionSnapshots(
  current: PiSession[],
  live: PiSession[],
  options: { missingStatus?: PiSessionStatus } = {},
): PiSession[] {
  const liveIds = new Set(live.map((session) => session.id));
  const historyOnly = current
    .filter((session) => !liveIds.has(session.id))
    .map((session) =>
      options.missingStatus === undefined
        ? session
        : { ...session, status: options.missingStatus },
    );
  return [...live, ...historyOnly];
}

export function applyPiSessionEvents(
  sessions: PiSession[],
  events: PiSessionEvent[],
): PiSession[] {
  const byId = new Map<string, PiSession>();
  for (const session of sessions) {
    byId.set(session.id, session);
  }

  for (const event of chronologicalEvents(events)) {
    if (event.type === PI_SESSION_EVENT.Deleted) {
      byId.delete(event.sessionId);
      continue;
    }

    if (event.type === PI_SESSION_EVENT.Created) {
      const created = eventSessionSnapshot(event);
      if (created && !byId.has(created.id)) {
        byId.set(created.id, created);
      }
    }

    if (event.type === PI_SESSION_EVENT.Resumed) {
      const resumed = eventSessionSnapshot(event);
      if (resumed) {
        byId.set(resumed.id, resumed);
      }
    }

    const session = byId.get(event.sessionId);
    if (!session) {
      continue;
    }

    if (
      event.type === PI_SESSION_EVENT.Status &&
      isPiSessionStatus(event.payload.status)
    ) {
      byId.set(event.sessionId, {
        ...session,
        status: event.payload.status,
        updatedAt: event.createdAt,
      });
      continue;
    }

    if (event.type === PI_SESSION_EVENT.Renamed) {
      const title = event.payload.title;
      if (typeof title === "string" && title.trim() !== "") {
        byId.set(event.sessionId, {
          ...session,
          title: title.trim(),
          updatedAt: event.createdAt,
        });
      }
      continue;
    }

    if (event.type === PI_SESSION_EVENT.Error) {
      byId.set(event.sessionId, {
        ...session,
        status: "error",
        updatedAt: event.createdAt,
      });
    }
  }

  return Array.from(byId.values());
}

export function upsertPiSession(
  sessions: PiSession[],
  nextSession: PiSession,
): PiSession[] {
  const index = sessions.findIndex((session) => session.id === nextSession.id);
  if (index === -1) {
    return [nextSession, ...sessions];
  }

  const next = [...sessions];
  next[index] = nextSession;
  return next;
}
