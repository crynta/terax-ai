/**
 * Pi Session Backend Abstraction
 *
 * Provides a unified API for PiPanel to create/send/resume/stop/rename/delete
 * sessions, routing to either:
 * - The sidecar-backed `piNative` (when USE_WEBVIEW_AGENT is false)
 * - The webview-backed `webviewSession*` functions (when USE_WEBVIEW_AGENT is true)
 *
 * Runtime and diagnostics always go through piNative (sidecar/Rust) regardless.
 */
import { USE_WEBVIEW_AGENT } from "@/modules/pi/bridge";
import { piNative } from "@/modules/pi/lib/native";
import type { PiProviderRuntimeConfig } from "@/modules/pi/lib/provider";
import type {
  PiPromptContext,
  PiQuestionAnswer,
  PiSession,
  PiSessionCreateResult,
  PiSessionDeleteResult,
  PiSessionDeleteWithArtifactsResult,
  PiSessionEvent,
  PiSessionRenameResult,
  PiSessionResumeResult,
  PiSessionSendResult,
  PiSessionStopResult,
  PiUsageSummary,
} from "@/modules/pi/lib/sessions";
import {
  webviewSessionCreate,
  webviewSessionDelete,
  webviewSessionDeleteWithArtifacts,
  webviewSessionFork,
  webviewSessionQuestionRespond,
  webviewSessionRename,
  webviewSessionResume,
  webviewSessionRollback,
  webviewSessionSend,
  webviewSessionStop,
  webviewSessionToolRespond,
} from "@/modules/pi/lib/webview-session";

// ─── Session Backend Interface ───

export type PiSessionBackend = {
  readonly useWebview: boolean;

  sessionCreate(
    title: string | undefined,
    cwd: string | null | undefined,
    providerConfig: PiProviderRuntimeConfig,
  ): Promise<PiSessionCreateResult>;

  sessionResume(
    sessionId: string,
    providerConfig: PiProviderRuntimeConfig,
  ): Promise<PiSessionResumeResult>;

  sessionSend(
    sessionId: string,
    promptText: string,
    context: PiPromptContext | null | undefined,
    options?: {
      thinkingLevel?: unknown;
      regenerateBranchGroupId?: string;
    },
  ): Promise<PiSessionSendResult>;

  sessionStop(sessionId: string): Promise<PiSessionStopResult>;

  sessionRename(
    sessionId: string,
    title: string,
  ): Promise<PiSessionRenameResult>;

  sessionDelete(sessionId: string): Promise<PiSessionDeleteResult>;

  sessionDeleteWithArtifacts(
    sessionId: string,
  ): Promise<PiSessionDeleteWithArtifactsResult>;

  sessionArchive(sessionId: string): Promise<{ session: PiSession }>;

  sessionRestore(sessionId: string): Promise<{ session: PiSession }>;

  sessionFork(
    parentSessionId: string,
    forkEventId?: string | null,
    title?: string | null,
  ): Promise<{ session: PiSession; events: PiSessionEvent[] }>;

  sessionRollback(
    sessionId: string,
    rollbackEventId: string,
  ): Promise<{ session: PiSession; removedEventCount: number }>;

  usageSummary(sessionId?: string | null): Promise<PiUsageSummary>;

  sessionToolRespond(
    sessionId: string,
    toolCallId: string,
    approved: boolean,
  ): Promise<{ session: PiSession; events: PiSessionEvent[] }>;

  sessionQuestionRespond(
    sessionId: string,
    questionId: string,
    answers: PiQuestionAnswer[],
  ): Promise<{ session: PiSession; events: PiSessionEvent[] }>;
};

// ─── Sidecar Backend ───

const sidecarBackend: PiSessionBackend = {
  useWebview: false,

  async sessionCreate(title, cwd, providerConfig) {
    return piNative.sessionCreate(title, cwd, providerConfig);
  },

  async sessionResume(sessionId, providerConfig) {
    return piNative.sessionResume(sessionId, providerConfig);
  },

  async sessionSend(sessionId, promptText, context, options) {
    return piNative.sessionSend(sessionId, promptText, context, {
      thinkingLevel:
        options?.thinkingLevel as PiProviderRuntimeConfig["thinkingLevel"],
      regenerateBranchGroupId: options?.regenerateBranchGroupId,
    });
  },

  async sessionStop(sessionId) {
    return piNative.sessionStop(sessionId);
  },

  async sessionRename(sessionId, title) {
    return piNative.sessionRename(sessionId, title);
  },

  async sessionDelete(sessionId) {
    return piNative.sessionDelete(sessionId);
  },

  async sessionDeleteWithArtifacts(sessionId) {
    return piNative.sessionDeleteWithArtifacts(sessionId);
  },

  async sessionArchive(sessionId) {
    return piNative.sessionArchive(sessionId);
  },

  async sessionRestore(sessionId) {
    return piNative.sessionRestore(sessionId);
  },

  async sessionFork(parentSessionId, forkEventId?, title?) {
    return piNative.sessionFork(
      parentSessionId,
      forkEventId ?? null,
      title ?? null,
    );
  },

  async sessionRollback(sessionId, rollbackEventId) {
    return piNative.sessionRollback(sessionId, rollbackEventId);
  },

  async usageSummary(sessionId?) {
    return piNative.usageSummary(sessionId ?? null);
  },

  async sessionToolRespond(sessionId, toolCallId, approved) {
    return piNative.sessionToolRespond(sessionId, toolCallId, approved);
  },

  async sessionQuestionRespond() {
    throw new Error(
      "Interactive questions are only supported by the webview Pi agent.",
    );
  },
};

// ─── Webview Backend ───

const webviewBackend: PiSessionBackend = {
  useWebview: true,

  async sessionCreate(title, cwd, providerConfig) {
    return webviewSessionCreate(title, cwd, providerConfig);
  },

  async sessionResume(sessionId, providerConfig) {
    return webviewSessionResume(sessionId, providerConfig);
  },

  async sessionSend(sessionId, promptText, context, options) {
    return webviewSessionSend(sessionId, promptText, context, {
      thinkingLevel: options?.thinkingLevel,
      regenerateBranchGroupId: options?.regenerateBranchGroupId,
    });
  },

  async sessionStop(sessionId) {
    return webviewSessionStop(sessionId);
  },

  async sessionRename(sessionId, title) {
    return webviewSessionRename(sessionId, title);
  },

  async sessionDelete(sessionId) {
    return webviewSessionDelete(sessionId);
  },

  async sessionDeleteWithArtifacts(sessionId) {
    return webviewSessionDeleteWithArtifacts(sessionId);
  },

  async sessionArchive(sessionId) {
    // For webview agent, archive is purely metadata — update session via invoke
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<{ session: PiSession }>("pi_session_archive", { sessionId });
  },

  async sessionRestore(sessionId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<{ session: PiSession }>("pi_session_restore", { sessionId });
  },

  async sessionFork(parentSessionId, forkEventId?, title?) {
    return webviewSessionFork(parentSessionId, forkEventId, title);
  },

  async sessionRollback(sessionId, rollbackEventId) {
    return webviewSessionRollback(sessionId, rollbackEventId);
  },

  async usageSummary(sessionId?) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<PiUsageSummary>("pi_usage_summary", {
      sessionId: sessionId ?? null,
    });
  },

  async sessionToolRespond(sessionId, toolCallId, approved) {
    return webviewSessionToolRespond(
      sessionId,
      toolCallId,
      approved,
    ) as Promise<{
      session: PiSession;
      events: PiSessionEvent[];
    }>;
  },

  async sessionQuestionRespond(sessionId, questionId, answers) {
    return webviewSessionQuestionRespond(sessionId, questionId, answers);
  },
};

// ─── Resolver ───

let _backend: PiSessionBackend | null = null;

/**
 * Get the active session backend.
 *
 * When USE_WEBVIEW_AGENT is true, returns the webview backend that
 * runs Pi SDK Agent entirely in the webview without a Node.js sidecar.
 * Otherwise returns the sidecar backend that routes through Rust IPC.
 *
 * The backend is cached after first resolution.
 */
export function getSessionBackend(): PiSessionBackend {
  if (!_backend) {
    _backend = USE_WEBVIEW_AGENT ? webviewBackend : sidecarBackend;
  }
  return _backend;
}

/**
 * Reset the cached backend (useful for testing or settings changes).
 */
export function resetSessionBackend(): void {
  _backend = null;
}
