import { describe, expect, it } from "vitest";
import {
  buildDiscoveryCacheKey,
  buildDiscoveryHeaders,
  buildModelsUrl,
  decodeModelDiscoveryResponse,
  parseDiscoveredModels,
} from "./modelDiscovery";

function jsonBody(value: unknown): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify(value)));
}

describe("buildModelsUrl", () => {
  it("appends models to a trimmed OpenAI-compatible base URL", () => {
    expect(buildModelsUrl("  http://localhost:11434/v1/  ")).toBe(
      "http://localhost:11434/v1/models",
    );
  });

  it("rejects an empty base URL", () => {
    expect(() => buildModelsUrl("  ")).toThrow("Base URL is required");
  });
});

describe("buildDiscoveryHeaders", () => {
  it("adds JSON accept header without auth by default", () => {
    expect(buildDiscoveryHeaders(null)).toEqual({ Accept: "application/json" });
  });

  it("adds a bearer token when an API key is present", () => {
    expect(buildDiscoveryHeaders("  sk-test  ")).toEqual({
      Accept: "application/json",
      Authorization: "Bearer sk-test",
    });
  });
});

describe("parseDiscoveredModels", () => {
  it("parses, deduplicates, enriches, and sorts OpenAI-compatible model lists", () => {
    expect(
      parseDiscoveredModels({
        object: "list",
        data: [
          { id: "zeta", owned_by: "ollama" },
          { id: "alpha", max_model_len: 4096 },
          { id: "zeta", max_context_length: 8192 },
          { id: " ", owned_by: "ignored" },
          { object: "model" },
        ],
      }),
    ).toEqual([
      { id: "alpha", contextLimit: 4096 },
      { id: "zeta", ownedBy: "ollama", contextLimit: 8192 },
    ]);
  });

  it("returns an empty list for an empty OpenAI-compatible data array", () => {
    expect(parseDiscoveredModels({ object: "list", data: [] })).toEqual([]);
  });

  it("rejects non OpenAI-compatible response shapes", () => {
    expect(() => parseDiscoveredModels({ models: ["llama"] })).toThrow(
      "OpenAI-compatible models list",
    );
  });
});

describe("decodeModelDiscoveryResponse", () => {
  it("decodes successful model list responses", () => {
    expect(
      decodeModelDiscoveryResponse({
        status: 200,
        body: jsonBody({ data: [{ id: "qwen2.5-coder:7b" }] }),
      }),
    ).toEqual({ ok: true, models: [{ id: "qwen2.5-coder:7b" }] });
  });

  it("treats non-2xx status codes as HTTP errors before parsing", () => {
    expect(
      decodeModelDiscoveryResponse({
        status: 401,
        body: jsonBody({ error: { message: "secret failure" } }),
      }),
    ).toEqual({
      ok: false,
      error: {
        kind: "http-error",
        message: "Models request failed with HTTP 401.",
        status: 401,
      },
    });
  });

  it("classifies invalid JSON separately", () => {
    expect(
      decodeModelDiscoveryResponse({
        status: 200,
        body: Array.from(new TextEncoder().encode("not json")),
      }),
    ).toEqual({
      ok: false,
      error: {
        kind: "invalid-json",
        message: "The endpoint did not return valid JSON.",
      },
    });
  });

  it("classifies valid JSON with the wrong shape separately", () => {
    expect(
      decodeModelDiscoveryResponse({
        status: 200,
        body: jsonBody({ models: ["llama"] }),
      }),
    ).toEqual({
      ok: false,
      error: {
        kind: "invalid-shape",
        message: "The endpoint did not return an OpenAI-compatible models list.",
      },
    });
  });
});

describe("buildDiscoveryCacheKey", () => {
  it("normalizes URL and separates auth state without storing the raw key", () => {
    const key = buildDiscoveryCacheKey({
      provider: "custom-endpoint",
      endpointId: "abc123",
      baseURL: " https://example.test/v1/ ",
      hasAuth: true,
    });

    expect(key).toBe("custom-endpoint:abc123:https://example.test/v1:auth");
    expect(key).not.toContain("sk-test");
  });
});
