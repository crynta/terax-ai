import { afterEach, describe, expect, it } from "vitest";
import {
  createTeraxNativeToolDefinitions,
  resetNativeToolExecutorForTests,
  setNativeToolExecutorForTests,
} from "./native-tools.js";

describe("createTeraxNativeToolDefinitions", () => {
  afterEach(() => {
    resetNativeToolExecutorForTests();
  });

  it("defines artifact tools without model-controlled conversation ids", () => {
    const tools = createTeraxNativeToolDefinitions(null, {
      id: "pi-artifacts",
      cwd: "/workspace",
      workspaceEnv: { kind: "local" },
    });

    const createArtifact = tools.find(
      (tool) => tool.name === "create_artifact",
    );
    const editArtifact = tools.find((tool) => tool.name === "edit_artifact");
    const readArtifact = tools.find((tool) => tool.name === "read_artifact");
    const listArtifacts = tools.find((tool) => tool.name === "list_artifacts");

    expect(createArtifact).toBeTruthy();
    expect(editArtifact).toBeTruthy();
    expect(readArtifact).toBeTruthy();
    expect(listArtifacts).toBeTruthy();
    expect(createArtifact.parameters.properties).not.toHaveProperty(
      "conversationId",
    );
    expect(editArtifact.parameters.properties).not.toHaveProperty(
      "conversationId",
    );
    expect(readArtifact.parameters.properties).not.toHaveProperty(
      "conversationId",
    );
  });

  it("derives tool definitions from a Rust capability manifest", () => {
    const tools = createTeraxNativeToolDefinitions(null, {
      id: "pi-manifest",
      cwd: "/workspace",
      workspaceEnv: { kind: "local" },
      capabilityManifest: {
        version: 1,
        tools: [
          {
            name: "read",
            label: "manifest read",
            description: "Read via manifest",
            promptSnippet: "Manifest prompt snippet",
            promptGuidelines: ["Manifest guideline"],
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
            approval: "auto",
            modelVisible: true,
          },
          {
            name: "hidden_tool",
            label: "Hidden",
            description: "Hidden tool",
            promptSnippet: "Hidden",
            parameters: { type: "object", properties: {}, required: [] },
            approval: "deny",
            modelVisible: false,
          },
        ],
      },
    });

    expect(tools.map((tool) => tool.name)).toEqual(["read"]);
    expect(tools[0]).toMatchObject({
      name: "read",
      label: "manifest read",
      description: "Read via manifest",
      promptSnippet: "Manifest prompt snippet",
      promptGuidelines: ["Manifest guideline"],
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    });
  });

  it("forwards manifest approval metadata to Rust native tool requests", async () => {
    const calls = [];
    setNativeToolExecutorForTests(async (request) => {
      calls.push(request);
      return { content: [{ type: "text", text: "ok" }], details: null };
    });

    const mcpTool = createTeraxNativeToolDefinitions(null, {
      id: "pi-mcp",
      cwd: "/workspace",
      workspaceEnv: { kind: "local" },
      capabilityManifest: {
        version: 1,
        tools: [
          {
            name: "mcp__echo__say",
            label: "Echo: say",
            description: "External MCP tool",
            promptSnippet: "Call MCP echo",
            parameters: { type: "object", properties: {}, required: [] },
            approval: "ask",
            risk: "high",
            origin: "mcp",
            modelVisible: true,
          },
        ],
      },
    })[0];

    await mcpTool.execute("call-mcp", { text: "hello" });

    expect(calls).toEqual([
      expect.objectContaining({
        sessionId: "pi-mcp",
        toolCallId: "call-mcp",
        toolName: "mcp__echo__say",
        approval: {
          policy: "ask",
          approved: true,
          risk: "high",
          origin: "mcp",
        },
      }),
    ]);
  });

  it("forwards the session workspace environment to Rust native tool requests", async () => {
    const calls = [];
    setNativeToolExecutorForTests(async (request) => {
      calls.push(request);
      return { content: [{ type: "text", text: "ok" }], details: null };
    });

    const bash = createTeraxNativeToolDefinitions(null, {
      id: "pi-wsl",
      cwd: "/workspace",
      workspaceEnv: { kind: "wsl", distro: "Ubuntu-24.04" },
    }).find((tool) => tool.name === "bash");

    await bash.execute("call-1", { command: "pwd" });

    expect(calls).toEqual([
      expect.objectContaining({
        sessionId: "pi-wsl",
        toolCallId: "call-1",
        toolName: "bash",
        cwd: "/workspace",
        workspaceEnv: { kind: "wsl", distro: "Ubuntu-24.04" },
      }),
    ]);
  });
});
