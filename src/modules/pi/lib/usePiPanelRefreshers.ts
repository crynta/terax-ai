import { type SetStateAction, useCallback } from "react";
import { piNative } from "@/modules/pi/lib/native";
import {
  clearPiPanelDiagnostics,
  refreshPiPanelDataForState,
} from "@/modules/pi/lib/panel-refresh";
import { errorMessage, toErrorState } from "@/modules/pi/lib/panel-defaults";
import {
  applyPiSessionEvents,
  mergePiSessionEvents,
  mergePiSessionSnapshots,
  type PiSession,
  type PiSessionEvent,
} from "@/modules/pi/lib/sessions";
import type { CapabilityAuditEntry, PiDiagnostics, PiRuntimeState } from "@/modules/pi/lib/status";

type Setter<T> = (next: SetStateAction<T>) => void;

export function usePiPanelRefreshers({
  setAppAuditEntries,
  setDiagnostics,
  setDiagnosticsError,
  setHistoryError,
  setIsDiagnosticsRefreshing,
  setRuntimeState,
  setSessionEvents,
  setSessions,
  setWorkflowAuditEntries,
}: {
  setAppAuditEntries: Setter<CapabilityAuditEntry[]>;
  setDiagnostics: Setter<PiDiagnostics | null>;
  setDiagnosticsError: Setter<string | null>;
  setHistoryError: Setter<string | null>;
  setIsDiagnosticsRefreshing: Setter<boolean>;
  setRuntimeState: Setter<PiRuntimeState>;
  setSessionEvents: Setter<PiSessionEvent[]>;
  setSessions: Setter<PiSession[]>;
  setWorkflowAuditEntries: Setter<CapabilityAuditEntry[]>;
}) {
  const refreshStatus = useCallback(async () => {
    try {
      setRuntimeState(await piNative.status());
    } catch (error) {
      setRuntimeState(toErrorState(error));
    }
  }, [setRuntimeState]);

  const applyHistoryList = useCallback(
    (result: { sessions: PiSession[]; events: PiSessionEvent[] }) => {
      setSessionEvents((current) =>
        mergePiSessionEvents(current, result.events),
      );
      setSessions(applyPiSessionEvents(result.sessions, result.events));
    },
    [setSessionEvents, setSessions],
  );

  const applyLiveSessionList = useCallback(
    (result: { sessions: PiSession[]; events: PiSessionEvent[] }) => {
      setSessionEvents((current) =>
        mergePiSessionEvents(current, result.events),
      );
      setSessions((current) =>
        applyPiSessionEvents(
          mergePiSessionSnapshots(current, result.sessions, {
            missingStatus: "stopped",
          }),
          result.events,
        ),
      );
    },
    [setSessionEvents, setSessions],
  );

  const refreshSessions = useCallback(async () => {
    try {
      applyLiveSessionList(await piNative.sessionsList());
    } catch (error) {
      setRuntimeState(toErrorState(error));
    }
  }, [applyLiveSessionList, setRuntimeState]);

  const refreshHistory = useCallback(async () => {
    try {
      applyHistoryList(await piNative.sessionsHistory());
      setHistoryError(null);
    } catch (error) {
      setHistoryError(`History load failed: ${errorMessage(error)}`);
    }
  }, [applyHistoryList, setHistoryError]);

  const refreshCapabilityAudits = useCallback(async () => {
    const [workflowAudit, appAudit] = await Promise.all([
      piNative.workflowCapabilityAudit().catch(() => []),
      piNative.appCapabilityAudit().catch(() => []),
    ]);
    setWorkflowAuditEntries(workflowAudit);
    setAppAuditEntries(appAudit);
  }, [setAppAuditEntries, setWorkflowAuditEntries]);

  const refreshDiagnostics = useCallback(async () => {
    try {
      const [nextDiagnostics, workflowAudit, appAudit] = await Promise.all([
        piNative.diagnostics(),
        piNative.workflowCapabilityAudit().catch(() => []),
        piNative.appCapabilityAudit().catch(() => []),
      ]);
      setDiagnostics(nextDiagnostics);
      setWorkflowAuditEntries(workflowAudit);
      setAppAuditEntries(appAudit);
      setDiagnosticsError(null);
    } catch (error) {
      setDiagnostics(null);
      await refreshCapabilityAudits();
      setDiagnosticsError(errorMessage(error));
    }
  }, [
    refreshCapabilityAudits,
    setAppAuditEntries,
    setDiagnostics,
    setDiagnosticsError,
    setWorkflowAuditEntries,
  ]);

  const refreshPanelDiagnostics = useCallback(async () => {
    setIsDiagnosticsRefreshing(true);
    try {
      const nextState = await piNative.status();
      setRuntimeState(nextState);
      await refreshPiPanelDataForState(nextState, {
        clearDiagnostics: () =>
          clearPiPanelDiagnostics(setDiagnostics, setDiagnosticsError),
        refreshDiagnostics,
        refreshHistory,
        refreshSessions,
      });
    } catch (error) {
      setRuntimeState(toErrorState(error));
      setDiagnostics(null);
      setDiagnosticsError(errorMessage(error));
    } finally {
      setIsDiagnosticsRefreshing(false);
    }
  }, [
    refreshDiagnostics,
    refreshHistory,
    refreshSessions,
    setDiagnostics,
    setDiagnosticsError,
    setIsDiagnosticsRefreshing,
    setRuntimeState,
  ]);

  return {
    refreshDiagnostics,
    refreshHistory,
    refreshPanelDiagnostics,
    refreshSessions,
    refreshStatus,
  };
}
