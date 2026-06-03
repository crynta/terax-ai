import { describe, expect, it } from "vitest";
import {
  ALLOWED_METHODS,
  handleJsonRpcLine,
  PI_PACKAGE_NAMES,
} from "./protocol.js";

function packageNames(result) {
  return result.response.result.piPackages.map((pkg) => pkg.name);
}

describe("Pi host protocol", () => {
  it("responds to ping", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    );

    expect(result).toEqual({
      response: { jsonrpc: "2.0", id: 1, result: { pong: true } },
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

  it("reports non-secret diagnostics", async () => {
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "diagnostics-secret-value";

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
            toolMode: "noTools",
            sessionStorage: "rust-app-data-json",
            apiKeys: expect.arrayContaining([
              { name: "ANTHROPIC_API_KEY", configured: true },
              { name: "DEEPSEEK_API_KEY", configured: expect.any(Boolean) },
              { name: "MISTRAL_API_KEY", configured: expect.any(Boolean) },
            ]),
            forwardedEnvNames: expect.arrayContaining(["PATH", "HOME"]),
          },
          capabilities: {
            tools: false,
            files: false,
            shell: false,
            git: false,
            terminal: false,
            editor: false,
          },
          protocol: {
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
      expect(JSON.stringify(result.response.result)).not.toContain(
        "diagnostics-secret-value",
      );
    } finally {
      if (previousAnthropicKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
      }
    }
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

  it("keeps the JSON-RPC method allowlist Pi-scoped", () => {
    expect(ALLOWED_METHODS).toEqual([
      "ping",
      "status",
      "info",
      "diagnostics",
      "models.list",
      "sessions.list",
      "sessions.create",
      "sessions.send",
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
