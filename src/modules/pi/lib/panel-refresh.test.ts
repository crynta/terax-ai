import { describe, expect, it, vi } from "vitest";
import {
  refreshPiPanelDataForState,
  refreshReadyPiPanelData,
} from "@/modules/pi/lib/panel-refresh";

describe("Pi panel refresh orchestration", () => {
  it("starts independent ready refreshes in parallel", async () => {
    const calls: string[] = [];
    let resolveHistory: (() => void) | null = null;
    const historyStarted = new Promise<void>((resolve) => {
      resolveHistory = resolve;
    });

    const refreshPromise = refreshReadyPiPanelData({
      refreshDiagnostics: async () => {
        calls.push("diagnostics:start");
      },
      refreshHistory: async () => {
        calls.push("history:start");
        resolveHistory?.();
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        calls.push("history:end");
      },
      refreshSessions: async () => {
        calls.push("sessions:start");
      },
    });

    await historyStarted;

    expect(calls).toEqual([
      "history:start",
      "sessions:start",
      "diagnostics:start",
    ]);

    await refreshPromise;
    expect(calls).toContain("history:end");
  });

  it("clears diagnostics instead of loading ready-only data when runtime is not ready", async () => {
    const refreshHistory = vi.fn(async () => {});
    const refreshSessions = vi.fn(async () => {});
    const refreshDiagnostics = vi.fn(async () => {});
    const clearDiagnostics = vi.fn();

    await refreshPiPanelDataForState(
      { phase: "disconnected", detail: null },
      {
        clearDiagnostics,
        refreshDiagnostics,
        refreshHistory,
        refreshSessions,
      },
    );

    expect(refreshHistory).toHaveBeenCalledTimes(1);
    expect(clearDiagnostics).toHaveBeenCalledTimes(1);
    expect(refreshSessions).not.toHaveBeenCalled();
    expect(refreshDiagnostics).not.toHaveBeenCalled();
  });
});
