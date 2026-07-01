import { type SetStateAction, useCallback } from "react";
import { piNative } from "@/modules/pi/lib/native";
import { errorMessage, toErrorState } from "@/modules/pi/lib/panel-defaults";
import {
  clearPiPanelDiagnostics,
  refreshPiPanelDataForState,
} from "@/modules/pi/lib/panel-refresh";
import {
  applyPiSessionEvents,
  mergePiSessionEvents,
  mergePiSessionSnapshots,
  type PiSession,
  type PiSessionEvent,
} from "@/modules/pi/lib/sessions";
import type {
  CapabilityAuditEntry,
  PiDiagnostics,
  PiRuntimeState,
} from "@/modules/pi/lib/status";

type Setter<T> = (next: SetStateAction<T>) => void;

type CapabilityAuditResult = {
  appAudit: CapabilityAuditEntry[];
  error: string | null;
  workflowAudit: CapabilityAuditEntry[];
};

async function loadCapabilityAudits(): Promise<CapabilityAuditResult> {
  const [workflowResult, appResult] = await Promise.allSettled([
    piNative.workflowCapabilityAudit(),
    piNative.appCapabilityAudit(),
  ]);
  const errors: string[] = [];
  const workflowAudit =
    workflowResult.status === "fulfilled" ? workflowResult.value : [];
  const appAudit = appResult.status === "fulfilled" ? appResult.value : [];

  if (workflowResult.status === "rejected") {
    errors.push(errorMessage(workflowResult.reason));
  }
  if (appResult.status === "rejected") {
    errors.push(errorMessage(appResult.reason));
  }

  return {
    appAudit,
    error:
      errors.length > 0
        ? `Capability audit refresh failed: ${errors.join("; ")}`
        : null,
    workflowAudit,
  };
}

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
      // Post-sidecar, the persisted history is the single session source
      // (`pi_sessions_list` was removed with the Rust host supervisor). Apply it
      // with the live-merge semantics so vanished sessions are marked stopped.
      applyLiveSessionList(await piNative.sessionsHistory());
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
    const result = await loadCapabilityAudits();
    setWorkflowAuditEntries(result.workflowAudit);
    setAppAuditEntries(result.appAudit);
    return result.error;
  }, [setAppAuditEntries, setWorkflowAuditEntries]);

  const refreshDiagnostics = useCallback(async () => {
    try {
      const [nextDiagnostics, auditResult] = await Promise.all([
        piNative.diagnostics(),
        loadCapabilityAudits(),
      ]);
      setDiagnostics(nextDiagnostics);
      setWorkflowAuditEntries(auditResult.workflowAudit);
      setAppAuditEntries(auditResult.appAudit);
      setDiagnosticsError(auditResult.error);
    } catch (error) {
      setDiagnostics(null);
      const auditError = await refreshCapabilityAudits();
      setDiagnosticsError(
        [errorMessage(error), auditError].filter(Boolean).join("; "),
      );
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
