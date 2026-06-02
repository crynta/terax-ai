import type { PiProviderResolution } from "@/modules/pi/lib/provider";
import type { PiDiagnostics, PiRuntimeState } from "@/modules/pi/lib/status";

export type PiDiagnosticsAction = "open-settings" | "refresh" | "start-runtime";

export type PiDiagnosticsIssue = {
  id:
    | "api-keys-missing"
    | "diagnostics-unavailable"
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

export type PiDiagnosticsView = {
  apiKeyCount: number;
  configuredApiKeyCount: number;
  healthy: boolean;
  issues: PiDiagnosticsIssue[];
  loadedPackageCount: number;
  modelLabel: string;
  nodeLabel: string;
  packageCount: number;
  providerLabel: string;
  sessionCount: number;
  storageLabel: string;
  toolMode: string;
};

type BuildPiDiagnosticsViewInput = {
  diagnostics: PiDiagnostics | null;
  diagnosticsError: string | null;
  provider?: PiProviderResolution;
  runtimeState: PiRuntimeState;
  workspaceRoot: string | null;
};

function packageIssueDescription(diagnostics: PiDiagnostics): string {
  const failed = diagnostics.piPackages.filter((pkg) => !pkg.loaded);
  const names = failed.map((pkg) => pkg.name).join(", ");
  if (names.length === 0) {
    return "Pi package status could not be confirmed.";
  }
  return `Unable to load ${names}. Refresh diagnostics after rebuilding sidecars.`;
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
  provider,
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
    if (apiKeyCount > 0 && configuredApiKeyCount === 0) {
      issues.push({
        id: "api-keys-missing",
        title: "No provider key configured",
        description:
          "Add a provider key in Settings > Models before running real Pi prompts.",
        action: "open-settings",
        actionLabel: "Settings",
        tone: "destructive",
      });
    }
  }

  return {
    apiKeyCount,
    configuredApiKeyCount,
    healthy: issues.length === 0,
    issues,
    loadedPackageCount,
    modelLabel: provider?.modelLabel ?? "Default",
    nodeLabel: diagnostics
      ? `${diagnostics.node.version} ${diagnostics.node.platform}/${diagnostics.node.arch}`
      : "Unavailable",
    packageCount,
    providerLabel: provider?.providerLabel ?? "Pi",
    sessionCount: diagnostics?.sessions.length ?? 0,
    storageLabel: diagnostics?.config.sessionStorage ?? "Unavailable",
    toolMode: diagnostics?.config.toolMode ?? "Unavailable",
  };
}
