/**
 * Pi Session Backend Abstraction
 *
 * Provides a unified API for PiPanel to create/send/resume/stop/rename/delete
 * sessions. The Pi agent runs entirely in the webview (the Node sidecar was
 * removed), so this routes to the `webviewSession*` functions.
 */
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

// ─── Webview Backend ───

const webviewBackend: PiSessionBackend = {
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
 * Get the active session backend. The Pi agent runs entirely in the webview
 * (the Node sidecar was removed). Cached after first resolution.
 */
export function getSessionBackend(): PiSessionBackend {
  if (!_backend) {
    _backend = webviewBackend;
  }
  return _backend;
}

/**
 * Reset the cached backend (useful for testing or settings changes).
 */
export function resetSessionBackend(): void {
  _backend = null;
}
