import { listen } from "@tauri-apps/api/event";
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { PiSession, PiSessionBranch, PiSessionEvent } from "./sessions";
import {
  annotatePiSessionEventBranch,
  applyPiSessionEvents,
  isKnownPiSessionEvent,
  mergePiSessionEvents,
  PI_SESSION_EVENT,
  upsertPiSession,
} from "./sessions";

type UsePiSessionEventStreamOptions = {
  activeRegenerateBranchesRef: MutableRefObject<Map<string, PiSessionBranch>>;
  refreshDiagnostics: () => Promise<void> | void;
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setSessionEvents: Dispatch<SetStateAction<PiSessionEvent[]>>;
  setSessions: Dispatch<SetStateAction<PiSession[]>>;
};

export function usePiSessionEventStream({
  activeRegenerateBranchesRef,
  refreshDiagnostics,
  setSelectedSessionId,
  setSessionEvents,
  setSessions,
}: UsePiSessionEventStreamOptions) {
  const auditRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const applySessionEvents = useCallback(
    (events: PiSessionEvent[]) => {
      if (events.length === 0) {
        return;
      }

      const annotatedEvents = events.map((event) => {
        const branch = activeRegenerateBranchesRef.current.get(event.sessionId);
        const nextEvent = branch
          ? annotatePiSessionEventBranch(event, branch)
          : event;
        if (eventCompletesRegenerateBranch(event)) {
          activeRegenerateBranchesRef.current.delete(event.sessionId);
        }
        return nextEvent;
      });

      setSessionEvents((current) =>
        mergePiSessionEvents(current, annotatedEvents),
      );
      setSessions((current) => applyPiSessionEvents(current, annotatedEvents));
    },
    [activeRegenerateBranchesRef, setSessionEvents, setSessions],
  );

  const applySessionUpdate = useCallback(
    (session: PiSession, events: PiSessionEvent[]) => {
      setSessions((current) => upsertPiSession(current, session));
      applySessionEvents(events);
      setSelectedSessionId(session.id);
    },
    [applySessionEvents, setSelectedSessionId, setSessions],
  );

  const scheduleCapabilityAuditRefresh = useCallback(() => {
    if (auditRefreshTimerRef.current) {
      clearTimeout(auditRefreshTimerRef.current);
    }
    auditRefreshTimerRef.current = setTimeout(() => {
      auditRefreshTimerRef.current = null;
      void refreshDiagnostics();
    }, 0);
  }, [refreshDiagnostics]);

  useEffect(
    () => () => {
      if (auditRefreshTimerRef.current) {
        clearTimeout(auditRefreshTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<PiSessionEvent>("pi:session-event", (event) => {
      applySessionEvents([event.payload]);
      if (eventShouldRefreshCapabilityAudit(event.payload)) {
        scheduleCapabilityAuditRefresh();
      }
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
  }, [applySessionEvents, scheduleCapabilityAuditRefresh]);

  return { applySessionEvents, applySessionUpdate };
}

function eventShouldRefreshCapabilityAudit(event: PiSessionEvent): boolean {
  return (
    event.type === PI_SESSION_EVENT.ToolResult ||
    event.type === PI_SESSION_EVENT.ToolApprovalResponded
  );
}

function eventCompletesRegenerateBranch(event: PiSessionEvent): boolean {
  return (
    event.type === PI_SESSION_EVENT.Deleted ||
    event.type === PI_SESSION_EVENT.Error ||
    event.type === PI_SESSION_EVENT.OutputText ||
    (isKnownPiSessionEvent(event, PI_SESSION_EVENT.Status) &&
      event.payload.status !== "running")
  );
}
