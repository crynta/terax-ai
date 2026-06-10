import { isPiThinkingLevel } from "@/modules/pi/lib/provider";
import type {
  PiPromptContext,
  PiSession,
  PiSessionBranch,
  PiSessionEvent,
  PiSessionStatus,
  PiToolOutput,
} from "./types";

export const DEFAULT_EVENT_LIMIT = 500;

let piEventSequenceCounter = 0;

/**
 * Generate a webview event id that embeds a monotonic sequence the
 * {@link eventSequence} parser understands (`evt_<base36 time>_<seq>_<rand>`).
 * Random UUIDs carry no sequence, so events emitted in the same millisecond
 * would otherwise sort by random id comparison — non-deterministic, and a source
 * of corrupted transcript reconstruction. The sequence makes intra-turn ordering
 * deterministic and emission-ordered.
 */
export function nextPiEventId(): string {
  piEventSequenceCounter += 1;
  const time = Date.now().toString(36);
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `evt_${time}_${piEventSequenceCounter}_${rand}`;
}

export function eventTimestamp(event: PiSessionEvent): number {
  const timestamp = Date.parse(event.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function eventSequence(event: PiSessionEvent): number | null {
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

export function comparePiSessionEventsAscending(
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

export function eventText(event: PiSessionEvent): string | null {
  return typeof event.payload.text === "string" ? event.payload.text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function eventContext(
  event: PiSessionEvent,
): PiPromptContext | undefined {
  const raw = event.payload.context;
  if (!isRecord(raw)) {
    return undefined;
  }

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

export function eventBranch(
  event: PiSessionEvent,
): PiSessionBranch | undefined {
  const raw = event.payload.branch;
  if (!isRecord(raw)) {
    return undefined;
  }

  if (typeof raw.groupId !== "string" || raw.groupId.trim() === "") {
    return undefined;
  }
  if (
    typeof raw.index !== "number" ||
    !Number.isInteger(raw.index) ||
    raw.index < 0
  ) {
    return undefined;
  }

  return {
    groupId: raw.groupId,
    index: raw.index,
    regeneratedFromEventId:
      typeof raw.regeneratedFromEventId === "string"
        ? raw.regeneratedFromEventId
        : undefined,
  };
}

export function eventToolCallId(event: PiSessionEvent): string | null {
  return typeof event.payload.toolCallId === "string"
    ? event.payload.toolCallId
    : null;
}

export function eventToolName(event: PiSessionEvent): string | null {
  return typeof event.payload.toolName === "string"
    ? event.payload.toolName
    : null;
}

export function eventToolOutput(
  event: PiSessionEvent,
): PiToolOutput | undefined {
  const raw = event.payload.output;
  if (!isRecord(raw)) {
    return undefined;
  }
  return {
    content: typeof raw.content === "string" ? raw.content : "",
    details: raw.details ?? null,
  };
}

export function isPiSessionStatus(value: unknown): value is PiSessionStatus {
  return (
    value === "idle" ||
    value === "running" ||
    value === "stopped" ||
    value === "error"
  );
}

export function eventSessionSnapshot(event: PiSessionEvent): PiSession | null {
  const candidate = event.payload.session;
  if (!isRecord(candidate)) {
    return null;
  }

  if (
    candidate.id !== event.sessionId ||
    typeof candidate.title !== "string" ||
    !isPiSessionStatus(candidate.status) ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    !(typeof candidate.lastPrompt === "string" || candidate.lastPrompt === null)
  ) {
    return null;
  }

  const cwd = candidate.cwd;
  const thinkingLevel = candidate.thinkingLevel;
  const sdkSessionFile = candidate.sdkSessionFile;
  return {
    id: candidate.id,
    title: candidate.title,
    status: candidate.status,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    lastPrompt: candidate.lastPrompt,
    ...(typeof cwd === "string" || cwd === null ? { cwd } : {}),
    ...(thinkingLevel === null || isPiThinkingLevel(thinkingLevel)
      ? { thinkingLevel }
      : {}),
    ...(typeof sdkSessionFile === "string" || sdkSessionFile === null
      ? { sdkSessionFile }
      : {}),
  };
}

export function chronologicalEvents(
  events: PiSessionEvent[],
): PiSessionEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const order = comparePiSessionEventsAscending(a.event, b.event);
      return order === 0 ? a.index - b.index : order;
    })
    .map(({ event }) => event);
}

export function joinDeltaText(current: string | null, delta: string): string {
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
