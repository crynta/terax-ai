export type PiSessionStatus = "idle" | "running" | "stopped" | "error";

export type PiSession = {
  id: string;
  title: string;
  status: PiSessionStatus;
  createdAt: string;
  updatedAt: string;
  lastPrompt: string | null;
};

export type PiSessionEvent = {
  id: string;
  type: string;
  sessionId: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type PiSessionsList = {
  sessions: PiSession[];
};

export type PiSessionCreateResult = {
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionSendResult = {
  accepted: boolean;
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionStopResult = {
  session: PiSession;
  events: PiSessionEvent[];
};

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
