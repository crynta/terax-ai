import { invoke } from "@tauri-apps/api/core";
import type { PiLocalAgentBinaryStatus } from "@/modules/pi/lib/local-agents";
import type { PiProviderRuntimeConfig } from "@/modules/pi/lib/provider";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type {
  PiPromptContext,
  PiSession as PiSessionType,
  PiSessionEvent as PiSessionEventType,
  PiUsageSummary as PiUsageSummaryType,
  PiSessionsList,
  PiSessionToolRespondResult,
} from "./sessions";
import type {
  CapabilityAuditEntry,
  PiDiagnostics,
  PiHostInfo,
  PiRuntimeState,
} from "./status";

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

export type PiSkillScope = "project" | "user";

export type PiSkillInfo = {
  name: string;
  description: string;
  heading: string | null;
  preview: string | null;
  path: string;
  baseDir: string;
  scope: PiSkillScope;
  warnings: string[];
};

export type PiSkillRootStatus = {
  path: string;
  scope: PiSkillScope;
  scanned: boolean;
  warning: string | null;
};

export type PiSkillsStatus = {
  skills: PiSkillInfo[];
  roots: PiSkillRootStatus[];
  maxSkills: number;
  maxSkillBytes: number;
  truncated: boolean;
};

export type McpTransport = "stdio" | "http";
export type McpApprovalPolicy = "auto" | "ask" | "deny";

export type McpEnvVar = {
  name: string;
  value: string;
};

export type McpServerConfig = {
  id: string;
  name: string;
  transport?: McpTransport;
  command: string;
  args?: string[];
  cwd?: string | null;
  url?: string | null;
  oauthTokenEnv?: string | null;
  env?: McpEnvVar[];
};

export type McpStoredEnvVar = {
  name: string;
};

export type McpStoredServerConfig = {
  id: string;
  name: string;
  transport: McpTransport;
  command: string;
  args: string[];
  cwd?: string | null;
  url?: string | null;
  oauthTokenEnv?: string | null;
  env: McpStoredEnvVar[];
};

export type McpToolRiskLevel = "low" | "medium" | "high";

export type McpToolDescriptor = {
  serverId: string;
  serverName: string;
  name: string;
  qualifiedName: string;
  description: string;
  inputSchema: unknown;
  modelVisible: boolean;
  approvalPolicy: McpApprovalPolicy;
  riskLevel: McpToolRiskLevel;
  riskReasons: string[];
};

export type McpToolPreference = {
  qualifiedName: string;
  modelVisible: boolean;
  approvalPolicy: McpApprovalPolicy;
};

export type McpServerStatus = {
  serverId: string;
  serverName: string;
  transport: McpTransport;
  status: string;
  toolCount: number;
  exitCode?: number | null;
  stderrTail: string;
  lastFailure?: string | null;
  restartBackoffMs?: number | null;
};

export type McpEnvSecretStatus = {
  serverId: string;
  name: string;
  configured: boolean;
};

export type McpOAuthStartRequest = {
  serverId: string;
  clientId?: string | null;
  redirectUri?: string | null;
  scopes?: string[];
};

export type McpOAuthStartResult = {
  serverId: string;
  authorizationUrl: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  tokenEnv: string;
  scopes: string[];
};

export type McpOAuthCompleteRequest = {
  serverId: string;
  codeOrRedirectUrl: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  tokenEnv: string;
};

export type McpOAuthCompleteResult = {
  serverId: string;
  tokenEnv: string;
  accessTokenStored: boolean;
  expiresIn?: number | null;
  scope?: string | null;
};

export type McpOAuthCallbackWaitRequest = {
  state: string;
  redirectUri: string;
  timeoutMs?: number | null;
};

export type McpOAuthCallbackWaitResult = {
  codeOrRedirectUrl: string;
};

export type WorkflowPiSessionPolicy = {
  approved: boolean;
  documentId: string;
  nodeId: string;
  toolName: "workflow.agent_prompt" | "workflow.browser_automation";
};

export const piNative = {
  status: () => invoke<PiRuntimeState>("pi_status"),
  start: () => invoke<PiRuntimeState>("pi_start"),
  stop: () => invoke<PiRuntimeState>("pi_stop"),
  hostInfo: async () => {
    const diagnostics = await invoke<PiDiagnostics>("pi_diagnostics");
    return {
      hostVersion: diagnostics.hostVersion,
      piSdkLoaded: diagnostics.piSdkLoaded,
      piPackages: diagnostics.piPackages,
    } satisfies PiHostInfo;
  },
  diagnostics: () => invoke<PiDiagnostics>("pi_diagnostics"),
  modelsList: () => invoke<PiProfileModelsList>("pi_models_list"),
  localAgentsStatus: (workspace = currentWorkspaceEnv()) =>
    invoke<PiLocalAgentsStatus>("pi_local_agents_status", { workspace }),
  mcpServerConfigsList: () =>
    invoke<McpStoredServerConfig[]>("mcp_server_configs_list"),
  mcpServerConfigSave: (config: McpServerConfig) =>
    invoke<McpStoredServerConfig>("mcp_server_config_save", { config }),
  mcpServerConfigRemove: (serverId: string) =>
    invoke<boolean>("mcp_server_config_remove", { serverId }),
  mcpToolPreferencesList: () =>
    invoke<McpToolPreference[]>("mcp_tool_preferences_list"),
  mcpToolPreferenceSet: (qualifiedName: string, modelVisible: boolean) =>
    invoke<McpToolPreference>("mcp_tool_preference_set", {
      qualifiedName,
      modelVisible,
    }),
  mcpToolPolicySet: (
    qualifiedName: string,
    approvalPolicy: McpApprovalPolicy,
  ) =>
    invoke<McpToolPreference>("mcp_tool_policy_set", {
      qualifiedName,
      approvalPolicy,
    }),
  mcpEnvSecretStatuses: (serverId: string, names: string[]) =>
    invoke<McpEnvSecretStatus[]>("mcp_env_secret_statuses", {
      serverId,
      names,
    }),
  mcpEnvSecretSet: (serverId: string, name: string, value: string) =>
    invoke<void>("mcp_env_secret_set", { serverId, name, value }),
  mcpEnvSecretRemove: (serverId: string, name: string) =>
    invoke<void>("mcp_env_secret_remove", { serverId, name }),
  mcpOAuthStart: (request: McpOAuthStartRequest) =>
    invoke<McpOAuthStartResult>("mcp_oauth_start", { request }),
  mcpOAuthWaitForCallback: (request: McpOAuthCallbackWaitRequest) =>
    invoke<McpOAuthCallbackWaitResult>("mcp_oauth_wait_for_callback", {
      request,
    }),
  mcpOAuthComplete: (request: McpOAuthCompleteRequest) =>
    invoke<McpOAuthCompleteResult>("mcp_oauth_complete", { request }),
  mcpConnectSavedStdio: (serverId: string) =>
    invoke<void>("mcp_connect_saved_stdio", { serverId }),
  mcpConnectStdio: (config: McpServerConfig) =>
    invoke<void>("mcp_connect_stdio", { config }),
  mcpConnectHttp: (config: McpServerConfig) =>
    invoke<void>("mcp_connect_http", { config }),
  mcpDisconnect: (serverId: string) =>
    invoke<boolean>("mcp_disconnect", { serverId }),
  mcpTools: () => invoke<McpToolDescriptor[]>("mcp_tools"),
  mcpServerStatuses: () => invoke<McpServerStatus[]>("mcp_server_statuses"),
  mcpCallTool: (qualifiedName: string, args: unknown) =>
    invoke<{
      content: Array<{ type: string; text?: string; data?: unknown }>;
      isError: boolean;
    }>("mcp_call_tool", { qualifiedName, arguments: args }),
  workflowCapabilityAudit: () =>
    invoke<CapabilityAuditEntry[]>("workflow_capability_audit"),
  appCapabilityAudit: () =>
    invoke<CapabilityAuditEntry[]>("app_capability_audit"),
  sessionsHistory: () => invoke<PiSessionsList>("pi_sessions_history"),
  sessionCreate: async (
    title?: string,
    cwd?: string | null,
    providerConfig?: PiProviderRuntimeConfig | null,
  ) => {
    const { webviewSessionCreate } = await import("./webview-session");
    return webviewSessionCreate(title, cwd, providerConfig ?? null);
  },
  workflowSessionCreate: async (
    title?: string,
    cwd?: string | null,
    policy?: WorkflowPiSessionPolicy,
    providerConfig?: PiProviderRuntimeConfig | null,
  ) => {
    if (!policy?.approved) {
      throw new Error(
        "Workflow Pi sessions require an approved workflow policy.",
      );
    }
    const { webviewSessionCreate } = await import("./webview-session");
    return webviewSessionCreate(
      title,
      cwd,
      providerConfig ?? null,
      undefined,
      undefined,
      true,
    );
  },
  sessionResume: async (
    sessionId: string,
    providerConfig?: PiProviderRuntimeConfig | null,
  ) => {
    const { webviewSessionResume } = await import("./webview-session");
    return webviewSessionResume(sessionId, providerConfig ?? null);
  },
  sessionSend: async (
    sessionId: string,
    prompt: string,
    context?: PiPromptContext | null,
    options: {
      regenerateBranchGroupId?: string | null;
      thinkingLevel?: PiProviderRuntimeConfig["thinkingLevel"] | null;
    } = {},
  ) => {
    const { webviewSessionSend } = await import("./webview-session");
    return webviewSessionSend(sessionId, prompt, context ?? null, {
      ...(options.regenerateBranchGroupId
        ? { regenerateBranchGroupId: options.regenerateBranchGroupId }
        : {}),
      ...(options.thinkingLevel === undefined || options.thinkingLevel === null
        ? {}
        : { thinkingLevel: options.thinkingLevel }),
    });
  },
  sessionRename: async (sessionId: string, title: string) => {
    const { webviewSessionRename } = await import("./webview-session");
    return webviewSessionRename(sessionId, title);
  },
  sessionDelete: async (sessionId: string) => {
    const { webviewSessionDelete } = await import("./webview-session");
    return webviewSessionDelete(sessionId);
  },
  sessionDeleteWithArtifacts: async (sessionId: string) => {
    const { webviewSessionDeleteWithArtifacts } = await import(
      "./webview-session"
    );
    return webviewSessionDeleteWithArtifacts(sessionId);
  },
  sessionArchive: (sessionId: string) =>
    invoke<{ session: PiSessionType }>("pi_session_archive", {
      sessionId,
    }),
  sessionRestore: (sessionId: string) =>
    invoke<{ session: PiSessionType }>("pi_session_restore", {
      sessionId,
    }),
  sessionFork: (
    parentSessionId: string,
    forkEventId?: string | null,
    title?: string | null,
  ) =>
    invoke<{
      session: PiSessionType;
      events: PiSessionEventType[];
    }>("pi_session_fork", {
      parentSessionId,
      forkEventId: forkEventId ?? null,
      title: title ?? null,
    }),
  sessionRollback: (sessionId: string, rollbackEventId: string) =>
    invoke<{
      session: PiSessionType;
      removedEventCount: number;
    }>("pi_session_rollback", {
      sessionId,
      rollbackEventId,
    }),
  usageSummary: (sessionId?: string | null) =>
    invoke<PiUsageSummaryType>("pi_usage_summary", {
      sessionId: sessionId ?? null,
    }),
  sessionToolRespond: async (
    sessionId: string,
    toolCallId: string,
    approved: boolean,
  ) => {
    const { webviewSessionToolRespond } = await import("./webview-session");
    return webviewSessionToolRespond(
      sessionId,
      toolCallId,
      approved,
    ) as Promise<PiSessionToolRespondResult>;
  },
  sessionStop: async (sessionId: string) => {
    const { webviewSessionStop } = await import("./webview-session");
    return webviewSessionStop(sessionId);
  },
};
