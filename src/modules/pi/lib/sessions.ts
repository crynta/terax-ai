export type PiSessionStatus = "idle" | "running" | "stopped" | "error";

export type PiSession = {
  id: string;
  title: string;
  cwd?: string | null;
  status: PiSessionStatus;
  createdAt: string;
  updatedAt: string;
  lastPrompt: string | null;
};

export type PiPromptContext = {
  workspaceRoot?: string | null;
  activeTerminalCwd?: string | null;
  activeFile?: string | null;
  activeTerminalPrivate?: boolean;
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
  events: PiSessionEvent[];
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

export type PiTranscriptItem = {
  id: string;
  kind: "assistant" | "error" | "system" | "user";
  label: string;
  text: string | null;
  eventIds: string[];
  createdAt: string;
  context?: PiPromptContext;
};

export const MAX_PI_PROMPT_CHARS = 20_000;

const DEFAULT_EVENT_LIMIT = 500;

function eventTimestamp(event: PiSessionEvent): number {
  const timestamp = Date.parse(event.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function eventSequence(event: PiSessionEvent): number | null {
  const restartSafeSequence = event.id.match(/^evt_[a-z0-9]+_(\d+)_/i)?.[1];
  if (restartSafeSequence) {
    const parsed = Number(restartSafeSequence);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const legacySequence = event.id.match(/^evt-(\d+)$/)?.[1];
  if (legacySequence) {
    const parsed = Number(legacySequence);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function comparePiSessionEventsAscending(
  left: PiSessionEvent,
  right: PiSessionEvent,
): number {
  const timestampOrder = eventTimestamp(left) - eventTimestamp(right);
  if (timestampOrder !== 0) return timestampOrder;

  const leftSequence = eventSequence(left);
  const rightSequence = eventSequence(right);
  if (leftSequence !== null && rightSequence !== null) {
    const sequenceOrder = leftSequence - rightSequence;
    if (sequenceOrder !== 0) return sequenceOrder;
  }

  return left.id.localeCompare(right.id);
}

function eventText(event: PiSessionEvent): string | null {
  return typeof event.payload.text === "string" ? event.payload.text : null;
}

function eventContext(event: PiSessionEvent): PiPromptContext | undefined {
  const context = event.payload.context;
  if (
    context === null ||
    typeof context !== "object" ||
    Array.isArray(context)
  ) {
    return undefined;
  }

  const raw = context as Record<string, unknown>;
  const next: PiPromptContext = {};
  if (typeof raw.workspaceRoot === "string") {
    next.workspaceRoot = raw.workspaceRoot;
  }
  if (typeof raw.activeTerminalCwd === "string") {
    next.activeTerminalCwd = raw.activeTerminalCwd;
  }
  if (typeof raw.activeFile === "string") {
    next.activeFile = raw.activeFile;
  }
  if (raw.activeTerminalPrivate === true) {
    next.activeTerminalPrivate = true;
  }

  return Object.keys(next).length === 0 ? undefined : next;
}

function isPiSessionStatus(value: unknown): value is PiSessionStatus {
  return (
    value === "idle" ||
    value === "running" ||
    value === "stopped" ||
    value === "error"
  );
}

function chronologicalEvents(events: PiSessionEvent[]): PiSessionEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const order = comparePiSessionEventsAscending(a.event, b.event);
      return order === 0 ? a.index - b.index : order;
    })
    .map(({ event }) => event);
}

function joinDeltaText(current: string | null, delta: string): string {
  if (current === null || current.length === 0) {
    return delta;
  }
  if (
    /^\s/.test(delta) ||
    /^[!%),.:;?\]}]/.test(delta) ||
    /[\s([{]$/.test(current)
  ) {
    return `${current}${delta}`;
  }
  return `${current} ${delta}`;
}

function createAssistantItem(
  event: PiSessionEvent,
  text: string,
): PiTranscriptItem {
  return {
    id: event.id,
    kind: "assistant",
    label: "Pi",
    text,
    eventIds: [event.id],
    createdAt: event.createdAt,
  };
}

function appendAssistantDelta(
  transcript: PiTranscriptItem[],
  event: PiSessionEvent,
): void {
  const text = eventText(event);
  if (text === null || text.length === 0) {
    return;
  }

  const previous = transcript[transcript.length - 1];
  if (previous?.kind === "assistant") {
    previous.text = joinDeltaText(previous.text, text);
    previous.eventIds.push(event.id);
    previous.createdAt = event.createdAt;
    return;
  }

  transcript.push(createAssistantItem(event, text));
}

function applyAssistantFinalText(
  transcript: PiTranscriptItem[],
  event: PiSessionEvent,
): void {
  const text = eventText(event);
  if (text === null) {
    return;
  }

  const previous = transcript[transcript.length - 1];
  if (previous?.kind === "assistant") {
    previous.text = text;
    previous.eventIds.push(event.id);
    previous.createdAt = event.createdAt;
    return;
  }

  transcript.push(createAssistantItem(event, text));
}

function transcriptItemForEvent(
  event: PiSessionEvent,
): PiTranscriptItem | null {
  switch (event.type) {
    case "session.created":
      return {
        id: event.id,
        kind: "system",
        label: "Created",
        text: null,
        eventIds: [event.id],
        createdAt: event.createdAt,
      };
    case "session.input":
      return {
        id: event.id,
        kind: "user",
        label: "Prompt",
        text: eventText(event),
        eventIds: [event.id],
        createdAt: event.createdAt,
        context: eventContext(event),
      };
    case "session.status":
      return {
        id: event.id,
        kind: "system",
        label: "Status",
        text:
          typeof event.payload.status === "string"
            ? event.payload.status
            : "updated",
        eventIds: [event.id],
        createdAt: event.createdAt,
      };
    case "session.error":
      return {
        id: event.id,
        kind: "error",
        label: "Error",
        text:
          typeof event.payload.message === "string"
            ? event.payload.message
            : "Unknown error",
        eventIds: [event.id],
        createdAt: event.createdAt,
      };
    default:
      return null;
  }
}

export function buildPiSessionTranscript(
  events: PiSessionEvent[],
): PiTranscriptItem[] {
  const transcript: PiTranscriptItem[] = [];
  for (const event of chronologicalEvents(events)) {
    if (event.type === "session.output.delta") {
      appendAssistantDelta(transcript, event);
      continue;
    }
    if (event.type === "session.output.text") {
      applyAssistantFinalText(transcript, event);
      continue;
    }

    const item = transcriptItemForEvent(event);
    if (item !== null) {
      transcript.push(item);
    }
  }
  return transcript;
}

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
  return sessions.map((session) => {
    let next = session;
    for (const event of chronologicalEvents(events)) {
      if (event.sessionId !== session.id) {
        continue;
      }
      if (
        event.type === "session.status" &&
        isPiSessionStatus(event.payload.status)
      ) {
        next = {
          ...next,
          status: event.payload.status,
          updatedAt: event.createdAt,
        };
      }
      if (event.type === "session.error") {
        next = { ...next, status: "error", updatedAt: event.createdAt };
      }
    }
    return next;
  });
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
