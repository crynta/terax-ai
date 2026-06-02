export type PiPhase = "disconnected" | "starting" | "ready" | "error";

export type PiRuntimeState = {
  phase: PiPhase;
  detail: string | null;
};

export type PiPackageInfo = {
  name: string;
  version: string | null;
  loaded: boolean;
  exportCount: number;
  error: string | null;
};

export type PiHostInfo = {
  hostVersion: string;
  piSdkLoaded: boolean;
  piPackages: PiPackageInfo[];
};

export type PiDiagnostics = PiHostInfo & {
  node: {
    version: string;
    execPath: string;
    platform: string;
    arch: string;
    pid: number;
    cwd: string;
  };
  config: {
    toolMode: string;
    sessionStorage: string;
    apiKeys: Array<{ name: string; configured: boolean }>;
  };
  sessions: Array<{ id: string; title: string; status: string }>;
};

export type PiStatusView = {
  label: string;
  tone: "muted" | "progress" | "success" | "error";
  canStart: boolean;
  canStop: boolean;
};

export function getPiStatusView(state: PiRuntimeState): PiStatusView {
  switch (state.phase) {
    case "disconnected":
      return {
        label: "Not connected",
        tone: "muted",
        canStart: true,
        canStop: false,
      };
    case "starting":
      return {
        label: "Connecting",
        tone: "progress",
        canStart: false,
        canStop: true,
      };
    case "ready":
      return {
        label: "Ready",
        tone: "success",
        canStart: false,
        canStop: true,
      };
    case "error":
      return {
        label: "Needs attention",
        tone: "error",
        canStart: true,
        canStop: false,
      };
  }
}
