export type PiPhase = "disconnected" | "starting" | "ready" | "error";

export type PiRuntimeState = {
  phase: PiPhase;
  detail: string | null;
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
