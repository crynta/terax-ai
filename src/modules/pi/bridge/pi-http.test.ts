/**
 * Tests for the Pi HTTP proxy's body-proxyability check.
 *
 * While a Pi stream runs, the proxy swaps the global `fetch`. The proxy can
 * only faithfully serialize certain body types; for anything else (FormData,
 * ReadableStream) it must pass the request through to the real fetch rather
 * than silently corrupt it — otherwise an unrelated concurrent request, such as
 * Whisper's multipart upload, breaks.
 */
import { describe, expect, it } from "vitest";
import { isProxyableBody } from "./pi-http";

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
