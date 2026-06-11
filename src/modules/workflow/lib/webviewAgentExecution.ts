import type { PiProviderRuntimeConfig } from "@/modules/pi/lib/provider";
import type {
  PiSessionCreateResult,
  PiSessionSendResult,
  PiSessionStopResult,
} from "@/modules/pi/lib/sessions";
import {
  webviewSessionCreate,
  webviewSessionSend,
  webviewSessionStop,
} from "@/modules/pi/lib/webview-session";
import type { WorkflowPiAgentApi } from "./nativeAgentExecution";

/**
 * Webview-backed WorkflowPiAgentApi.
 *
 * WorkflowPiSessionPolicy is a Rust-side capability gate — not used by the
 * webview agent. Workflow nodes are already approved at the execution layer
 * (workflowAgentPolicy always sets approved: true).
 */
export const workflowPiWebviewApi: WorkflowPiAgentApi = {
  sessionCreate: async (
    title?: string,
    cwd?: string | null,
    _policy?: unknown,
    providerConfig?: PiProviderRuntimeConfig | null,
  ): Promise<PiSessionCreateResult> => {
    // Workflow runs are unattended: pre-approve tools (the node was approved at
    // the workflow execution layer). Rust still records and audits each grant.
    return webviewSessionCreate(
      title,
      cwd,
      providerConfig,
      undefined,
      undefined,
      true,
    );
  },

  sessionSend: async (
    sessionId: string,
    prompt: string,
    context?: unknown,
  ): Promise<PiSessionSendResult> => {
    return webviewSessionSend(
      sessionId,
      prompt,
      context as Parameters<typeof webviewSessionSend>[2],
    );
  },

  sessionStop: async (sessionId: string): Promise<PiSessionStopResult> => {
    return webviewSessionStop(sessionId);
  },
};
