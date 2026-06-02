import { describe, expect, it } from "vitest";
import { handleJsonRpcLine } from "./protocol.js";

describe("Pi host protocol", () => {
  it("responds to ping", () => {
    const result = handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    );

    expect(result).toEqual({
      response: { jsonrpc: "2.0", id: 1, result: { pong: true } },
      shutdown: false,
    });
  });

  it("reports stub status", () => {
    const result = handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "status" }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {
        phase: "ready",
        detail: "Pi host stub",
        hostVersion: "0.1.0",
        piSdkLoaded: false,
        piPackages: [],
      },
    });
  });

  it("reports host info", () => {
    const result = handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "info" }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: {
        hostVersion: "0.1.0",
        piSdkLoaded: false,
        piPackages: [],
      },
    });
  });

  it("marks shutdown requests", () => {
    const result = handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "shutdown" }),
    );

    expect(result.shutdown).toBe(true);
    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 4,
      result: { ok: true },
    });
  });

  it("rejects unknown methods", () => {
    const result = handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 5, method: "missing" }),
    );

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 5,
      error: { code: -32601, message: "Method not found" },
    });
  });
});
