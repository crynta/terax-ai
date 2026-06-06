import { describe, expect, it } from "vitest";
import {
  discoverModels,
  type ModelDiscoveryRequest,
} from "./modelDiscoveryClient";

function jsonBody(value: unknown): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify(value)));
}

describe("discoverModels", () => {
  it("queries models through the supplied request function with private network opt in", async () => {
    const calls: Parameters<ModelDiscoveryRequest>[0][] = [];
    const request: ModelDiscoveryRequest = async (args) => {
      calls.push(args);
      return {
        status: 200,
        headers: {},
        body: jsonBody({ data: [{ id: "llama3.2:latest" }] }),
      };
    };

    const result = await discoverModels(
      { baseURL: "http://127.0.0.1:11434/v1", apiKey: " secret-key " },
      request,
    );

    expect(result).toEqual({
      ok: true,
      models: [{ id: "llama3.2:latest" }],
    });
    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:11434/v1/models",
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer secret-key",
        },
        allowPrivateNetwork: true,
        timeoutMs: 8000,
        maxBodyBytes: 1_048_576,
      },
    ]);
  });

  it("maps request failures to sanitized network errors", async () => {
    const result = await discoverModels(
      { baseURL: "http://localhost:1234/v1", apiKey: "secret-key" },
      async () => {
        throw new Error("failed with Bearer secret-key");
      },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "network-error",
        message: "Could not reach the model endpoint.",
      },
    });
  });
});
