import type { PiPanelSectionCollapseState } from "@/modules/pi/lib/PiControllerProvider";
import { formatPiErrorDetail } from "@/modules/pi/lib/errors";
import type { CapabilityAuditEntry, PiRuntimeState } from "@/modules/pi/lib/status";

export const INITIAL_PI_STATE: PiRuntimeState = {
  phase: "disconnected",
  detail: null,
};

export const EMPTY_CAPABILITY_AUDIT_ENTRIES: CapabilityAuditEntry[] = [];

export const INITIAL_SECTION_COLLAPSED = {
  diagnostics: true,
  sessions: true,
  context: true,
  localAgents: true,
  capabilityAudit: true,
  mcp: true,
} satisfies PiPanelSectionCollapseState;

export function errorMessage(error: unknown): string {
  return formatPiErrorDetail(error);
}

export function toErrorState(error: unknown): PiRuntimeState {
  return {
    phase: "error",
    detail: errorMessage(error),
  };
}
