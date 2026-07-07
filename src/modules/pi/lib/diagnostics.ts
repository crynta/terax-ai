import type { PiProviderResolution } from "@/modules/pi/lib/provider";
import type { PiDiagnostics, PiRuntimeState } from "@/modules/pi/lib/status";

export type PiDiagnosticsAction =
  | "open-settings"
  | "refresh"
  | "restart-runtime"
  | "start-runtime";

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
  debugDetail: string | null;
  diagnosticsText: string;
  healthy: boolean;
  idlePolicyLabel: string;
  issues: PiDiagnosticsIssue[];
  loadedPackageCount: number;
  methodCount: number;
  modelLabel: string;
  runtimeLabel: string;
  packageCount: number;
  promptLimitLabel: string;
  providerKeyLabel: string;
  providerLabel: string;
  sessionCount: number;
  storageLabel: string;
  summaryDescription: string;
  summaryTitle: string;
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
  return `Unable to load ${names}. Refresh diagnostics after rebuilding the app or reinstalling dependencies.`;
}

function capabilityLabel(diagnostics: PiDiagnostics | null): string {
  if (!diagnostics?.capabilities) return "Unavailable";
  if (!diagnostics.capabilities.tools) return "No Pi tools";
  return "Tools enabled";
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

type DiagnosticDetailParts = {
  message: string;
  stderrTail: string | null;
};

function splitDiagnosticDetail(
  detail: string | null | undefined,
): DiagnosticDetailParts {
  const fallback = "Check the runtime status and try again.";
  if (!detail) return { message: fallback, stderrTail: null };

  const marker = "; stderr: ";
  const markerIndex = detail.indexOf(marker);
  if (markerIndex === -1) {
    return { message: detail, stderrTail: null };
  }

  return {
    message: detail.slice(0, markerIndex).trim() || fallback,
    stderrTail: detail.slice(markerIndex + marker.length).trim() || null,
  };
}

function summaryForIssues(issues: PiDiagnosticsIssue[]): {
  summaryDescription: string;
  summaryTitle: string;
} {
  if (issues.length === 0) {
    return {
      summaryTitle: "Pi is ready",
      summaryDescription:
        "Runtime, model, key presence, and session storage look ready.",
    };
  }

  const topIssue = issues[0];
  const action = topIssue.actionLabel ? ` Next: ${topIssue.actionLabel}.` : "";
  return {
    summaryTitle: topIssue.title,
    summaryDescription: `${topIssue.description}${action}`,
  };
}

function buildDiagnosticsText(input: {
  issues: PiDiagnosticsIssue[];
  view: Omit<PiDiagnosticsView, "diagnosticsText">;
}): string {
  const { issues, view } = input;
  const lines = [
    "Pi diagnostics",
    `Status: ${view.healthy ? "Healthy" : "Review"}`,
    `Summary: ${view.summaryTitle} - ${view.summaryDescription}`,
    `Provider: ${view.providerLabel}`,
    `Model: ${view.modelLabel}`,
    `Provider key: ${view.providerKeyLabel}`,
    `Packages: ${view.loadedPackageCount}/${view.packageCount}`,
    `Sessions: ${view.sessionCount}`,
    `Capabilities: ${view.capabilityLabel}`,
    `Tool mode: ${view.toolMode}`,
    `Allowed methods: ${view.methodCount}`,
    `Prompt limit: ${view.promptLimitLabel}`,
    `Storage: ${view.storageLabel}`,
    `Idle policy: ${view.idlePolicyLabel}`,
    `Runtime: ${view.runtimeLabel}`,
  ];

  if (issues.length > 0) {
    lines.push("Issues:");
    for (const issue of issues) {
      lines.push(`- ${issue.title}: ${issue.description}`);
    }
  }

  return lines.join("\n");
}

function runtimeIssue(state: PiRuntimeState): PiDiagnosticsIssue | null {
  switch (state.phase) {
    case "disconnected":
      return {
        id: "runtime-offline",
        title: "Pi runtime is stopped",
        description:
          "Start the Pi runtime to load diagnostics and create workspace sessions.",
        action: "start-runtime",
        actionLabel: "Start",
        tone: "muted",
      };
    case "starting":
      return {
        id: "runtime-connecting",
        title: "Pi runtime is connecting",
        description:
          "Wait for the Pi runtime to finish starting, then refresh diagnostics if this stays here.",
        action: "refresh",
        actionLabel: "Refresh",
        tone: "muted",
      };
    case "error": {
      const detail = splitDiagnosticDetail(state.detail);
      return {
        id: "runtime-error",
        title: "Pi runtime failed",
        description: `${detail.message} Restart Pi to reset the webview runtime.`,
        action: "restart-runtime",
        actionLabel: "Restart",
        tone: "destructive",
      };
    }
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
    const detail = splitDiagnosticDetail(diagnosticsError);
    issues.push({
      id: "diagnostics-unavailable",
      title: "Diagnostics refresh failed",
      description: `${detail.message} Refresh diagnostics after the runtime settles.`,
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

  const runtimeDetail = splitDiagnosticDetail(runtimeState.detail);
  const diagnosticsDetail = splitDiagnosticDetail(diagnosticsError);
  const debugDetail = runtimeDetail.stderrTail ?? diagnosticsDetail.stderrTail;
  const summary = summaryForIssues(issues);
  const viewWithoutText: Omit<PiDiagnosticsView, "diagnosticsText"> = {
    apiKeyCount,
    capabilityLabel: capabilityLabel(diagnostics),
    configuredApiKeyCount,
    debugDetail,
    healthy: issues.length === 0,
    idlePolicyLabel: formatDuration(diagnostics?.manager?.idleShutdownMs),
    issues,
    loadedPackageCount,
    methodCount: diagnostics?.protocol?.allowedMethods.length ?? 0,
    modelLabel: provider?.modelLabel ?? "Default",
    runtimeLabel: diagnostics
      ? `${diagnostics.hostVersion} ${diagnostics.node.platform}/${diagnostics.node.arch}`
      : "Unavailable",
    packageCount,
    promptLimitLabel: promptLimitLabel(diagnostics),
    providerKeyLabel: providerKeyLabel(provider, providerKeyStatus),
    providerLabel: provider?.providerLabel ?? "Pi",
    sessionCount: diagnostics?.sessions.length ?? 0,
    storageLabel: diagnostics?.config.sessionStorage ?? "Unavailable",
    summaryDescription: summary.summaryDescription,
    summaryTitle: summary.summaryTitle,
    toolMode: diagnostics?.config.toolMode ?? "Unavailable",
  };

  return {
    ...viewWithoutText,
    diagnosticsText: buildDiagnosticsText({ issues, view: viewWithoutText }),
  };
}
