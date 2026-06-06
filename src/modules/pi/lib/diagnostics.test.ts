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
      toolMode: "rust-mediated",
      enabledTools: [
        "read",
        "ls",
        "grep",
        "find",
        "bash",
        "edit",
        "write",
        "create_artifact",
        "edit_artifact",
        "read_artifact",
        "list_artifacts",
      ],
      approvalRequiredTools: ["bash", "edit", "write"],
      sessionStorage: "rust-app-data-json+pi-sdk-jsonl",
      apiKeys: [{ name: "ANTHROPIC_API_KEY", configured: true }],
      forwardedEnvNames: ["PATH", "HOME"],
    },
    capabilities: {
      tools: true,
      files: true,
      shell: true,
      git: false,
      terminal: false,
      editor: false,
    },
    protocol: {
      allowedMethods: ["ping", "status", "sessions.create", "sessions.send"],
    },
    limits: {
      maxPromptChars: 20_000,
      maxSessions: 20,
    },
    manager: {
      idleShutdownMs: 600_000,
      methodTimeouts: [{ method: "sessions.create", timeoutMs: 60_000 }],
    },
    sessions: [{ id: "pi-1", title: "Pi", status: "idle", cwd: "/tmp" }],
    ...patch,
  };
}

const anthropicProvider = {
  ok: true,
  provider: "anthropic",
  providerLabel: "Anthropic",
  modelLabel: "Claude Sonnet 4.6",
  config: {
    authMode: "terax",
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    sourceModelId: "claude-sonnet-4-6",
  },
} as const;

const lmstudioProvider = {
  ok: true,
  provider: "lmstudio",
  providerLabel: "LM Studio",
  modelLabel: "qwen2.5-coder",
  config: {
    authMode: "terax",
    provider: "lmstudio",
    modelId: "qwen2.5-coder",
    sourceModelId: "lmstudio-local",
    baseUrl: "http://localhost:1234/v1",
  },
} as const;

describe("buildPiDiagnosticsView", () => {
  it("prioritizes runtime restart recovery and extracts stderr tails", () => {
    const view = buildPiDiagnosticsView({
      diagnostics: null,
      diagnosticsError: null,
      runtimeState: {
        phase: "error",
        detail:
          "Pi host exited with status 1; stderr: boot failed\nmore detail",
      },
      workspaceRoot: "/tmp/project",
    });

    expect(view.summaryTitle).toBe("Pi runtime failed");
    expect(view.summaryDescription).toContain("Restart Pi");
    expect(view.debugDetail).toBe("boot failed\nmore detail");
    expect(view.issues).toContainEqual(
      expect.objectContaining({
        id: "runtime-error",
        action: "restart-runtime",
        actionLabel: "Restart",
        description: expect.not.stringContaining("stderr:"),
      }),
    );
  });

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
        toolMode: "rust-mediated",
        capabilityLabel: "Tools enabled",
        methodCount: 4,
        promptLimitLabel: "20,000 chars",
        idlePolicyLabel: "10m idle",
        summaryTitle: "Pi is ready",
        summaryDescription:
          "Runtime, model, key presence, and session storage look ready.",
      }),
    );
    expect(view.diagnosticsText).toContain("Status: Healthy");
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

  it("surfaces history load failures even before the runtime is started", () => {
    const view = buildPiDiagnosticsView({
      diagnostics: null,
      diagnosticsError: null,
      historyError: "History load failed: corrupt JSON",
      runtimeState: runtimeState("disconnected"),
      workspaceRoot: "/tmp/project",
    });

    expect(view.issues).toContainEqual(
      expect.objectContaining({
        id: "history-unavailable",
        action: "refresh",
        description: "History load failed: corrupt JSON",
        tone: "destructive",
      }),
    );
  });

  it("surfaces the selected provider key status as a settings action", () => {
    const view = buildPiDiagnosticsView({
      diagnostics: diagnostics({
        config: {
          toolMode: "rust-mediated",
          sessionStorage: "rust-app-data-json+pi-sdk-jsonl",
          apiKeys: [{ name: "ANTHROPIC_API_KEY", configured: false }],
        },
      }),
      diagnosticsError: null,
      provider: anthropicProvider,
      providerKeyStatus: {
        configured: false,
        required: true,
        supported: true,
      },
      runtimeState: runtimeState("ready"),
      workspaceRoot: "/tmp/project",
    });

    expect(view).toEqual(
      expect.objectContaining({
        providerLabel: "Anthropic",
        modelLabel: "Claude Sonnet 4.6",
        providerKeyLabel: "Missing",
      }),
    );
    expect(view.issues).toContainEqual(
      expect.objectContaining({
        id: "api-keys-missing",
        action: "open-settings",
        description:
          "Add an Anthropic API key in Settings > Models before running Pi prompts.",
        tone: "destructive",
      }),
    );
  });

  it("does not treat generic sidecar env key counts as the selected provider key", () => {
    const view = buildPiDiagnosticsView({
      diagnostics: diagnostics({
        config: {
          toolMode: "rust-mediated",
          sessionStorage: "rust-app-data-json+pi-sdk-jsonl",
          apiKeys: [{ name: "ANTHROPIC_API_KEY", configured: false }],
        },
      }),
      diagnosticsError: null,
      provider: lmstudioProvider,
      providerKeyStatus: {
        configured: null,
        required: false,
        supported: false,
      },
      runtimeState: runtimeState("ready"),
      workspaceRoot: "/tmp/project",
    });

    expect(view.providerKeyLabel).toBe("Not required");
    expect(view.issues).not.toContainEqual(
      expect.objectContaining({ id: "api-keys-missing" }),
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

  it("surfaces incomplete Pi provider setup as a settings action", () => {
    const view = buildPiDiagnosticsView({
      diagnostics: diagnostics(),
      diagnosticsError: null,
      provider: {
        ok: false,
        provider: "ollama",
        providerLabel: "Ollama",
        modelLabel: "Ollama",
        error: "Ollama needs a model id in Settings > Models.",
        config: null,
      },
      runtimeState: runtimeState("ready"),
      workspaceRoot: "/tmp/project",
    });

    expect(view).toEqual(
      expect.objectContaining({
        providerLabel: "Ollama",
        modelLabel: "Ollama",
      }),
    );
    expect(view.issues).toContainEqual(
      expect.objectContaining({
        id: "provider-unavailable",
        action: "open-settings",
        tone: "destructive",
      }),
    );
  });
});
