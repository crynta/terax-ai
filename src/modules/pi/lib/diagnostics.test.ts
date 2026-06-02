import { describe, expect, it } from "vitest";
import { buildPiDiagnosticsView } from "@/modules/pi/lib/diagnostics";
import type { PiDiagnostics, PiRuntimeState } from "@/modules/pi/lib/status";

function runtimeState(phase: PiRuntimeState["phase"]): PiRuntimeState {
  return { phase, detail: phase === "error" ? "boom" : null };
}

function diagnostics(patch: Partial<PiDiagnostics> = {}): PiDiagnostics {
  return {
    hostVersion: "0.1.0",
    piSdkLoaded: true,
    piPackages: [
      {
        name: "@earendil-works/pi-coding-agent",
        version: "0.78.0",
        loaded: true,
        exportCount: 4,
        error: null,
      },
    ],
    node: {
      version: "v24.16.0",
      execPath: "/node",
      platform: "darwin",
      arch: "arm64",
      pid: 42,
      cwd: "/tmp",
    },
    config: {
      toolMode: "noTools",
      sessionStorage: "rust-app-data-json",
      apiKeys: [{ name: "ANTHROPIC_API_KEY", configured: true }],
    },
    sessions: [{ id: "pi-1", title: "Pi", status: "idle", cwd: "/tmp" }],
    ...patch,
  };
}

describe("buildPiDiagnosticsView", () => {
  it("reports a healthy ready runtime", () => {
    const view = buildPiDiagnosticsView({
      diagnostics: diagnostics(),
      diagnosticsError: null,
      runtimeState: runtimeState("ready"),
      workspaceRoot: "/tmp/project",
    });

    expect(view).toEqual(
      expect.objectContaining({
        apiKeyCount: 1,
        configuredApiKeyCount: 1,
        healthy: true,
        loadedPackageCount: 1,
        nodeLabel: "v24.16.0 darwin/arm64",
        packageCount: 1,
        sessionCount: 1,
        toolMode: "noTools",
      }),
    );
    expect(view.issues).toEqual([]);
  });

  it("suggests starting the runtime before diagnostics are available", () => {
    const view = buildPiDiagnosticsView({
      diagnostics: null,
      diagnosticsError: null,
      runtimeState: runtimeState("disconnected"),
      workspaceRoot: "/tmp/project",
    });

    expect(view.healthy).toBe(false);
    expect(view.issues).toEqual([
      expect.objectContaining({
        id: "runtime-offline",
        action: "start-runtime",
        tone: "muted",
      }),
    ]);
  });

  it("surfaces missing provider keys as a settings action", () => {
    const view = buildPiDiagnosticsView({
      diagnostics: diagnostics({
        config: {
          toolMode: "noTools",
          sessionStorage: "rust-app-data-json",
          apiKeys: [{ name: "ANTHROPIC_API_KEY", configured: false }],
        },
      }),
      diagnosticsError: null,
      runtimeState: runtimeState("ready"),
      workspaceRoot: "/tmp/project",
    });

    expect(view.issues).toContainEqual(
      expect.objectContaining({
        id: "api-keys-missing",
        action: "open-settings",
        tone: "destructive",
      }),
    );
  });

  it("surfaces failed package probes", () => {
    const view = buildPiDiagnosticsView({
      diagnostics: diagnostics({
        piSdkLoaded: false,
        piPackages: [
          {
            name: "@earendil-works/pi-coding-agent",
            version: null,
            loaded: false,
            exportCount: 0,
            error: "Cannot import",
          },
        ],
      }),
      diagnosticsError: null,
      runtimeState: runtimeState("ready"),
      workspaceRoot: "/tmp/project",
    });

    expect(view.issues).toContainEqual(
      expect.objectContaining({
        id: "packages-unavailable",
        action: "refresh",
        tone: "destructive",
      }),
    );
  });

  it("keeps workspace validation visible", () => {
    const view = buildPiDiagnosticsView({
      diagnostics: diagnostics(),
      diagnosticsError: null,
      runtimeState: runtimeState("ready"),
      workspaceRoot: null,
    });

    expect(view.issues).toContainEqual(
      expect.objectContaining({ id: "workspace-missing", action: null }),
    );
  });
});
