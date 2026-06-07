import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import { formatPiErrorDetail } from "@/modules/pi/lib/errors";
import { shouldPrewarmPiRuntime } from "@/modules/pi/lib/lifecycle";
import { piNative } from "@/modules/pi/lib/native";
import { refreshReadyPiPanelData } from "@/modules/pi/lib/panel-refresh";
import type { PiSession } from "@/modules/pi/lib/sessions";
import { markPiSessionsStopped } from "@/modules/pi/lib/sessions";
import type { PiRuntimeState } from "@/modules/pi/lib/status";

export type PiRuntimeAction = "starting" | "stopping" | "restarting" | null;

type UsePiRuntimeActionsInput = {
  isBusy: boolean;
  onStopRuntimeNeedsConfirmation?: () => void;
  prewarmAttemptedRef: MutableRefObject<boolean>;
  refreshDiagnostics: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  runtimeState: PiRuntimeState;
  sessions: PiSession[];
  setDiagnostics: (value: null) => void;
  setDiagnosticsError: (value: string | null) => void;
  setIsBusy: Dispatch<SetStateAction<boolean>>;
  setRuntimeState: Dispatch<SetStateAction<PiRuntimeState>>;
  setSessions: Dispatch<SetStateAction<PiSession[]>>;
};

function toErrorState(error: unknown): PiRuntimeState {
  return {
    phase: "error",
    detail: formatPiErrorDetail(error),
  };
}

export function usePiRuntimeActions({
  isBusy,
  onStopRuntimeNeedsConfirmation,
  prewarmAttemptedRef,
  refreshDiagnostics,
  refreshHistory,
  refreshSessions,
  runtimeState,
  sessions,
  setDiagnostics,
  setDiagnosticsError,
  setIsBusy,
  setRuntimeState,
  setSessions,
}: UsePiRuntimeActionsInput) {
  const [runtimeAction, setRuntimeAction] = useState<PiRuntimeAction>(null);

  const startRuntime = useCallback(async () => {
    setIsBusy(true);
    setRuntimeAction("starting");
    setDiagnostics(null);
    setDiagnosticsError(null);
    setRuntimeState({ phase: "starting", detail: "Starting Pi" });
    try {
      setRuntimeState(await piNative.start());
      await refreshReadyPiPanelData({
        refreshDiagnostics,
        refreshHistory,
        refreshSessions,
      });
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setRuntimeAction(null);
      setIsBusy(false);
    }
  }, [
    refreshDiagnostics,
    refreshHistory,
    refreshSessions,
    setDiagnostics,
    setDiagnosticsError,
    setIsBusy,
    setRuntimeState,
  ]);

  useEffect(() => {
    if (
      !shouldPrewarmPiRuntime({
        attempted: prewarmAttemptedRef.current,
        isBusy,
        runtimeState,
      })
    ) {
      return;
    }
    prewarmAttemptedRef.current = true;
    void startRuntime();
  }, [isBusy, prewarmAttemptedRef, runtimeState, startRuntime]);

  const stopRuntime = useCallback(async () => {
    setIsBusy(true);
    setRuntimeAction("stopping");
    try {
      setRuntimeState(await piNative.stop());
      setSessions((current) => markPiSessionsStopped(current));
      setDiagnostics(null);
      setDiagnosticsError(null);
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setRuntimeAction(null);
      setIsBusy(false);
    }
  }, [
    setDiagnostics,
    setDiagnosticsError,
    setIsBusy,
    setRuntimeState,
    setSessions,
  ]);

  const requestStopRuntime = useCallback(() => {
    const hasRunningSessions = sessions.some(
      (session) => session.status === "running",
    );
    if (hasRunningSessions) {
      onStopRuntimeNeedsConfirmation?.();
      return;
    }
    void stopRuntime();
  }, [onStopRuntimeNeedsConfirmation, sessions, stopRuntime]);

  const restartRuntime = useCallback(async () => {
    setIsBusy(true);
    setRuntimeAction("restarting");
    setDiagnosticsError(null);
    setRuntimeState({ phase: "starting", detail: "Restarting Pi" });
    try {
      await piNative.stop();
      setSessions((current) => markPiSessionsStopped(current));
      setDiagnostics(null);
      setRuntimeState(await piNative.start());
      await refreshReadyPiPanelData({
        refreshDiagnostics,
        refreshHistory,
        refreshSessions,
      });
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setRuntimeAction(null);
      setIsBusy(false);
    }
  }, [
    refreshDiagnostics,
    refreshHistory,
    refreshSessions,
    setDiagnostics,
    setDiagnosticsError,
    setIsBusy,
    setRuntimeState,
    setSessions,
  ]);

  return {
    requestStopRuntime,
    restartRuntime,
    runtimeAction,
    startRuntime,
    stopRuntime,
  };
}
