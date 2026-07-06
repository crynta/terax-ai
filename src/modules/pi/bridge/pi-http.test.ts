/**
 * Tests for the Pi HTTP proxy's body handling.
 *
 * While a Pi stream runs, the proxy swaps the global `fetch`. The proxy can
 * only faithfully serialize certain body types; for anything else (FormData,
 * ReadableStream) it must pass the request through to the real fetch rather
 * than silently corrupt it — otherwise an unrelated concurrent request, such as
 * Whisper's multipart upload, breaks.
 */
import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installProxiedFetch,
  isProxyableBody,
  uninstallProxiedFetch,
} from "./pi-http";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class MockChannel<T> {
    onmessage: ((message: T) => void) | null = null;
  },
}));

function okResponseBody(text = "ok"): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function decodeRequestBody(body: number[] | null | undefined): string {
  return new TextDecoder().decode(new Uint8Array(body ?? []));
}

describe("isProxyableBody", () => {
  it("accepts bodies the proxy can serialize", () => {
    expect(isProxyableBody(null)).toBe(true);
    expect(isProxyableBody(undefined)).toBe(true);
    expect(isProxyableBody("plain text")).toBe(true);
    expect(isProxyableBody(new Uint8Array([1, 2, 3]))).toBe(true);
    expect(isProxyableBody(new URLSearchParams({ a: "1" }))).toBe(true);
  });

  it("rejects bodies the proxy cannot represent", () => {
    expect(isProxyableBody(new FormData())).toBe(false);
    const stream = new ReadableStream();
    expect(isProxyableBody(stream)).toBe(false);
  });
});

describe("proxied fetch", () => {
  afterEach(() => {
    uninstallProxiedFetch();
    vi.mocked(invoke).mockReset();
  });

  it("infers form content-type for URLSearchParams bodies", async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      headers: {},
      body: okResponseBody(),
    });

    installProxiedFetch();
    await fetch("https://api.example.test/token", {
      method: "PUT",
      body: new URLSearchParams({ grant_type: "client credentials" }),
    });

    expect(invoke).toHaveBeenCalledWith(
      "ai_http_request",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        }),
      }),
    );
    const payload = vi.mocked(invoke).mock.calls[0][1] as {
      body: number[] | null;
    };
    expect(decodeRequestBody(payload.body)).toBe(
      "grant_type=client+credentials",
    );
  });

  it("infers form content-type for streaming URLSearchParams posts", async () => {
    vi.mocked(invoke).mockImplementation(async (_command, payload) => {
      const streamPayload = payload as {
        onEvent: {
          onmessage: ((event: unknown) => void) | null;
        };
      };
      streamPayload.onEvent.onmessage?.({
        kind: "headers",
        status: 200,
        headers: {},
      });
      streamPayload.onEvent.onmessage?.({ kind: "end" });
    });

    installProxiedFetch();
    await fetch("https://api.example.test/stream", {
      method: "POST",
      body: new URLSearchParams({ prompt: "hello world" }),
    });

    expect(invoke).toHaveBeenCalledWith(
      "ai_http_stream",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        }),
      }),
    );
    const payload = vi.mocked(invoke).mock.calls[0][1] as {
      body: number[] | null;
    };
    expect(decodeRequestBody(payload.body)).toBe("prompt=hello+world");
  });

  it("preserves explicit URLSearchParams content-type headers", async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      headers: {},
      body: okResponseBody(),
    });

    installProxiedFetch();
    await fetch("https://api.example.test/token", {
      method: "PUT",
      headers: { "Content-Type": "application/custom-form" },
      body: new URLSearchParams({ code: "abc" }),
    });

    const payload = vi.mocked(invoke).mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(payload.headers).toEqual({
      "Content-Type": "application/custom-form",
    });
  });

  it("preserves Request URLSearchParams headers and body", async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      headers: {},
      body: okResponseBody(),
    });
    const request = new Request("https://api.example.test/token", {
      method: "PUT",
      body: new URLSearchParams({ code: "abc def" }),
    });

    installProxiedFetch();
    await fetch(request);

    const payload = vi.mocked(invoke).mock.calls[0][1] as {
      method: string;
      headers: Record<string, string>;
      body: number[] | null;
    };
    expect(payload.method).toBe("PUT");
    expect(payload.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    });
    expect(decodeRequestBody(payload.body)).toBe("code=abc+def");
  });
});
