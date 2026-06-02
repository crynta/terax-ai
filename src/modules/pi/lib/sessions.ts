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
};

const DEFAULT_EVENT_LIMIT = 500;

function eventSortKey(event: PiSessionEvent): number {
  const numericId = Number(event.id.match(/\d+$/)?.[0]);
  if (Number.isFinite(numericId)) {
    return numericId;
  }
  const timestamp = Date.parse(event.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function eventText(event: PiSessionEvent): string | null {
  return typeof event.payload.text === "string" ? event.payload.text : null;
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
      const order = eventSortKey(a.event) - eventSortKey(b.event);
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
  if (text === null) {
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
    .sort((a, b) => eventSortKey(b) - eventSortKey(a))
    .slice(0, limit);
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
