import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildMcpServerConfigFromDraft,
  draftFromStoredMcpConfig,
  PiMcpCard,
} from "@/modules/pi/components/PiMcpCard";
import type {
  McpEnvSecretStatus,
  McpServerStatus,
  McpStoredServerConfig,
  McpToolDescriptor,
} from "@/modules/pi/lib/native";
import type { CapabilityAuditEntry } from "@/modules/pi/lib/status";

const savedServer: McpStoredServerConfig = {
  id: "filesystem",
  name: "Filesystem",
  transport: "stdio",
  command: "node",
  args: ["server.js"],
  cwd: "/Users/me/project",
  url: null,
  oauthTokenEnv: null,
  env: [{ name: "SAFE_TOKEN" }],
};

const httpServer: McpStoredServerConfig = {
  id: "remote",
  name: "Remote",
  transport: "http",
  command: "",
  args: [],
  cwd: null,
  url: "https://mcp.example.com/mcp",
  oauthTokenEnv: "REMOTE_TOKEN",
  env: [{ name: "REMOTE_TOKEN" }],
};

const tool: McpToolDescriptor = {
  serverId: "filesystem",
  serverName: "Filesystem",
  name: "read_file",
  qualifiedName: "mcp__filesystem__read_file",
  description: "Read a workspace file",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  modelVisible: true,
  approvalPolicy: "ask",
  riskLevel: "low",
  riskReasons: ["read-only style tool"],
};

const status: McpServerStatus = {
  serverId: "filesystem",
  serverName: "Filesystem",
  transport: "stdio",
  status: "connected",
  toolCount: 1,
  stderrTail: "filesystem server warning",
};

const exitedStatus: McpServerStatus = {
  serverId: "filesystem",
  serverName: "Filesystem",
  transport: "stdio",
  status: "exited",
  toolCount: 0,
  exitCode: 7,
  stderrTail: "server exited after startup",
  lastFailure: "MCP server exited with exit status: 7",
};

const audit: CapabilityAuditEntry = {
  sequence: 42,
  sessionId: "pi-1",
  toolCallId: "call-1",
  toolName: "mcp__filesystem__read_file",
  approved: false,
  allowed: false,
  outcome: "blocked",
  message: "capability tool requires approval: mcp__filesystem__read_file",
};

function renderCard(input?: {
  configs?: McpStoredServerConfig[];
  envSecretStatuses?: McpEnvSecretStatus[];
  statuses?: McpServerStatus[];
  tools?: McpToolDescriptor[];
  auditEntries?: CapabilityAuditEntry[];
  error?: string | null;
}) {
  return renderToStaticMarkup(
    <PiMcpCard
      auditEntries={input?.auditEntries ?? []}
      collapsed={false}
      configs={input?.configs ?? []}
      disabled={false}
      envSecretStatuses={input?.envSecretStatuses ?? []}
      error={input?.error ?? null}
      refreshing={false}
      statuses={input?.statuses ?? []}
      tools={input?.tools ?? []}
      onCollapsedChange={vi.fn()}
      onConnect={vi.fn()}
      onDisconnect={vi.fn()}
      onEnvSecretRemove={vi.fn()}
      onEnvSecretSet={vi.fn()}
      onRefresh={vi.fn()}
      onRemoveConfig={vi.fn()}
      onRestart={vi.fn()}
      onSaveConfig={vi.fn()}
      onStartOAuth={vi.fn()}
      onToolPolicyChange={vi.fn()}
    />,
  );
}

describe("PiMcpCard", () => {
  it("shows saved MCP servers, connected tools, and recent policy status", () => {
    const html = renderCard({
      configs: [savedServer],
      envSecretStatuses: [
        { serverId: "filesystem", name: "SAFE_TOKEN", configured: true },
      ],
      statuses: [status],
      tools: [tool],
      auditEntries: [audit],
    });

    expect(html).toContain("MCP servers");
    expect(html).toContain("Filesystem");
    expect(html).toContain("Connected");
    expect(html).toContain("1 tool");
    expect(html).toContain("Restart");
    expect(html).toContain("keyring set");
    expect(html).toContain('aria-label="Set secret value for SAFE_TOKEN"');
    expect(html).toContain('aria-label="Remove secret value for SAFE_TOKEN"');
    expect(html).toContain("filesystem server warning");
    expect(html).toContain("read_file");
    expect(html).toContain("Read a workspace file");
    expect(html).toContain("Enabled");
    expect(html).toContain("ask");
    expect(html).toContain("low risk");
    expect(html).toContain("read-only style tool");
    expect(html).toContain(
      'aria-label="Set MCP tool read_file policy to auto"',
    );
    expect(html).toContain(
      'aria-label="Set MCP tool read_file policy to deny"',
    );
    expect(html).toContain("Recent policy");
    expect(html).toContain("blocked");
    expect(html).toContain("requires approval");
  });

  it("shows denied connected MCP tools with safe policy controls", () => {
    const html = renderCard({
      configs: [savedServer],
      tools: [{ ...tool, modelVisible: false, approvalPolicy: "deny" }],
    });

    expect(html).toContain("Hidden");
    expect(html).toContain("deny");
    expect(html).toContain('aria-label="Set MCP tool read_file policy to ask"');
  });

  it("shows exited MCP servers with reconnect and exit details", () => {
    const html = renderCard({
      configs: [savedServer],
      statuses: [exitedStatus],
      tools: [tool],
    });

    expect(html).toContain("Exited");
    expect(html).toContain("exit 7");
    expect(html).toContain("Reconnect");
    expect(html).toContain("server exited after startup");
    expect(html).toContain("Last failure");
    expect(html).toContain("exit status: 7");
    expect(html).not.toContain("read_file");
    expect(html).not.toContain("Disconnect");
  });

  it("shows an idle empty state and keeps env values out of saved config rows", () => {
    const html = renderCard({ configs: [savedServer] });

    expect(html).toContain("Saved only");
    expect(html).toContain("Connect");
    expect(html).toContain("SAFE_TOKEN");
    expect(html).toContain("env fallback");
    expect(html).toContain('aria-label="Edit MCP server Filesystem"');
    expect(html).toContain('aria-label="Remove MCP server Filesystem"');
    expect(html).not.toContain("SAFE_TOKEN=secret");
    expect(html).not.toContain("supersecret");
  });

  it("shows a clear empty state when no MCP configs are saved", () => {
    const html = renderCard();

    expect(html).toContain("No MCP servers saved");
    expect(html).toContain(
      "Save stdio or HTTP MCP configs to broker tools through Rust policy.",
    );
    expect(html).toContain("Add MCP server");
  });

  it("builds safe save payloads with env names but no env values", () => {
    const result = buildMcpServerConfigFromDraft({
      id: "fs",
      name: "Filesystem",
      transport: "stdio",
      command: "node",
      argsText: "server.js\n--stdio",
      cwd: "/Users/me/project",
      url: "",
      oauthTokenEnv: "",
      envNamesText: "SAFE_TOKEN\nOTHER_TOKEN\nSAFE_TOKEN",
    });

    expect(result).toEqual({
      ok: true,
      config: {
        id: "fs",
        name: "Filesystem",
        transport: "stdio",
        command: "node",
        args: ["server.js", "--stdio"],
        cwd: "/Users/me/project",
        url: null,
        oauthTokenEnv: null,
        env: [
          { name: "SAFE_TOKEN", value: "" },
          { name: "OTHER_TOKEN", value: "" },
        ],
      },
    });
  });

  it("builds HTTP MCP payloads with OAuth env names but no token values", () => {
    const result = buildMcpServerConfigFromDraft({
      id: "remote",
      name: "Remote",
      transport: "http",
      command: "",
      argsText: "ignored",
      cwd: "/ignored",
      url: "https://mcp.example.com/mcp",
      oauthTokenEnv: "REMOTE_TOKEN",
      envNamesText: "EXTRA_HEADER_TOKEN",
    });

    expect(result).toEqual({
      ok: true,
      config: {
        id: "remote",
        name: "Remote",
        transport: "http",
        command: "",
        args: [],
        cwd: null,
        url: "https://mcp.example.com/mcp",
        oauthTokenEnv: "REMOTE_TOKEN",
        env: [
          { name: "EXTRA_HEADER_TOKEN", value: "" },
          { name: "REMOTE_TOKEN", value: "" },
        ],
      },
    });
  });

  it("shows saved HTTP MCP servers with OAuth keyring status", () => {
    const html = renderCard({
      configs: [httpServer],
      envSecretStatuses: [
        { serverId: "remote", name: "REMOTE_TOKEN", configured: true },
      ],
    });

    expect(html).toContain("Remote");
    expect(html).toContain("https://mcp.example.com/mcp");
    expect(html).toContain("REMOTE_TOKEN");
    expect(html).toContain("keyring set");
    expect(html).toContain(
      'aria-label="Authorize MCP server Remote with OAuth"',
    );
  });

  it("rejects unsafe command names before saving MCP configs", () => {
    expect(
      buildMcpServerConfigFromDraft({
        id: "fs",
        name: "Filesystem",
        transport: "stdio",
        command: "./server",
        argsText: "",
        cwd: "",
        url: "",
        oauthTokenEnv: "",
        envNamesText: "",
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("absolute path"),
    });

    expect(
      buildMcpServerConfigFromDraft({
        id: "fs",
        name: "Filesystem",
        transport: "stdio",
        command: "definitely-not-allowlisted",
        argsText: "",
        cwd: "",
        url: "",
        oauthTokenEnv: "",
        envNamesText: "",
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("allowlisted"),
    });
  });

  it("rejects env values and Terax-private env names in saved MCP configs", () => {
    expect(
      buildMcpServerConfigFromDraft({
        id: "fs",
        name: "Filesystem",
        transport: "stdio",
        command: "node",
        argsText: "server.js",
        cwd: "",
        url: "",
        oauthTokenEnv: "",
        envNamesText: "SAFE_TOKEN=secret",
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("names only"),
    });

    expect(
      buildMcpServerConfigFromDraft({
        id: "fs",
        name: "Filesystem",
        transport: "stdio",
        command: "node",
        argsText: "server.js",
        cwd: "",
        url: "",
        oauthTokenEnv: "",
        envNamesText: "TERAX_PRIVATE",
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("TERAX_") });
  });

  it("creates editable drafts from stored configs without env values", () => {
    expect(draftFromStoredMcpConfig(savedServer)).toMatchObject({
      id: "filesystem",
      name: "Filesystem",
      transport: "stdio",
      command: "node",
      argsText: "server.js",
      cwd: "/Users/me/project",
      url: "",
      oauthTokenEnv: "",
      envNamesText: "SAFE_TOKEN",
    });
  });
});
