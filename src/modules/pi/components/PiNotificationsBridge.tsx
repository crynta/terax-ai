import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { routeAgentNotification } from "@/modules/agents/lib/route";
import { useWindowFocus } from "@/modules/agents/lib/useWindowFocus";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import type {
  PiSessionEvent,
  PiSessionStatus,
} from "@/modules/pi/lib/sessions";
import {
  buildPiAgentSessionStateForEvent,
  buildPiNotificationForEvent,
} from "@/modules/pi/lib/notifications";

const MAX_NOTIFIED_EVENT_IDS = 1000;

type PiSessionNotificationMeta = {
  cwd: string | null;
  lastPrompt: string | null;
  status: PiSessionStatus | null;
  title: string | null;
};

type Props = {
  visible: boolean;
  onActivateSession: (sessionId: string) => void;
};

type PiNotificationRoute = Parameters<typeof routeAgentNotification>[0];

type PiNotificationProcessorState = {
  notifiedEventIds: Set<string>;
  sessions: Map<string, PiSessionNotificationMeta>;
};

export function createPiNotificationProcessorState(): PiNotificationProcessorState {
  return {
    notifiedEventIds: new Set<string>(),
    sessions: new Map<string, PiSessionNotificationMeta>(),
  };
}

function payloadString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function payloadSessionString(
  event: PiSessionEvent,
  key: string,
): string | null {
  const session = event.payload.session;
  if (
    session === null ||
    typeof session !== "object" ||
    Array.isArray(session)
  ) {
    return null;
  }
  return payloadString(session as Record<string, unknown>, key);
}

function payloadStatus(event: PiSessionEvent): PiSessionStatus | null {
  const status = payloadString(event.payload, "status");
  return status === "idle" ||
    status === "running" ||
    status === "stopped" ||
    status === "error"
    ? status
    : null;
}

function rememberNotifiedEventId(ids: Set<string>, id: string): void {
  ids.add(id);
  if (ids.size <= MAX_NOTIFIED_EVENT_IDS) return;
  const oldest = ids.values().next().value;
  if (typeof oldest === "string") ids.delete(oldest);
}

function nextMeta(
  current: PiSessionNotificationMeta,
  event: PiSessionEvent,
): PiSessionNotificationMeta {
  if (event.type === "session.created") {
    return {
      ...current,
      cwd: payloadSessionString(event, "cwd") ?? current.cwd,
      title: payloadSessionString(event, "title") ?? current.title,
    };
  }

  if (event.type === "session.input") {
    return {
      ...current,
      lastPrompt: payloadString(event.payload, "text") ?? current.lastPrompt,
    };
  }

  const status = payloadStatus(event);
  if (status !== null) {
    return { ...current, status };
  }

  if (event.type === "session.error") {
    return { ...current, status: "error" };
  }

  return current;
}

export function processPiNotificationEvent(input: {
  event: PiSessionEvent;
  focused: boolean;
  onActivateSession: (sessionId: string) => void;
  removePiSession: (sessionId: string) => void;
  routeNotification: (route: PiNotificationRoute) => void;
  setPiSession: (state: NonNullable<ReturnType<typeof buildPiAgentSessionStateForEvent>>) => void;
  state: PiNotificationProcessorState;
  visible: boolean;
}): void {
  const { event, state } = input;
  if (state.notifiedEventIds.has(event.id)) return;

  const current = state.sessions.get(event.sessionId) ?? {
    cwd: null,
    lastPrompt: null,
    status: null,
    title: null,
  };
  const next = nextMeta(current, event);
  const context = {
    cwd: next.cwd,
    lastPrompt: next.lastPrompt,
    previousStatus: current.status,
    title: next.title,
  };
  const notification = buildPiNotificationForEvent(event, context);
  const activity = buildPiAgentSessionStateForEvent(event, context);

  if (event.type === "session.deleted") {
    state.sessions.delete(event.sessionId);
    input.removePiSession(event.sessionId);
  } else {
    state.sessions.set(event.sessionId, next);
    if (activity) input.setPiSession(activity);
  }

  if (!notification) return;
  rememberNotifiedEventId(state.notifiedEventIds, event.id);

  input.routeNotification({
    agent: "Pi",
    allowToast: notification.kind === "error",
    body: notification.body,
    focused: input.focused,
    kind: notification.kind,
    leafId: 0,
    onActivate: () => input.onActivateSession(notification.sessionId),
    piSessionId: notification.sessionId,
    source: "pi",
    tabId: 0,
    title: notification.title,
    visible: input.visible,
  });
}

export function PiNotificationsBridge({ visible, onActivateSession }: Props) {
  const focused = useWindowFocus();
  const contextRef = useRef({ focused, onActivateSession, visible });
  const processorStateRef = useRef(createPiNotificationProcessorState());

  contextRef.current = { focused, onActivateSession, visible };

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;

    listen<PiSessionEvent>("pi:session-event", ({ payload: event }) => {
      const { focused, onActivateSession, visible } = contextRef.current;
      const store = useAgentStore.getState();
      processPiNotificationEvent({
        event,
        focused,
        onActivateSession,
        removePiSession: store.removePiSession,
        routeNotification: routeAgentNotification,
        setPiSession: store.setPiSession,
        state: processorStateRef.current,
        visible,
      });
    })
      .then((nextUnlisten) => {
        if (alive) {
          unlisten = nextUnlisten;
        } else {
          nextUnlisten();
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return null;
}
