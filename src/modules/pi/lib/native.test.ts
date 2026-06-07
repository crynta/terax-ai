import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { piNative } from "./native";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("piNative", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useWorkspaceEnvStore.getState().setEnv({ kind: "local" });
  });

  it("passes the explicit workspace cwd when creating Pi sessions", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ session: null, events: [] });

    await piNative.sessionCreate("Plan", "/Users/me/project");

    expect(invoke).toHaveBeenCalledWith("pi_session_create", {
      title: "Plan",
      cwd: "/Users/me/project",
      providerConfig: null,
      workspace: { kind: "local" },
    });
  });

  it("passes workflow policy when creating workflow Pi sessions", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ session: null, events: [] });

    await piNative.workflowSessionCreate("Browse", "/Users/me/project", {
      approved: true,
      documentId: "wf",
      nodeId: "node_browser",
      toolName: "workflow.browser_automation",
    });

    expect(invoke).toHaveBeenCalledWith("workflow_pi_session_create", {
      title: "Browse",
      cwd: "/Users/me/project",
      providerConfig: null,
      workspace: { kind: "local" },
      policy: {
        approved: true,
        documentId: "wf",
        nodeId: "node_browser",
        toolName: "workflow.browser_automation",
      },
    });
  });

  it("passes validated turn context when sending Pi prompts", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ accepted: true });

    await piNative.sessionSend("pi-1", "Where am I?", {
      workspaceRoot: "/Users/me/project",
      activeTerminalCwd: "/Users/me/project/src",
      activeFile: "/Users/me/project/src/App.tsx",
      activeTerminalPrivate: true,
    });

    expect(invoke).toHaveBeenCalledWith("pi_session_send", {
      sessionId: "pi-1",
      prompt: "Where am I?",
      context: {
        workspaceRoot: "/Users/me/project",
        activeTerminalCwd: "/Users/me/project/src",
        activeFile: "/Users/me/project/src/App.tsx",
        activeTerminalPrivate: true,
      },
      regenerateBranchGroupId: null,
      workspace: { kind: "local" },
    });
  });

  it("passes branch metadata when regenerating a Pi response", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ accepted: true });

    await piNative.sessionSend(
      "pi-1",
      "Try again",
      { workspaceRoot: "/Users/me/project" },
      { regenerateBranchGroupId: "turn-1" },
    );

    expect(invoke).toHaveBeenCalledWith("pi_session_send", {
      sessionId: "pi-1",
      prompt: "Try again",
      context: { workspaceRoot: "/Users/me/project" },
      regenerateBranchGroupId: "turn-1",
      workspace: { kind: "local" },
    });
  });

  it("passes the selected thinking level when sending Pi prompts", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ accepted: true });

    await piNative.sessionSend("pi-1", "Think", null, {
      thinkingLevel: "high",
    });

    expect(invoke).toHaveBeenCalledWith("pi_session_send", {
      sessionId: "pi-1",
      prompt: "Think",
      context: null,
      regenerateBranchGroupId: null,
      thinkingLevel: "high",
      workspace: { kind: "local" },
    });
  });

  it("resumes Pi sessions in the current workspace environment", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ session: null, events: [] });

    await piNative.sessionResume("pi-1", {
      authMode: "profile",
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      sourceModelId: "claude-sonnet-4-5",
      thinkingLevel: "medium",
    });

    expect(invoke).toHaveBeenCalledWith("pi_session_resume", {
      sessionId: "pi-1",
      providerConfig: {
        authMode: "profile",
        provider: "anthropic",
        modelId: "claude-sonnet-4-5",
        sourceModelId: "claude-sonnet-4-5",
        thinkingLevel: "medium",
      },
      workspace: { kind: "local" },
    });
  });

  it("renames Pi sessions", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ session: null, events: [] });

    await piNative.sessionRename("pi-1", "Reviewed plan");

    expect(invoke).toHaveBeenCalledWith("pi_session_rename", {
      sessionId: "pi-1",
      title: "Reviewed plan",
    });
  });

  it("responds to Pi tool approvals", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ session: null, events: [] });

    await piNative.sessionToolRespond("pi-1", "tool-call-1", false);

    expect(invoke).toHaveBeenCalledWith("pi_session_tool_respond", {
      sessionId: "pi-1",
      toolCallId: "tool-call-1",
      approved: false,
    });
  });

  it("deletes Pi sessions", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ session: null, events: [] });

    await piNative.sessionDelete("pi-1");

    expect(invoke).toHaveBeenCalledWith("pi_session_delete", {
      sessionId: "pi-1",
    });
  });

  it("requests the Pi profile model catalog", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ models: [] });

    await piNative.modelsList();

    expect(invoke).toHaveBeenCalledWith("pi_models_list");
  });

  it("requests the local CLI agent detection catalog for the current workspace", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ agents: [] });
    useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "Ubuntu" } });

    await piNative.localAgentsStatus();

    expect(invoke).toHaveBeenCalledWith("pi_local_agents_status", {
      workspace: { kind: "wsl", distro: "Ubuntu" },
    });
  });

  it("lists saved MCP stdio server configs", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);

    await piNative.mcpServerConfigsList();

    expect(invoke).toHaveBeenCalledWith("mcp_server_configs_list");
  });

  it("saves MCP stdio server configs without reshaping the payload", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: "fs" });
    const config = {
      id: "fs",
      name: "Filesystem",
      command: "node",
      args: ["server.js"],
      cwd: "/Users/me/project",
      env: [{ name: "SAFE_TOKEN", value: "secret" }],
    };

    await piNative.mcpServerConfigSave(config);

    expect(invoke).toHaveBeenCalledWith("mcp_server_config_save", { config });
  });

  it("removes saved MCP stdio server configs", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);

    await piNative.mcpServerConfigRemove("fs");

    expect(invoke).toHaveBeenCalledWith("mcp_server_config_remove", {
      serverId: "fs",
    });
  });

  it("updates MCP tool visibility preferences", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      qualifiedName: "mcp__fs__read",
      modelVisible: true,
      approvalPolicy: "ask",
    });

    await piNative.mcpToolPreferenceSet("mcp__fs__read", true);

    expect(invoke).toHaveBeenCalledWith("mcp_tool_preference_set", {
      qualifiedName: "mcp__fs__read",
      modelVisible: true,
    });
  });

  it("updates MCP tool approval policies", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      qualifiedName: "mcp__fs__read",
      modelVisible: true,
      approvalPolicy: "auto",
    });

    await piNative.mcpToolPolicySet("mcp__fs__read", "auto");

    expect(invoke).toHaveBeenCalledWith("mcp_tool_policy_set", {
      qualifiedName: "mcp__fs__read",
      approvalPolicy: "auto",
    });
  });

  it("manages MCP env secrets without exposing values in config storage", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([
        { serverId: "fs", name: "SAFE_TOKEN", configured: true },
      ])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await piNative.mcpEnvSecretStatuses("fs", ["SAFE_TOKEN"]);
    await piNative.mcpEnvSecretSet("fs", "SAFE_TOKEN", "secret");
    await piNative.mcpEnvSecretRemove("fs", "SAFE_TOKEN");

    expect(invoke).toHaveBeenNthCalledWith(1, "mcp_env_secret_statuses", {
      serverId: "fs",
      names: ["SAFE_TOKEN"],
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "mcp_env_secret_set", {
      serverId: "fs",
      name: "SAFE_TOKEN",
      value: "secret",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "mcp_env_secret_remove", {
      serverId: "fs",
      name: "SAFE_TOKEN",
    });
  });

  it("connects saved MCP configs through the Rust broker", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await piNative.mcpConnectSavedStdio("fs");

    expect(invoke).toHaveBeenCalledWith("mcp_connect_saved_stdio", {
      serverId: "fs",
    });
  });

  it("connects runtime HTTP MCP configs through the Rust broker", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    const config = {
      id: "remote",
      name: "Remote",
      transport: "http" as const,
      command: "",
      url: "https://mcp.example.com/mcp",
      oauthTokenEnv: "REMOTE_TOKEN",
      env: [{ name: "REMOTE_TOKEN", value: "secret" }],
    };

    await piNative.mcpConnectHttp(config);

    expect(invoke).toHaveBeenCalledWith("mcp_connect_http", { config });
  });

  it("lists connected MCP server statuses", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);

    await piNative.mcpServerStatuses();

    expect(invoke).toHaveBeenCalledWith("mcp_server_statuses");
  });

  it("reads workflow and app capability audit entries", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await piNative.workflowCapabilityAudit();
    await piNative.appCapabilityAudit();

    expect(invoke).toHaveBeenNthCalledWith(1, "workflow_capability_audit");
    expect(invoke).toHaveBeenNthCalledWith(2, "app_capability_audit");
  });

  it("runs MCP OAuth start, callback waiting, and completion through native commands", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      authorizationUrl: "https://auth",
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      codeOrRedirectUrl: "http://127.0.0.1/cb?code=abc&state=s",
    });
    vi.mocked(invoke).mockResolvedValueOnce({ accessTokenStored: true });

    await piNative.mcpOAuthStart({ serverId: "remote", scopes: ["mcp"] });
    await piNative.mcpOAuthWaitForCallback({
      state: "s",
      redirectUri: "http://127.0.0.1/cb",
      timeoutMs: 1000,
    });
    await piNative.mcpOAuthComplete({
      serverId: "remote",
      codeOrRedirectUrl: "http://127.0.0.1/cb?code=abc&state=s",
      state: "s",
      codeVerifier: "verifier",
      redirectUri: "http://127.0.0.1/cb",
      clientId: "terax",
      tokenEnv: "REMOTE_TOKEN",
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "mcp_oauth_start", {
      request: { serverId: "remote", scopes: ["mcp"] },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "mcp_oauth_wait_for_callback", {
      request: {
        state: "s",
        redirectUri: "http://127.0.0.1/cb",
        timeoutMs: 1000,
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "mcp_oauth_complete", {
      request: {
        serverId: "remote",
        codeOrRedirectUrl: "http://127.0.0.1/cb?code=abc&state=s",
        state: "s",
        codeVerifier: "verifier",
        redirectUri: "http://127.0.0.1/cb",
        clientId: "terax",
        tokenEnv: "REMOTE_TOKEN",
      },
    });
  });

  it("disconnects MCP servers and refreshes discovered tools", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true).mockResolvedValueOnce([]);

    await piNative.mcpDisconnect("fs");
    await piNative.mcpTools();

    expect(invoke).toHaveBeenNthCalledWith(1, "mcp_disconnect", {
      serverId: "fs",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "mcp_tools");
  });
});
