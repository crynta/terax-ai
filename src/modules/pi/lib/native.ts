import { invoke } from "@tauri-apps/api/core";
import type { PiLocalAgentBinaryStatus } from "@/modules/pi/lib/local-agents";
import type { PiProviderRuntimeConfig } from "@/modules/pi/lib/provider";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type {
  PiPromptContext,
  PiSessionCreateResult,
  PiSessionDeleteResult,
  PiSessionRenameResult,
  PiSessionResumeResult,
  PiSessionSendResult,
  PiSessionStopResult,
  PiSessionToolRespondResult,
  PiSessionsList,
} from "./sessions";
import type { PiDiagnostics, PiHostInfo, PiRuntimeState } from "./status";

export type PiProfileModelInfo = {
  provider: string;
  providerLabel: string;
  id: string;
  label: string;
  available: boolean;
  contextWindow: number | null;
  maxTokens: number | null;
  reasoning: boolean;
};

export type PiProfileModelsList = {
  profileAgentDir: string;
  loadError: string | null;
  models: PiProfileModelInfo[];
};

export type PiLocalAgentsStatus = {
  agents: PiLocalAgentBinaryStatus[];
};

export const piNative = {
  status: () => invoke<PiRuntimeState>("pi_status"),
  start: () => invoke<PiRuntimeState>("pi_start"),
  stop: () => invoke<PiRuntimeState>("pi_stop"),
  hostInfo: () => invoke<PiHostInfo>("pi_host_info"),
  diagnostics: () => invoke<PiDiagnostics>("pi_diagnostics"),
  modelsList: () => invoke<PiProfileModelsList>("pi_models_list"),
  localAgentsStatus: (workspace = currentWorkspaceEnv()) =>
    invoke<PiLocalAgentsStatus>("pi_local_agents_status", { workspace }),
  sessionsHistory: () => invoke<PiSessionsList>("pi_sessions_history"),
  sessionsList: () => invoke<PiSessionsList>("pi_sessions_list"),
  sessionCreate: (
    title?: string,
    cwd?: string | null,
    providerConfig?: PiProviderRuntimeConfig | null,
  ) =>
    invoke<PiSessionCreateResult>("pi_session_create", {
      title: title ?? null,
      cwd: cwd ?? null,
      providerConfig: providerConfig ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  sessionResume: (
    sessionId: string,
    providerConfig?: PiProviderRuntimeConfig | null,
  ) =>
    invoke<PiSessionResumeResult>("pi_session_resume", {
      sessionId,
      providerConfig: providerConfig ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  sessionSend: (
    sessionId: string,
    prompt: string,
    context?: PiPromptContext | null,
    options: {
      regenerateBranchGroupId?: string | null;
      thinkingLevel?: PiProviderRuntimeConfig["thinkingLevel"] | null;
    } = {},
  ) =>
    invoke<PiSessionSendResult>("pi_session_send", {
      sessionId,
      prompt,
      context: context ?? null,
      regenerateBranchGroupId: options.regenerateBranchGroupId ?? null,
      ...(options.thinkingLevel === undefined || options.thinkingLevel === null
        ? {}
        : { thinkingLevel: options.thinkingLevel }),
      workspace: currentWorkspaceEnv(),
    }),
  sessionRename: (sessionId: string, title: string) =>
    invoke<PiSessionRenameResult>("pi_session_rename", { sessionId, title }),
  sessionDelete: (sessionId: string) =>
    invoke<PiSessionDeleteResult>("pi_session_delete", { sessionId }),
  sessionToolRespond: (
    sessionId: string,
    toolCallId: string,
    approved: boolean,
  ) =>
    invoke<PiSessionToolRespondResult>("pi_session_tool_respond", {
      sessionId,
      toolCallId,
      approved,
    }),
  sessionStop: (sessionId: string) =>
    invoke<PiSessionStopResult>("pi_session_stop", { sessionId }),
};
