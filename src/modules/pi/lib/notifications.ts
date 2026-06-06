import type {
  NotificationKind,
  PiAgentSessionState,
} from "@/modules/agents/lib/types";
import type { PiSessionEvent, PiSessionStatus } from "./sessions";

const NOTIFICATION_BODY_LIMIT = 80;

export type PiEventNotification = {
  body?: string;
  kind: Extract<NotificationKind, "finished" | "error">;
  sessionId: string;
  title: string;
};

export type PiNotificationContext = {
  cwd?: string | null;
  lastPrompt?: string | null;
  previousStatus?: PiSessionStatus | null;
  title?: string | null;
};

function stringPayload(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function truncateNotificationBody(
  value: string | null | undefined,
): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > NOTIFICATION_BODY_LIMIT
    ? `${text.slice(0, NOTIFICATION_BODY_LIMIT).trimEnd()}…`
    : text;
}

function eventTimestamp(event: PiSessionEvent): number {
  const parsed = Date.parse(event.createdAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function buildPiAgentSessionStateForEvent(
  event: PiSessionEvent,
  context: PiNotificationContext,
): PiAgentSessionState | null {
  const payloadTitle = stringPayload(event.payload, "title");
  const title = payloadTitle ?? context.title ?? "Pi session";
  const body = truncateNotificationBody(context.lastPrompt ?? title);
  const base = {
    ...(body ? { body } : {}),
    ...(context.cwd ? { cwd: context.cwd } : {}),
    lastActivityAt: eventTimestamp(event),
    sessionId: event.sessionId,
    title,
  };

  if (event.type === "session.input") {
    return { ...base, status: "working" };
  }

  if (event.type === "session.error") {
    return {
      ...base,
      body:
        truncateNotificationBody(stringPayload(event.payload, "message")) ??
        body,
      status: "error",
    };
  }

  if (event.type !== "session.status") return null;

  const status = stringPayload(event.payload, "status");
  if (status === "running") return { ...base, status: "working" };
  if (status === "error") return { ...base, status: "error" };
  if (status === "stopped") return { ...base, status: "idle" };
  if (status === "idle" && context.previousStatus === "running") {
    return { ...base, status: "finished" };
  }

  return null;
}

export function buildPiNotificationForEvent(
  event: PiSessionEvent,
  context: PiNotificationContext,
): PiEventNotification | null {
  if (event.type === "session.error") {
    return {
      body: truncateNotificationBody(stringPayload(event.payload, "message")),
      kind: "error",
      sessionId: event.sessionId,
      title: "Pi run failed",
    };
  }

  if (event.type !== "session.status") return null;

  const status = stringPayload(event.payload, "status");
  if (status !== "idle" || context.previousStatus !== "running") {
    return null;
  }

  return {
    body: truncateNotificationBody(context.lastPrompt ?? context.title),
    kind: "finished",
    sessionId: event.sessionId,
    title: "Pi response ready",
  };
}
