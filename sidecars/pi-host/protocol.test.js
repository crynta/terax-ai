import { describe, expect, it } from "vitest";
import { handleJsonRpcLine, PI_PACKAGE_NAMES } from "./protocol.js";

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

  it("reports stub status with loaded Pi packages", async () => {
    const result = await handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "status" }),
    );

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        phase: "ready",
        detail: "Pi host stub",
        hostVersion: "0.1.0",
        piSdkLoaded: true,
      },
    });
    expect(packageNames(result)).toEqual(PI_PACKAGE_NAMES);
    expect(result.response.result.piPackages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "@earendil-works/pi-coding-agent",
          version: expect.stringMatching(/^0\./),
          loaded: true,
          error: null,
        }),
      ]),
    );
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
});
