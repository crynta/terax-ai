import type { PiProviderResolution } from "@/modules/pi/lib/provider";
import type { PiDiagnostics, PiRuntimeState } from "@/modules/pi/lib/status";

export type PiDiagnosticsAction = "open-settings" | "refresh" | "start-runtime";

export type PiDiagnosticsIssue = {
  id:
    | "api-keys-missing"
    | "diagnostics-unavailable"
    | "history-unavailable"
    | "packages-unavailable"
    | "provider-unavailable"
    | "runtime-connecting"
    | "runtime-error"
    | "runtime-offline"
    | "workspace-missing";
  title: string;
  description: string;
  action: PiDiagnosticsAction | null;
  actionLabel: string | null;
  tone: "default" | "destructive" | "muted";
};

export type PiProviderKeyStatus = {
  configured: boolean | null;
  required: boolean;
  supported: boolean;
};

export type PiDiagnosticsView = {
  apiKeyCount: number;
  capabilityLabel: string;
  configuredApiKeyCount: number;
  healthy: boolean;
  idlePolicyLabel: string;
  issues: PiDiagnosticsIssue[];
  loadedPackageCount: number;
  methodCount: number;
  modelLabel: string;
  nodeLabel: string;
  packageCount: number;
  promptLimitLabel: string;
  providerKeyLabel: string;
  providerLabel: string;
  sessionCount: number;
  storageLabel: string;
  toolMode: string;
};

type BuildPiDiagnosticsViewInput = {
  diagnostics: PiDiagnostics | null;
  diagnosticsError: string | null;
  historyError?: string | null;
  provider?: PiProviderResolution;
  providerKeyStatus?: PiProviderKeyStatus;
  runtimeState: PiRuntimeState;
  workspaceRoot: string | null;
};

function providerKeyLabel(
  provider: PiProviderResolution | undefined,
  status: PiProviderKeyStatus | undefined,
): string {
  if (provider && !provider.ok) return "Needs setup";
  if (!provider) return "Unavailable";
  if (!status) return "Checking";
  if (!status.supported) return "Not required";
  if (status.configured === null) return "Checking";
  if (status.configured) return "Configured";
  return status.required ? "Missing" : "Optional";
}

function packageIssueDescription(diagnostics: PiDiagnostics): string {
  const failed = diagnostics.piPackages.filter((pkg) => !pkg.loaded);
  const names = failed.map((pkg) => pkg.name).join(", ");
  if (names.length === 0) {
    return "Pi package status could not be confirmed.";
  }
  return `Unable to load ${names}. Refresh diagnostics after rebuilding sidecars.`;
}

function capabilityLabel(diagnostics: PiDiagnostics | null): string {
  if (!diagnostics?.capabilities) return "Unavailable";
  return diagnostics.capabilities.tools ? "Tools enabled" : "Tools disabled";
}

function formatDuration(milliseconds: number | undefined): string {
  if (!milliseconds || milliseconds < 1) return "Unavailable";
  if (milliseconds % 60_000 === 0) return `${milliseconds / 60_000}m idle`;
  if (milliseconds % 1_000 === 0) return `${milliseconds / 1_000}s idle`;
  return `${milliseconds}ms idle`;
}

function promptLimitLabel(diagnostics: PiDiagnostics | null): string {
  const limit = diagnostics?.limits?.maxPromptChars;
  if (!limit || limit < 1) return "Unavailable";
  return `${limit.toLocaleString("en-US")} chars`;
}

function runtimeIssue(state: PiRuntimeState): PiDiagnosticsIssue | null {
  switch (state.phase) {
    case "disconnected":
      return {
        id: "runtime-offline",
        title: "Pi runtime is stopped",
        description:
          "Start Pi to load package diagnostics and create sessions.",
        action: "start-runtime",
        actionLabel: "Start",
        tone: "muted",
      };
    case "starting":
      return {
        id: "runtime-connecting",
        title: "Pi runtime is connecting",
        description: "Refresh after the sidecar finishes starting.",
        action: "refresh",
        actionLabel: "Refresh",
        tone: "muted",
      };
    case "error":
      return {
        id: "runtime-error",
        title: "Pi runtime failed",
        description: state.detail ?? "Check the runtime status and try again.",
        action: "refresh",
        actionLabel: "Refresh",
        tone: "destructive",
      };
    case "ready":
      return null;
  }
}

export function buildPiDiagnosticsView({
  diagnostics,
  diagnosticsError,
  historyError,
  provider,
  providerKeyStatus,
  runtimeState,
  workspaceRoot,
}: BuildPiDiagnosticsViewInput): PiDiagnosticsView {
  const loadedPackageCount =
    diagnostics?.piPackages.filter((pkg) => pkg.loaded).length ?? 0;
  const packageCount = diagnostics?.piPackages.length ?? 0;
  const configuredApiKeyCount =
    diagnostics?.config.apiKeys.filter((key) => key.configured).length ?? 0;
  const apiKeyCount = diagnostics?.config.apiKeys.length ?? 0;
  const issues: PiDiagnosticsIssue[] = [];
  const baseRuntimeIssue = runtimeIssue(runtimeState);

  if (baseRuntimeIssue) {
    issues.push(baseRuntimeIssue);
  }
  if (!workspaceRoot) {
    issues.push({
      id: "workspace-missing",
      title: "No workspace selected",
      description:
        "Open a workspace before creating workspace-bound Pi sessions.",
      action: null,
      actionLabel: null,
      tone: "muted",
    });
  }
  if (provider && !provider.ok) {
    issues.push({
      id: "provider-unavailable",
      title: "Pi model needs setup",
      description: provider.error,
      action: "open-settings",
      actionLabel: "Settings",
      tone: "destructive",
    });
  }
  if (historyError) {
    issues.push({
      id: "history-unavailable",
      title: "Session history failed to load",
      description: historyError,
      action: "refresh",
      actionLabel: "Refresh",
      tone: "destructive",
    });
  }
  if (runtimeState.phase === "ready" && diagnosticsError) {
    issues.push({
      id: "diagnostics-unavailable",
      title: "Diagnostics refresh failed",
      description: diagnosticsError,
      action: "refresh",
      actionLabel: "Refresh",
      tone: "destructive",
    });
  } else if (runtimeState.phase === "ready" && diagnostics === null) {
    issues.push({
      id: "diagnostics-unavailable",
      title: "Diagnostics not loaded",
      description:
        "Refresh diagnostics to inspect packages, keys, and live sessions.",
      action: "refresh",
      actionLabel: "Refresh",
      tone: "default",
    });
  }

  if (diagnostics) {
    if (!diagnostics.piSdkLoaded || loadedPackageCount < packageCount) {
      issues.push({
        id: "packages-unavailable",
        title: "Pi packages need attention",
        description: packageIssueDescription(diagnostics),
        action: "refresh",
        actionLabel: "Refresh",
        tone: "destructive",
      });
    }
  }

  if (
    provider?.ok &&
    providerKeyStatus?.supported &&
    providerKeyStatus.required &&
    providerKeyStatus.configured === false
  ) {
    issues.push({
      id: "api-keys-missing",
      title: `${provider.providerLabel} key missing`,
      description: `Add an ${provider.providerLabel} API key in Settings > Models before running Pi prompts.`,
      action: "open-settings",
      actionLabel: "Settings",
      tone: "destructive",
    });
  }

  return {
    apiKeyCount,
    capabilityLabel: capabilityLabel(diagnostics),
    configuredApiKeyCount,
    healthy: issues.length === 0,
    idlePolicyLabel: formatDuration(diagnostics?.manager?.idleShutdownMs),
    issues,
    loadedPackageCount,
    methodCount: diagnostics?.protocol?.allowedMethods.length ?? 0,
    modelLabel: provider?.modelLabel ?? "Default",
    nodeLabel: diagnostics
      ? `${diagnostics.node.version} ${diagnostics.node.platform}/${diagnostics.node.arch}`
      : "Unavailable",
    packageCount,
    promptLimitLabel: promptLimitLabel(diagnostics),
    providerKeyLabel: providerKeyLabel(provider, providerKeyStatus),
    providerLabel: provider?.providerLabel ?? "Pi",
    sessionCount: diagnostics?.sessions.length ?? 0,
    storageLabel: diagnostics?.config.sessionStorage ?? "Unavailable",
    toolMode: diagnostics?.config.toolMode ?? "Unavailable",
  };
}
