import { invoke } from "@tauri-apps/api/core";
import type { PiLocalAgentBinaryStatus } from "@/modules/pi/lib/local-agents";
import type { PiProviderRuntimeConfig } from "@/modules/pi/lib/provider";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type {
  PiPromptContext,
  PiSessionCreateResult,
  PiSessionDeleteResult,
  PiSessionDeleteWithArtifactsResult,
  PiSessionRenameResult,
  PiSessionResumeResult,
  PiSessionSendResult,
  PiSessionStopResult,
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
  hostInfo: () => invoke<PiHostInfo>("pi_host_info"),
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
  mcpToolPolicySet: (qualifiedName: string, approvalPolicy: McpApprovalPolicy) =>
    invoke<McpToolPreference>("mcp_tool_policy_set", {
      qualifiedName,
      approvalPolicy,
    }),
  mcpEnvSecretStatuses: (serverId: string, names: string[]) =>
    invoke<McpEnvSecretStatus[]>("mcp_env_secret_statuses", { serverId, names }),
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
  workflowCapabilityAudit: () =>
    invoke<CapabilityAuditEntry[]>("workflow_capability_audit"),
  appCapabilityAudit: () => invoke<CapabilityAuditEntry[]>("app_capability_audit"),
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
  workflowSessionCreate: (
    title?: string,
    cwd?: string | null,
    policy?: WorkflowPiSessionPolicy,
    providerConfig?: PiProviderRuntimeConfig | null,
  ) =>
    invoke<PiSessionCreateResult>("workflow_pi_session_create", {
      title: title ?? null,
      cwd: cwd ?? null,
      providerConfig: providerConfig ?? null,
      workspace: currentWorkspaceEnv(),
      policy,
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
  sessionDeleteWithArtifacts: (sessionId: string) =>
    invoke<PiSessionDeleteWithArtifactsResult>(
      "pi_session_delete_with_artifacts",
      { sessionId },
    ),
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
