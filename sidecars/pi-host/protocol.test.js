import { describe, expect, it } from "vitest";
import {
  ALLOWED_METHODS,
  handleJsonRpcLine,
  PI_PACKAGE_NAMES,
  PROTOCOL_VERSION,
} from "./protocol.js";
import {
  PI_HOST_PROTOCOL_SCHEMA,
  protocolSchemaMethods,
  validateProtocolParams,
} from "./protocol-schema.js";

function packageNames(result) {
  return result.response.result.piPackages.map((pkg) => pkg.name);
}

describe("Pi host protocol", () => {
  it("responds to ping", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    );

    expect(result).toEqual({
      response: {
        jsonrpc: "2.0",
        id: 1,
        result: {
          pong: true,
          protocolVersion: PROTOCOL_VERSION,
          hostVersion: "0.1.0",
        },
      },
      shutdown: false,
    });
  });

  it("reports lightweight runtime status without probing Pi packages", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "status" }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {
        phase: "ready",
        detail: "Pi host ready",
      },
    });
  });

  it("reports host info", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "info" }),
    );

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        hostVersion: "0.1.0",
        piSdkLoaded: true,
      },
    });
    expect(packageNames(result)).toEqual(PI_PACKAGE_NAMES);
  });

  it("reports non-secret diagnostics without exposing disabled test faux env", async () => {
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const previousFauxReasoning = process.env.TERAX_PI_HOST_TEST_FAUX_REASONING;
    const previousFauxEnable = process.env.TERAX_PI_HOST_ENABLE_TEST_FAUX;
    process.env.ANTHROPIC_API_KEY = "diagnostics-secret-value";
    process.env.TERAX_PI_HOST_TEST_FAUX_REASONING = "true";
    delete process.env.TERAX_PI_HOST_ENABLE_TEST_FAUX;

    try {
      const result = await handleJsonRpcLine(
        JSON.stringify({ jsonrpc: "2.0", id: 40, method: "diagnostics" }),
      );

      expect(result.response).toMatchObject({
        jsonrpc: "2.0",
        id: 40,
        result: {
          hostVersion: "0.1.0",
          piSdkLoaded: true,
          node: {
            version: process.version,
            platform: process.platform,
            arch: process.arch,
          },
          config: {
            toolMode: "rust-mediated",
            enabledTools: [
              "read",
              "ls",
              "grep",
              "find",
              "bash",
              "edit",
              "write",
              "create_artifact",
              "edit_artifact",
              "read_artifact",
              "list_artifacts",
            ],
            approvalRequiredTools: ["bash", "edit", "write"],
            sessionStorage: "rust-app-data-json+pi-sdk-jsonl",
            apiKeys: expect.arrayContaining([
              { name: "ANTHROPIC_API_KEY", configured: true },
              { name: "DEEPSEEK_API_KEY", configured: expect.any(Boolean) },
              { name: "MISTRAL_API_KEY", configured: expect.any(Boolean) },
            ]),
            forwardedEnvNames: expect.arrayContaining(["PATH", "HOME"]),
          },
          capabilities: {
            tools: true,
            files: true,
            shell: true,
            git: false,
            terminal: false,
            editor: false,
          },
          protocol: {
            protocolVersion: PROTOCOL_VERSION,
            allowedMethods: ALLOWED_METHODS,
          },
          limits: {
            maxPromptChars: 20000,
            maxSessions: 20,
          },
        },
      });
      expect(result.response.result.config.forwardedEnvNames).not.toContain(
        "ANTHROPIC_API_KEY",
      );
      expect(result.response.result.config.forwardedEnvNames).not.toContain(
        "TERAX_PI_HOST_TEST_FAUX_REASONING",
      );
      expect(JSON.stringify(result.response.result)).not.toContain(
        "diagnostics-secret-value",
      );
    } finally {
      if (previousAnthropicKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
      }
      if (previousFauxReasoning === undefined) {
        delete process.env.TERAX_PI_HOST_TEST_FAUX_REASONING;
      } else {
        process.env.TERAX_PI_HOST_TEST_FAUX_REASONING = previousFauxReasoning;
      }
      if (previousFauxEnable === undefined) {
        delete process.env.TERAX_PI_HOST_ENABLE_TEST_FAUX;
      } else {
        process.env.TERAX_PI_HOST_ENABLE_TEST_FAUX = previousFauxEnable;
      }
    }
  });

  it("reports test faux env names only behind explicit test opt-in", async () => {
    const previousFauxResponse = process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE;
    const previousFauxEnable = process.env.TERAX_PI_HOST_ENABLE_TEST_FAUX;
    process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE = "fixture";
    process.env.TERAX_PI_HOST_ENABLE_TEST_FAUX = "1";

    try {
      const result = await handleJsonRpcLine(
        JSON.stringify({ jsonrpc: "2.0", id: 42, method: "diagnostics" }),
      );

      expect(result.response.result.config.forwardedEnvNames).toEqual(
        expect.arrayContaining([
          "TERAX_PI_HOST_ENABLE_TEST_FAUX",
          "TERAX_PI_HOST_TEST_FAUX_RESPONSE",
        ]),
      );
    } finally {
      if (previousFauxResponse === undefined) {
        delete process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE;
      } else {
        process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE = previousFauxResponse;
      }
      if (previousFauxEnable === undefined) {
        delete process.env.TERAX_PI_HOST_ENABLE_TEST_FAUX;
      } else {
        process.env.TERAX_PI_HOST_ENABLE_TEST_FAUX = previousFauxEnable;
      }
    }
  });

  it("rejects unsupported protocol versions during ping negotiation", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 43,
        method: "ping",
        params: { protocolVersion: PROTOCOL_VERSION + 1 },
      }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 43,
      error: {
        code: -32009,
        message: `Unsupported Pi host protocol version: ${PROTOCOL_VERSION + 1}`,
      },
    });
  });

  it("rejects invalid params before dispatch", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 44,
        method: "sessions.list",
        params: [],
      }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 44,
      error: {
        code: -32602,
        message: "sessions.list params must be an object",
      },
    });
  });

  it("keeps the JSON schema method list synchronized with the allowlist", () => {
    expect(PI_HOST_PROTOCOL_SCHEMA.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(protocolSchemaMethods()).toEqual(ALLOWED_METHODS);
  });

  it("accepts capability manifests on lifecycle and explicit configure params", () => {
    const capabilityManifest = {
      tools: [{ name: "bash", approval: "ask", modelVisible: true }],
    };

    expect(
      validateProtocolParams("sessions.create", { capabilityManifest }),
    ).toEqual({ ok: true, params: { capabilityManifest } });
    expect(
      validateProtocolParams("sessions.resume", {
        sessionId: "pi_1",
        cwd: process.cwd(),
        sdkSessionFile: "/tmp/session.jsonl",
        sessionDir: "/tmp",
        capabilityManifest,
      }),
    ).toEqual({
      ok: true,
      params: {
        sessionId: "pi_1",
        cwd: process.cwd(),
        sdkSessionFile: "/tmp/session.jsonl",
        sessionDir: "/tmp",
        capabilityManifest,
      },
    });
    expect(
      validateProtocolParams("sessions.configure", {
        sessionId: "pi_1",
        capabilityManifest,
      }),
    ).toEqual({
      ok: true,
      params: {
        sessionId: "pi_1",
        capabilityManifest,
      },
    });
    expect(
      validateProtocolParams("sessions.send", {
        sessionId: "pi_1",
        prompt: "hello",
        capabilityManifest,
      }),
    ).toEqual({
      ok: false,
      message: "sessions.send params contains unsupported field: capabilityManifest",
    });
  });

  it("rejects unsupported fields before dispatch", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 45,
        method: "sessions.send",
        params: {
          sessionId: "missing",
          prompt: "hello",
          debugBypass: true,
        },
      }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 45,
      error: {
        code: -32602,
        message: "sessions.send params contains unsupported field: debugBypass",
      },
    });
  });

  it("rejects unsupported prompt context fields before dispatch", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 48,
        method: "sessions.send",
        params: {
          sessionId: "missing",
          prompt: "hello",
          context: { workspaceRoot: process.cwd(), ignored: true },
        },
      }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 48,
      error: {
        code: -32602,
        message:
          "sessions.send params.context contains unsupported field: ignored",
      },
    });
  });

  it("rejects unsupported workspace-env variants before dispatch", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 49,
        method: "sessions.create",
        params: {
          title: "bad workspace",
          workspaceEnv: { kind: "local", distro: "Ubuntu" },
        },
      }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 49,
      error: {
        code: -32602,
        message:
          "sessions.create params.workspaceEnv contains unsupported field: distro",
      },
    });
  });

  it("rejects wrong param types before handler lookup", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 46,
        method: "sessions.tool.respond",
        params: {
          sessionId: "missing",
          toolCallId: "call-1",
          approved: "yes",
        },
      }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 46,
      error: {
        code: -32602,
        message: "sessions.tool.respond params.approved must be a boolean",
      },
    });
  });

  it("rejects params on no-param methods", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 47,
        method: "status",
        params: { unused: true },
      }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 47,
      error: {
        code: -32602,
        message: "status params contains unsupported field: unused",
      },
    });
  });

  it("marks shutdown requests", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "shutdown" }),
    );

    expect(result.shutdown).toBe(true);
    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 4,
      result: { ok: true },
    });
  });

  it("rejects unknown methods", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 5, method: "missing" }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 5,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("adds structured recovery data to Pi session errors", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 41,
        method: "sessions.rename",
        params: { sessionId: "missing", title: "x".repeat(257) },
      }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 41,
      error: {
        code: -32602,
        message: "sessions.rename title must be at most 256 characters",
        data: {
          code: "PI_INVALID_PARAMS",
          category: "validation",
          retryable: false,
          remediation: "Check the Pi request fields and try again.",
        },
      },
    });
  });

  it("keeps the JSON-RPC method allowlist Pi-scoped", () => {
    expect(ALLOWED_METHODS).toEqual([
      "ping",
      "status",
      "info",
      "diagnostics",
      "models.list",
      "sessions.list",
      "sessions.create",
      "sessions.configure",
      "sessions.send",
      "sessions.resume",
      "sessions.tool.respond",
      "sessions.rename",
      "sessions.delete",
      "sessions.stop",
      "shutdown",
    ]);
  });

  it.each([
    "terminal.open",
    "pty.open",
    "shell.run",
    "git.status",
    "fs.readFile",
    "editor.open",
  ])("does not expose Terax-owned %s capability", async (method) => {
    const result = await handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 6, method }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 6,
      error: { code: -32601, message: "Method not found" },
    });
  });
});
