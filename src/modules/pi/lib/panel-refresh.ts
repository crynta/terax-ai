import type { PiRuntimeState } from "@/modules/pi/lib/status";

type ReadyRefreshTasks = {
  refreshDiagnostics: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  refreshSessions: () => Promise<void>;
};

type PanelRefreshTasks = ReadyRefreshTasks & {
  clearDiagnostics: () => void;
};

export function clearPiPanelDiagnostics(
  setDiagnostics: (diagnostics: null) => void,
  setDiagnosticsError: (error: null) => void,
): void {
  setDiagnostics(null);
  setDiagnosticsError(null);
}

export async function refreshReadyPiPanelData({
  refreshDiagnostics,
  refreshHistory,
  refreshSessions,
}: ReadyRefreshTasks): Promise<void> {
  await Promise.all([
    refreshHistory(),
    refreshSessions(),
    refreshDiagnostics(),
  ]);
}

export async function refreshPiPanelDataForState(
  runtimeState: PiRuntimeState,
  tasks: PanelRefreshTasks,
): Promise<void> {
  if (runtimeState.phase === "ready") {
    await refreshReadyPiPanelData(tasks);
    return;
  }

  await tasks.refreshHistory();
  tasks.clearDiagnostics();
}
